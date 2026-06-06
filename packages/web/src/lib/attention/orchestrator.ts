// S3 (AIT-221) 编排核心（纯逻辑，可单测）：
// - planInterpret：决定"何时调 interpret"（turn 落定 + 缓存命中守门，守成本红线）
// - buildTrace：candidates(+可选 LLM 结果) → TraceNode[]。AIT-226 后面板层只在有 LLM 结果时调用。
// - buildInterpretPrompt / callInterpret：组 prompt + 调 S2 server 代理
import type { CandidateNode } from './aggregator'
import type { GoalAnchor, TraceNode } from './types'
import { computeGoalDistance, goalAlignmentToDistance } from './goal-distance'

export interface InterpretResult {
  conclusion: string[]
  goalAlignment: number[]
  userSummary?: string[]
  assistantSummary?: string[]
  aggregateTitle?: string[]
  sameTopic?: boolean[]
  closeCurrentTopic?: boolean[]
  nodeReason?: string[]
  normalizedGoal?: string
}

export function candidateText(c: CandidateNode): string {
  const tools = c.tools.map((t) => String((t.payload as Record<string, unknown>).name ?? '')).join(' ')
  const msgs = c.messages.map((m) => String((m.payload as Record<string, unknown>).text ?? '')).join(' ')
  return [c.user_message, msgs, tools].join(' ')
}

/** 本地摘要工具：优先该回合 AI 摘要，否则截断 user_message。面板层不再把它作为 LLM 失败兜底。 */
export function localSummary(c: CandidateNode): string {
  const ex = c.exchanges[c.exchanges.length - 1]
  const s = ex?.assistant_summary?.trim()
  if (s && s !== '无明确 AI 回复') return s
  return c.user_message.slice(0, 15)
}

export function makeInterpretKey(candidateCount: number, lastEventTs: number): string {
  return `${candidateCount}:${lastEventTs}`
}

/**
 * 何时调 interpret：只在 agent 回到 idle（turn 落定）且轨迹有变化（cacheKey 与上次不同）时调一次。
 * delta/处理中（agentStatus !== 'idle'）一律不调 → 守住"每落定一次只调一次"的成本红线。
 */
export function planInterpret(input: {
  candidateCount: number
  lastEventTs: number
  agentStatus: string
  lastInterpretedKey: string | null
}): { shouldCall: boolean; cacheKey: string } {
  const cacheKey = makeInterpretKey(input.candidateCount, input.lastEventTs)
  const idle = input.agentStatus === 'idle'
  const shouldCall = idle && input.candidateCount > 0 && cacheKey !== input.lastInterpretedKey
  return { shouldCall, cacheKey }
}

/**
 * candidates → TraceNode[]。
 * 有 LLM 结果用 conclusion + goalAlignment 映射；无 LLM 结果时保留旧纯函数行为，
 * 但 Attention 面板层不会在 interpret 缺失时调用它。
 * inProgress 时最后一个节点标记为「分析中」（running / is_loading）。
 */
export function buildTrace(
  candidates: CandidateNode[],
  goalAnchor: GoalAnchor | null,
  interpret: InterpretResult | null,
  opts: { inProgress?: boolean } = {},
): TraceNode[] {
  const goalText = interpret?.normalizedGoal ?? goalAnchor?.normalized_goal ?? ''
  const lastIdx = candidates.length - 1
  return candidates.map((c, i) => {
    const llmConclusion = interpret?.conclusion[i]
    const hasLlm = typeof llmConclusion === 'string' && llmConclusion.trim().length > 0
    const userSummary = interpret?.userSummary?.[i]?.trim()
    const assistantSummary = interpret?.assistantSummary?.[i]?.trim()
    const aggregateTitle = interpret?.aggregateTitle?.[i]?.trim()
    const reason = interpret?.nodeReason?.[i]?.trim()
    const conclusion = assistantSummary || (hasLlm ? (llmConclusion as string) : localSummary(c))
    const goal_distance = hasLlm
      ? goalAlignmentToDistance(interpret?.goalAlignment[i] ?? 5)
      : computeGoalDistance(goalText, candidateText(c))
    const isInProgressNode = !!opts.inProgress && i === lastIdx
    return {
      id: c.id,
      parent_id: null,
      branch_id: 'main',
      user_message: userSummary || aggregateTitle || c.user_message,
      user_summary: userSummary || undefined,
      assistant_summary: assistantSummary || undefined,
      aggregate_title: aggregateTitle || undefined,
      same_topic: interpret?.sameTopic?.[i],
      close_current_topic: interpret?.closeCurrentTopic?.[i],
      intent: aggregateTitle || userSummary || '',
      rationale: reason || null,
      conclusion,
      planned_ref: null,
      alignment: 'unplanned',
      goal_distance,
      status: isInProgressNode ? 'running' : 'done',
      event_ids: [...c.thinking, ...c.tools, ...c.messages].map((e) => e.id),
      source_message_ids: [...c.source_message_ids],
      step_count: c.tools.length,
      user_kind: c.user_kind,
      assistant_actions: c.assistant_actions,
      user_message_count: c.user_messages.length,
      exchanges: c.exchanges,
      ts_start: c.ts_start,
      ts_end: c.ts_end,
      is_loading: isInProgressNode && !hasLlm,
    }
  })
}

