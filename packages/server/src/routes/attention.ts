// S2 (AIT-220): Attention 分析的薄 LLM 代理。
// 用 agent-chat 自己的 LLM 配置（Worker secret，见 config.attentionLlm）调 OpenAI 兼容
// /chat/completions，把候选节点 prompt 解析成语义摘要 + goalAlignment。
// key 不出 server；任何失败都降级（返回 degraded 标记，不 500），前端展示配置提示。
import { Hono } from 'hono'
import type { AppConfig } from '../config'
import {
  activateAttentionGoal,
  createAttentionGoal,
  ensureDefaultAttentionGoal,
  getAttentionGoalSnapshot,
  listAttentionGoals,
  renameAttentionGoal,
  upsertAttentionGoalSnapshot,
} from '../db/repos/attention_goal_snapshot.repo'
import { logGatewayEvent } from '../server-logs'
import { rebuildAttentionGoalSnapshot } from '../services/attention-rebuild'
import { extractGoalAnchor } from '@agent-chat/protocol'
import { listMessagesAndPartsByTopic } from '../db/repos/message.repo'

export interface AttentionLlmConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface InterpretResult {
  ok: boolean
  degraded?: boolean
  reason?: string
  conclusion?: string[]
  goalAlignment?: number[]
  userSummary?: string[]
  assistantSummary?: string[]
  aggregateTitle?: string[]
  sameTopic?: boolean[]
  closeCurrentTopic?: boolean[]
  nodeReason?: string[]
  normalizedGoal?: string
}

const DEFAULT_TIMEOUT_MS = 45_000
const MAX_OUTPUT_TOKENS = 700

const SYSTEM_PROMPT =
  '你是会话决策分析器。给定一段 Agent 会话的候选节点摘要，为每个节点输出：' +
  'userSummary（用户侧问题/决定的归纳，不能照搬原话）、assistantSummary（AI侧结论/方案归纳，不能照搬原文）、' +
  'aggregateTitle（适合图节点展示的短标题）、sameTopic（是否延续上一节点问题域）、closeCurrentTopic（该节点是否可以收束当前问题域）、' +
  'reason（简短判断依据）与 goalAlignment（0-10 整数，与总目标的相关程度，越高越贴目标）。' +
  '同时输出 normalizedGoal（总目标归一化表达）。严格只输出 JSON：' +
  '{"normalizedGoal":string,"nodes":[{"userSummary":string,"assistantSummary":string,"aggregateTitle":string,"sameTopic":boolean,"closeCurrentTopic":boolean,"reason":string,"goalAlignment":number}, ...]}，顺序与输入节点一致。'

function waitUntil(c: { executionCtx: ExecutionContext }, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise)
  } catch {
    void promise
  }
}

/** 解析模型输出。接受 {nodes:[...]} 或裸数组；非法 → null（调用方降级）。 */
export function parseInterpretation(
  content: string,
): {
  conclusion: string[]
  goalAlignment: number[]
  userSummary: string[]
  assistantSummary: string[]
  aggregateTitle: string[]
  sameTopic: boolean[]
  closeCurrentTopic: boolean[]
  nodeReason: string[]
  normalizedGoal?: string
} | null {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }
  const nodes = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { nodes?: unknown }).nodes)
      ? (data as { nodes: unknown[] }).nodes
      : null
  if (!nodes) return null
  const normalizedGoal =
    data && typeof data === 'object' && typeof (data as { normalizedGoal?: unknown }).normalizedGoal === 'string'
      ? (data as { normalizedGoal: string }).normalizedGoal
      : undefined
  const conclusion: string[] = []
  const goalAlignment: number[] = []
  const userSummary: string[] = []
  const assistantSummary: string[] = []
  const aggregateTitle: string[] = []
  const sameTopic: boolean[] = []
  const closeCurrentTopic: boolean[] = []
  const nodeReason: string[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') return null
    const node = n as Record<string, unknown>
    const user = typeof node.userSummary === 'string' ? node.userSummary : ''
    const assistant = typeof node.assistantSummary === 'string' ? node.assistantSummary : ''
    const aggregate = typeof node.aggregateTitle === 'string' ? node.aggregateTitle : ''
    const legacyConclusion = typeof node.conclusion === 'string' ? node.conclusion : ''
    userSummary.push(user)
    assistantSummary.push(assistant)
    aggregateTitle.push(aggregate)
    conclusion.push(assistant || legacyConclusion || aggregate)
    sameTopic.push(typeof node.sameTopic === 'boolean' ? node.sameTopic : true)
    closeCurrentTopic.push(typeof node.closeCurrentTopic === 'boolean' ? node.closeCurrentTopic : false)
    nodeReason.push(typeof node.reason === 'string' ? node.reason : '')
    const ga = Number(node.goalAlignment)
    goalAlignment.push(Number.isFinite(ga) ? Math.min(10, Math.max(0, ga)) : 5)
  }
  return {
    conclusion,
    goalAlignment,
    userSummary,
    assistantSummary,
    aggregateTitle,
    sameTopic,
    closeCurrentTopic,
    nodeReason,
    normalizedGoal,
  }
}

export async function interpretTrace(
  prompt: string,
  llm: AttentionLlmConfig,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; maxTokens?: number } = {},
): Promise<InterpretResult> {
  if (!llm.apiKey || !llm.baseUrl || !llm.model) {
    return { ok: false, degraded: true, reason: 'not_configured' }
  }
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, degraded: true, reason: `upstream_${res.status}` }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? ''
    const parsed = parseInterpretation(content)
    if (!parsed) return { ok: false, degraded: true, reason: 'parse_error' }
    return { ok: true, ...parsed }
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'fetch_error'
    return { ok: false, degraded: true, reason }
  }
}

export function createAttentionRoutes(getConfig: () => AppConfig | null) {
  const r = new Hono()

  function authorized(auth: string | undefined): boolean {
    const cfg = getConfig()
    if (!cfg?.token) return true
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    return token === cfg.token
  }

  r.post('/api/agent-chat/v1/attention/interpret', async (c) => {
    const cfg = getConfig()

    // 鉴权：复用 AGENT_CHAT_TOKEN（Bearer）。未配置 token 时（本地 dev）放行。
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)

    let body: { prompt?: unknown; maxTokens?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, degraded: true, reason: 'bad_request' }, 400)
    }
    if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
      return c.json({ ok: false, degraded: true, reason: 'bad_request' }, 400)
    }

    const llm = cfg?.attentionLlm ?? { apiKey: '', baseUrl: '', model: '' }
    const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined
    const result = await interpretTrace(body.prompt, llm, { maxTokens })
    if (!result.ok) {
      waitUntil(c, logGatewayEvent({
        eventKind: 'attention.interpret.degraded',
        status: result.reason ?? 'unknown',
        payload: {
          reason: result.reason ?? 'unknown',
          hasApiKey: !!llm.apiKey,
          hasBaseUrl: !!llm.baseUrl,
          hasModel: !!llm.model,
        },
      }))
    }
    // 降级也返回 200（带 degraded 标记），不 500 —— 前端据此展示配置提示。
    return c.json(result, 200, { 'Cache-Control': 'no-store' })
  })

  r.get('/api/agent-chat/v1/attention/goals/:topicId', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const topicId = c.req.param('topicId')
    const goals = await listAttentionGoals(topicId)
    return c.json({ ok: true, goals }, 200, { 'Cache-Control': 'no-store' })
  })

  r.post('/api/agent-chat/v1/attention/goals/:topicId/default', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const topicId = c.req.param('topicId')
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'bad_request' }, 400)
    }
    let goalText = typeof body.goalText === 'string' ? body.goalText.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : null
    if (!goalText) {
      const { messages, partsByMessage } = await listMessagesAndPartsByTopic(topicId)
      goalText = extractGoalAnchor({ messages, partsByMessage })?.normalized_goal?.trim() ?? ''
    }
    if (!goalText) return c.json({ ok: false, error: 'bad_request' }, 400)
    const goal = await ensureDefaultAttentionGoal({ topicId, goalText, title })
    return c.json({ ok: true, goal }, 200, { 'Cache-Control': 'no-store' })
  })

  r.post('/api/agent-chat/v1/attention/goals/:topicId', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const topicId = c.req.param('topicId')
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'bad_request' }, 400)
    }
    const goalText = typeof body.goalText === 'string' ? body.goalText.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : null
    if (!goalText) return c.json({ ok: false, error: 'bad_request' }, 400)
    const goal = await createAttentionGoal({ topicId, goalText, title, active: true })
    return c.json({ ok: true, goal }, 200, { 'Cache-Control': 'no-store' })
  })

  r.post('/api/agent-chat/v1/attention/goals/:goalId/activate', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const goal = await activateAttentionGoal(c.req.param('goalId'))
    if (!goal) return c.json({ ok: false, error: 'not_found' }, 404)
    return c.json({ ok: true, goal }, 200, { 'Cache-Control': 'no-store' })
  })

  r.patch('/api/agent-chat/v1/attention/goals/:goalId', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'bad_request' }, 400)
    }
    const title = typeof body.title === 'string' ? body.title.trim() || null : null
    const goal = await renameAttentionGoal({ id: c.req.param('goalId'), title })
    if (!goal) return c.json({ ok: false, error: 'not_found' }, 404)
    return c.json({ ok: true, goal }, 200, { 'Cache-Control': 'no-store' })
  })

  r.post('/api/agent-chat/v1/attention/goals/:goalId/rebuild', async (c) => {
    const cfg = getConfig()
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    let body: { maxTokens?: unknown } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const llm = cfg?.attentionLlm ?? { apiKey: '', baseUrl: '', model: '' }
    const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined
    const result = await rebuildAttentionGoalSnapshot({
      goalId: c.req.param('goalId'),
      llm,
      interpretTrace,
      maxTokens,
    })
    if (result.reason === 'not_found') return c.json({ ok: false, error: 'not_found' }, 404)
    return c.json(result, 200, { 'Cache-Control': 'no-store' })
  })

  r.get('/api/agent-chat/v1/attention/goals/:goalId/snapshot', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const snapshot = await getAttentionGoalSnapshot(c.req.param('goalId'))
    if (!snapshot) return c.json({ ok: false, error: 'not_found' }, 404, { 'Cache-Control': 'no-store' })
    return c.json({ ok: true, snapshot }, 200, { 'Cache-Control': 'no-store' })
  })

  r.put('/api/agent-chat/v1/attention/goals/:goalId/snapshot', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
    const goalId = c.req.param('goalId')
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'bad_request' }, 400)
    }
    const rawEventsJson = typeof body.rawEventsJson === 'string' ? body.rawEventsJson : ''
    const candidatesJson = typeof body.candidatesJson === 'string' ? body.candidatesJson : ''
    const interpretJson = typeof body.interpretJson === 'string' ? body.interpretJson : ''
    const traceNodesJson = typeof body.traceNodesJson === 'string' ? body.traceNodesJson : ''
    const planItemsJson = typeof body.planItemsJson === 'string' ? body.planItemsJson : ''
    const goalJson = typeof body.goalJson === 'string' ? body.goalJson : null
    const mindProjectionJson = typeof body.mindProjectionJson === 'string' ? body.mindProjectionJson : null
    const degradedReason = typeof body.degradedReason === 'string' ? body.degradedReason : null
    const sourceMessageCount = typeof body.sourceMessageCount === 'number' ? body.sourceMessageCount : 0
    const sourceLastEventTs = typeof body.sourceLastEventTs === 'number' ? body.sourceLastEventTs : 0
    if (!rawEventsJson || !candidatesJson || !interpretJson || !traceNodesJson || !planItemsJson) {
      return c.json({ ok: false, error: 'bad_request' }, 400)
    }
    const snapshot = await upsertAttentionGoalSnapshot({
      id: goalId,
      goalJson,
      rawEventsJson,
      candidatesJson,
      interpretJson,
      traceNodesJson,
      planItemsJson,
      mindProjectionJson,
      sourceMessageCount,
      sourceLastEventTs,
      degradedReason,
    })
    if (!snapshot) return c.json({ ok: false, error: 'not_found' }, 404)
    return c.json({ ok: true, snapshot }, 200, { 'Cache-Control': 'no-store' })
  })

  return r
}