export function buildInterpretPrompt(candidates: CandidateNode[], goalAnchor: GoalAnchor | null): string {
  const lines: string[] = [`总目标：「${goalAnchor?.normalized_goal ?? '（未知）'}」`, '']
  candidates.forEach((c, i) => {
    const tools = c.tools
      .slice(0, 5)
      .map((t) => {
        const payload = t.payload as Record<string, unknown>
        const name = String(payload.name ?? '')
        const input = compactJson(payload.input, 220)
        const output = compactJson(payload.output, 160)
        return [name, input ? `input=${input}` : '', output ? `output=${output}` : ''].filter(Boolean).join(' ')
      })
      .filter(Boolean)
      .join(' | ')
    lines.push(`[${i}]`)
    c.exchanges.slice(-3).forEach((exchange, exIndex) => {
      lines.push(`    用户${exIndex + 1}：「${compactPlain(exchange.user_message, 180)}」`)
      if (exchange.prev_ai_summary) lines.push(`    上文AI：「${compactPlain(exchange.prev_ai_summary, 160)}」`)
      if (exchange.assistant_summary) lines.push(`    AI${exIndex + 1}：「${compactPlain(exchange.assistant_summary, 260)}」`)
    })
    if (tools) lines.push(`    工具/外部输入：${tools}`)
  })
  lines.push(
    '',
    '请按节点顺序输出 JSON：{"normalizedGoal":"总目标的归一化表达","nodes":[{"userSummary":"用户侧问题/决定的归纳，不照搬原话","assistantSummary":"AI侧结论/方案的归纳，不照搬原话","aggregateTitle":"适合节点标题的短语","sameTopic":true,"closeCurrentTopic":false,"reason":"判断依据","goalAlignment":0-10}, ...]}',
  )
  return lines.join('\n')
}

function compactPlain(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function compactJson(value: unknown, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  return compactPlain(raw, max)
}

/** 调 S2 server 代理。任何失败（含 degraded）→ null（面板层显示 LLM 配置提示）。 */
export async function callInterpret(
  prompt: string,
  opts: { serverBase: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<InterpretResult | null> {
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(`${opts.serverBase}/api/agent-chat/v1/attention/interpret`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
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
    if (!data.ok || !Array.isArray(data.conclusion) || !Array.isArray(data.goalAlignment)) return null
    return {
      conclusion: data.conclusion,
      goalAlignment: data.goalAlignment,
      userSummary: Array.isArray(data.userSummary) ? data.userSummary : undefined,
      assistantSummary: Array.isArray(data.assistantSummary) ? data.assistantSummary : undefined,
      aggregateTitle: Array.isArray(data.aggregateTitle) ? data.aggregateTitle : undefined,
      sameTopic: Array.isArray(data.sameTopic) ? data.sameTopic : undefined,
      closeCurrentTopic: Array.isArray(data.closeCurrentTopic) ? data.closeCurrentTopic : undefined,
      nodeReason: Array.isArray(data.nodeReason) ? data.nodeReason : undefined,
      normalizedGoal: typeof data.normalizedGoal === 'string' ? data.normalizedGoal : undefined,
    }
  } catch {
    return null
  }
}
