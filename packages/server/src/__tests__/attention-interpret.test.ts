import { describe, it, expect } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import {
  interpretTrace,
  parseInterpretation,
  createAttentionRoutes,
  type AttentionLlmConfig,
} from '../routes/attention'
import type { AppConfig } from '../config'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as runtimeEventRepo from '../db/repos/topic_runtime_event.repo'

const PATH = '/api/agent-chat/v1/attention/interpret'
const GOOD_LLM: AttentionLlmConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://llm.example.com/v1',
  model: 'test-model',
}

/** 构造一个最小 AppConfig（只有 token + attentionLlm 对本路由有意义）。 */
function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    token: 'secret',
    attentionLlm: { apiKey: '', baseUrl: '', model: '' },
    ...over,
  } as unknown as AppConfig
}

function openAiResponse(content: string, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// ── TC-AIT-220-01：未配置 secret → 降级，不 500 ──────────────────────────────
describe('TC-AIT-220-01 未配置降级', () => {
  it('interpretTrace 缺 key/baseUrl/model 时返回 degraded:not_configured', async () => {
    const r = await interpretTrace('prompt', { apiKey: '', baseUrl: '', model: '' })
    expect(r.ok).toBe(false)
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('not_configured')
  })

  it('路由未配置 LLM 时返回 200 + degraded（不 500）', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { degraded?: boolean; reason?: string }
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('not_configured')
  })
})

// ── TC-AIT-220-02：正常 prompt → 调 OpenAI 兼容接口 → 解析返回 ────────────────
describe('TC-AIT-220-02 正常解析', () => {
  it('mock fetch 返回 JSON → conclusion/goalAlignment 正确', async () => {
    let calledUrl = ''
    let authHeader = ''
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url)
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? ''
      return openAiResponse('{"normalizedGoal":"修复 SSE 端口泄漏","nodes":[{"userSummary":"定位端口泄漏","assistantSummary":"确认 SSE 连接未释放","aggregateTitle":"SSE 端口泄漏","sameTopic":true,"closeCurrentTopic":false,"reason":"仍在定位","goalAlignment":9},{"userSummary":"查看 schema","assistantSummary":"检查数据库结构","aggregateTitle":"schema 检查","sameTopic":false,"closeCurrentTopic":true,"reason":"切换到数据层","goalAlignment":3}]}')
    }) as unknown as typeof fetch

    const r = await interpretTrace('两个节点', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(true)
    expect(r.conclusion).toEqual(['确认 SSE 连接未释放', '检查数据库结构'])
    expect(r.goalAlignment).toEqual([9, 3])
    expect(r.userSummary).toEqual(['定位端口泄漏', '查看 schema'])
    expect(r.aggregateTitle).toEqual(['SSE 端口泄漏', 'schema 检查'])
    expect(r.sameTopic).toEqual([true, false])
    expect(r.closeCurrentTopic).toEqual([false, true])
    expect(r.nodeReason).toEqual(['仍在定位', '切换到数据层'])
    expect(r.normalizedGoal).toBe('修复 SSE 端口泄漏')
    expect(r.diagnostics).toMatchObject({
      promptChars: 4,
      timeoutMs: 1000,
      maxTokens: 4096,
      httpStatus: 200,
      finishReason: 'stop',
    })
    expect(r.diagnostics?.responseChars).toBeGreaterThan(0)
    // 调到了正确的 OpenAI 兼容 endpoint，带 key
    expect(calledUrl).toBe('https://llm.example.com/v1/chat/completions')
    expect(authHeader).toBe('Bearer sk-test')
  })

  it('parseInterpretation 接受裸数组并对 goalAlignment 做 0-10 钳制', () => {
    const p = parseInterpretation('[{"conclusion":"a","goalAlignment":99},{"conclusion":"b","goalAlignment":-5}]')
    expect(p?.conclusion).toEqual(['a', 'b'])
    expect(p?.goalAlignment).toEqual([10, 0])
    expect(p?.sameTopic).toEqual([true, true])
    expect(p?.closeCurrentTopic).toEqual([false, false])
  })

  it('parseInterpretation 接受 markdown code fence 与前后解释文本', () => {
    const p = parseInterpretation('下面是结果：\n```json\n{"normalizedGoal":"目标","nodes":[{"userSummary":"用户概要","assistantSummary":"AI概要","aggregateTitle":"标题","sameTopic":true,"closeCurrentTopic":true,"reason":"依据","goalAlignment":8}]}\n```\n请查收')
    expect(p?.normalizedGoal).toBe('目标')
    expect(p?.userSummary).toEqual(['用户概要'])
    expect(p?.assistantSummary).toEqual(['AI概要'])
    expect(p?.aggregateTitle).toEqual(['标题'])
    expect(p?.goalAlignment).toEqual([8])
  })

  it('parseInterpretation 接受 result/output 包装和 snake_case 字段', () => {
    const p = parseInterpretation(JSON.stringify({
      result: {
        goal: '归一目标',
        items: [{
          user_summary: '用户侧归纳',
          assistant_summary: 'AI侧归纳',
          aggregate_title: '节点标题',
          node_reason: '包装字段',
          goal_alignment: 7,
        }],
      },
    }))
    expect(p?.normalizedGoal).toBe('归一目标')
    expect(p?.conclusion).toEqual(['AI侧归纳'])
    expect(p?.userSummary).toEqual(['用户侧归纳'])
    expect(p?.aggregateTitle).toEqual(['节点标题'])
    expect(p?.nodeReason).toEqual(['包装字段'])
    expect(p?.goalAlignment).toEqual([7])
  })

  it('parseInterpretation 非法 JSON → null', () => {
    expect(parseInterpretation('not json')).toBeNull()
  })
})

// ── TC-AIT-220-03：上游超时 / 4xx → 降级 ─────────────────────────────────────
describe('TC-AIT-220-03 上游失败降级', () => {
  it('上游 4xx → degraded:upstream_429', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('upstream_429')
    expect(r.diagnostics).toMatchObject({
      promptChars: 1,
      timeoutMs: 1000,
      maxTokens: 4096,
      httpStatus: 429,
    })
  })

  it('超时 → degraded:timeout', async () => {
    const fetchImpl = (async () => {
      const e = new Error('The operation timed out')
      e.name = 'TimeoutError'
      throw e
    }) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('timeout')
    expect(r.diagnostics).toMatchObject({
      promptChars: 1,
      timeoutMs: 1000,
      maxTokens: 4096,
      errorName: 'TimeoutError',
    })
  })

  it('解析失败 → degraded:parse_error', async () => {
    const fetchImpl = (async () => openAiResponse('这不是 JSON', 'length')) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000, maxTokens: 12 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('parse_error')
    expect(r.diagnostics).toMatchObject({
      promptChars: 1,
      timeoutMs: 1000,
      maxTokens: 12,
      httpStatus: 200,
      finishReason: 'length',
      responseChars: 8,
      parseError: 'invalid_json',
    })
  })

  it('解析失败时区分缺少 nodes 数组', async () => {
    const fetchImpl = (async () => openAiResponse('{"foo":1}')) as unknown as typeof fetch
    const r = await interpretTrace('p', GOOD_LLM, { fetchImpl, timeoutMs: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('parse_error')
    expect(r.diagnostics?.parseError).toBe('missing_nodes_array')
  })
})

// ── TC-AIT-220-04：无 / 错误 token → 401 ─────────────────────────────────────
describe('TC-AIT-220-04 鉴权', () => {
  it('缺 Authorization → 401', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('错误 token → 401', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('正确 token → 非 401（此处未配 LLM 故 200 degraded）', async () => {
    const app = createAttentionRoutes(() => cfg())
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
  })

  it('未配置 token（本地 dev）放行', async () => {
    const app = createAttentionRoutes(() => cfg({ token: '' }))
    const res = await app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('Attention goal snapshots', () => {
  it('维护目标历史：默认目标进入历史、切换激活、改名不改目标内容、快照按 goalId 保存', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'attention goals', kind: 'normal', agentType: 'general' })
      const app = createAttentionRoutes(() => cfg())
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }

      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '第一句话目标', title: '默认目标' }),
      })
      expect(defaultRes.status).toBe(200)
      const defaultBody = (await defaultRes.json()) as { goal: { id: string; goal_text: string; is_default: boolean; active: boolean } }
      expect(defaultBody.goal.goal_text).toBe('第一句话目标')
      expect(defaultBody.goal.is_default).toBe(true)
      expect(defaultBody.goal.active).toBe(true)

      const secondRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '第二个目标', title: '第二目标' }),
      })
      const secondBody = (await secondRes.json()) as { goal: { id: string; active: boolean } }
      expect(secondBody.goal.active).toBe(true)

      const thirdRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '第三个目标', title: '第三目标' }),
      })
      expect(thirdRes.status).toBe(200)

      const fourthRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '第四个目标', title: '第四目标' }),
      })
      expect(fourthRes.status).toBe(409)

      const renamedRes = await app.request(`/api/agent-chat/v1/attention/goals/${secondBody.goal.id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ title: '可读名称' }),
      })
      const renamedBody = (await renamedRes.json()) as { goal: { title: string; goal_text: string } }
      expect(renamedBody.goal.title).toBe('可读名称')
      expect(renamedBody.goal.goal_text).toBe('第二个目标')

      const activateDefaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/activate`, {
        method: 'POST',
        headers: { Authorization: 'Bearer secret' },
      })
      expect(activateDefaultRes.status).toBe(200)

      const listRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}`, {
        headers: { Authorization: 'Bearer secret' },
      })
      const listBody = (await listRes.json()) as { goals: Array<{ id: string; active: boolean; title: string | null }> }
      expect(listBody.goals).toHaveLength(3)
      expect(listBody.goals.find((goal) => goal.id === defaultBody.goal.id)?.active).toBe(true)
      expect(listBody.goals.find((goal) => goal.id === secondBody.goal.id)?.active).toBe(false)

      const putRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/snapshot`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
          goalJson: JSON.stringify({ raw_query: '第一句话目标', normalized_goal: '第一句话目标', ts: 1 }),
          rawEventsJson: JSON.stringify([{ id: 'e1' }]),
          candidatesJson: JSON.stringify([{ id: 'c1' }]),
          interpretJson: JSON.stringify({ conclusion: ['方案'], goalAlignment: [8] }),
          traceNodesJson: JSON.stringify([{ id: 'n1' }]),
          planItemsJson: JSON.stringify([]),
          sourceMessageCount: 20,
          sourceLastEventTs: 123,
        }),
      })
      expect(putRes.status).toBe(200)

      const snapshotRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/snapshot`, {
        headers: { Authorization: 'Bearer secret' },
      })
      const snapshotBody = (await snapshotRes.json()) as { snapshot: { source_message_count: number; trace_nodes_json: string } }
      expect(snapshotBody.snapshot.source_message_count).toBe(20)
      expect(JSON.parse(snapshotBody.snapshot.trace_nodes_json)).toEqual([{ id: 'n1' }])
    } finally {
      teardownTestDb()
    }
  })
})

describe('Attention server rebuild pipeline', () => {
  it('TC-AIT-SRV-01/02 rebuild 从 D1 读取消息生成多节点快照，不依赖前端上传 prompt/messages', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'attention rebuild', kind: 'normal', agentType: 'general' })
      const user1 = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: user1.id, kind: 'text', contentJson: JSON.stringify({ content: '如何注册 helm 平台到 token 中心？' }) })
      const assistant1 = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistant1.id, kind: 'text', contentJson: JSON.stringify({ content: '需要创建平台表、成员关系和券码校验流程。' }) })
      const user2 = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: user2.id, kind: 'text', contentJson: JSON.stringify({ content: '那券码购买和验证链路怎么设计？' }) })
      const assistant2 = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistant2.id, kind: 'text', contentJson: JSON.stringify({ content: '建议用订单、券码库存、兑换记录和应用侧验证 API。' }) })

      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '设计 token 中心平台注册和券码验证', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => openAiResponse(JSON.stringify({
        normalizedGoal: '设计 token 中心平台注册和券码验证',
        nodes: [
          {
            userSummary: '如何管理业务平台在 token 中心的注册',
            assistantSummary: '方案包含平台注册、成员关系和券码校验流程',
            aggregateTitle: '平台注册治理',
            sameTopic: true,
            closeCurrentTopic: false,
            reason: '第一轮围绕平台注册',
            goalAlignment: 9,
          },
          {
            userSummary: '如何设计券码购买与应用验证链路',
            assistantSummary: '方案包含订单、库存、兑换记录和验证 API',
            aggregateTitle: '券码购买验证',
            sameTopic: true,
            closeCurrentTopic: true,
            reason: '第二轮延续券码链路',
            goalAlignment: 9,
          },
        ],
      }))) as unknown as typeof fetch
      try {
        const rebuildRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        expect(rebuildRes.status).toBe(200)
        const rebuildBody = (await rebuildRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; raw_events_json: string; mind_projection_json: string | null } }
        expect(rebuildBody.ok).toBe(true)
        const nodes = JSON.parse(rebuildBody.snapshot.trace_nodes_json) as Array<{ user_message: string; source_message_ids: string[] }>
        expect(nodes.length).toBeGreaterThan(1)
        expect(nodes[0].user_message).toBe('如何管理业务平台在 token 中心的注册')
        expect(nodes.flatMap((node) => node.source_message_ids)).toEqual(expect.arrayContaining([user1.id, user2.id]))
        expect(JSON.parse(rebuildBody.snapshot.raw_events_json).length).toBeGreaterThan(0)
        expect(rebuildBody.snapshot.mind_projection_json).toBeTruthy()
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      teardownTestDb()
    }
  })

  it('TC-AIT-SRV-04 LLM timeout 时标记 degraded，不写空图假 snapshot', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'attention degraded', kind: 'normal', agentType: 'general' })
      const user = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: user.id, kind: 'text', contentJson: JSON.stringify({ content: '帮我分析注意力面板' }) })
      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '分析注意力面板', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => {
        const e = new Error('timeout')
        e.name = 'TimeoutError'
        throw e
      }) as unknown as typeof fetch
      try {
        const rebuildRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        expect(rebuildRes.status).toBe(200)
        const rebuildBody = (await rebuildRes.json()) as { ok: boolean; degraded: boolean; reason: string; snapshot: { degraded_reason: string; trace_nodes_json: string; source_message_count: number } }
        expect(rebuildBody.ok).toBe(false)
        expect(rebuildBody.degraded).toBe(true)
        expect(rebuildBody.reason).toBe('timeout')
        expect(rebuildBody.snapshot.degraded_reason).toBe('timeout')
        expect(rebuildBody.snapshot.trace_nodes_json).toBe('[]')
        expect(rebuildBody.snapshot.source_message_count).toBe(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      teardownTestDb()
    }
  })

  it('incremental rebuild 只解释新增节点，并冻结旧 snapshot 节点', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'attention incremental append', kind: 'normal', agentType: 'general' })
      const userB = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: userB.id, kind: 'text', contentJson: JSON.stringify({ content: '旧节点 B：注册平台开户' }) })
      const assistantB = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistantB.id, kind: 'text', contentJson: JSON.stringify({ content: '旧 B 结论：开户注册需要资料校验。' }) })
      const userC = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: userC.id, kind: 'text', contentJson: JSON.stringify({ content: '旧节点 C：券码验证链路' }) })
      const assistantC = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistantC.id, kind: 'text', contentJson: JSON.stringify({ content: '旧 C 结论：验证链路需要兑换记录。' }) })

      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '目标 A：设计 token 中心', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const prompts: string[] = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
        const prompt = body.messages?.[1]?.content ?? ''
        prompts.push(prompt)
        if (prompt.includes('组0')) return openAiResponse('{"groups":[]}')
        if (prompt.includes('新增节点 D')) {
          return openAiResponse(JSON.stringify({
            normalizedGoal: '目标 A：设计 token 中心',
            nodes: [{
              userSummary: '新增 D 摘要',
              assistantSummary: '新增 D 结论',
              aggregateTitle: '新增 D 标题',
              sameTopic: true,
              closeCurrentTopic: false,
              reason: '只解释新增 D',
              goalAlignment: 6,
            }],
          }))
        }
        return openAiResponse(JSON.stringify({
          normalizedGoal: '目标 A：设计 token 中心',
          nodes: [
            {
              userSummary: '冻结 B 摘要',
              assistantSummary: '冻结 B 结论',
              aggregateTitle: '冻结 B 标题',
              sameTopic: true,
              closeCurrentTopic: false,
              reason: '初始 B',
              goalAlignment: 9,
            },
            {
              userSummary: '冻结 C 摘要',
              assistantSummary: '冻结 C 结论',
              aggregateTitle: '冻结 C 标题',
              sameTopic: true,
              closeCurrentTopic: false,
              reason: '初始 C',
              goalAlignment: 8,
            },
          ],
        }))
      }) as unknown as typeof fetch
      try {
        const firstRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const firstBody = (await firstRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string } }
        expect(firstBody.ok).toBe(true)
        const frozenNodes = JSON.parse(firstBody.snapshot.trace_nodes_json)
        expect(frozenNodes).toHaveLength(2)

        const userD = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
        await messageRepo.createMessagePart({ messageId: userD.id, kind: 'text', contentJson: JSON.stringify({ content: '新增节点 D：账单对账策略' }) })
        const assistantD = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
        await messageRepo.createMessagePart({ messageId: assistantD.id, kind: 'text', contentJson: JSON.stringify({ content: '新增 D 结论：需要账单快照和差异表。' }) })

        prompts.length = 0
        const secondRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const secondBody = (await secondRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number } }
        expect(secondBody.ok).toBe(true)
        const interpretPrompts = prompts.filter((prompt) => prompt.includes('请按节点顺序输出 JSON'))
        expect(interpretPrompts).toHaveLength(1)
        expect(interpretPrompts[0]).toContain('新增节点 D')
        expect(interpretPrompts[0]).not.toContain('旧节点 B')
        expect(interpretPrompts[0]).not.toContain('旧节点 C')
        const nodes = JSON.parse(secondBody.snapshot.trace_nodes_json)
        expect(nodes).toHaveLength(3)
        expect(nodes.slice(0, 2)).toEqual(frozenNodes)
        expect(nodes[2].user_message).toBe('新增 D 摘要')
        expect(nodes[2].assistant_summary).toBe('新增 D 结论')
        expect(secondBody.snapshot.source_message_count).toBe(6)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      teardownTestDb()
    }
  })

  it('incremental rebuild 对大量新增节点分批追赶，避免一次性全量解释', async () => {
    await setupTestDb()
    const originalNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    const createTurn = async (topicId: string, userText: string, assistantText: string) => {
      now += 60 * 60 * 1000
      const user = await messageRepo.createMessage({ topicId, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: user.id, kind: 'text', contentJson: JSON.stringify({ content: userText }) })
      now += 1
      const assistant = await messageRepo.createMessage({ topicId, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistant.id, kind: 'text', contentJson: JSON.stringify({ content: assistantText }) })
    }
    try {
      const topic = await topicRepo.createTopic({ name: 'attention incremental backlog', kind: 'normal', agentType: 'general' })
      await createTurn(topic.id, '初始问题：如何设计 token 中心？', '初始结论：先确定目标。')

      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '目标 A：设计 token 中心', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const prompts: string[] = []
      const nodes = (labels: string[]) => JSON.stringify({
        normalizedGoal: '目标 A：设计 token 中心',
        nodes: labels.map((label, index) => ({
          userSummary: `${label} 摘要`,
          assistantSummary: `${label} 结论`,
          aggregateTitle: `${label} 标题`,
          sameTopic: true,
          closeCurrentTopic: false,
          reason: `解释 ${label}`,
          goalAlignment: Math.max(1, 9 - index),
        })),
      })
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
        const prompt = body.messages?.[1]?.content ?? ''
        prompts.push(prompt)
        if (prompt.includes('组0')) return openAiResponse('{"groups":[]}')
        if (prompt.includes('新增问题 5')) return openAiResponse(nodes(['新增问题 5', '新增问题 6']))
        if (prompt.includes('新增问题 1')) return openAiResponse(nodes(['新增问题 1', '新增问题 2', '新增问题 3', '新增问题 4']))
        return openAiResponse(nodes(['初始问题']))
      }) as unknown as typeof fetch
      try {
        const firstRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const firstBody = (await firstRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number } }
        expect(firstBody.ok).toBe(true)
        expect(JSON.parse(firstBody.snapshot.trace_nodes_json)).toHaveLength(1)
        expect(firstBody.snapshot.source_message_count).toBe(2)

        for (let i = 1; i <= 6; i += 1) {
          await createTurn(topic.id, `新增问题 ${i}：这一步如何处理？`, `新增问题 ${i} 结论：按增量处理。`)
        }

        prompts.length = 0
        const secondRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const secondBody = (await secondRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number } }
        expect(secondBody.ok).toBe(true)
        const secondInterpretPrompts = prompts.filter((prompt) => prompt.includes('请按节点顺序输出 JSON'))
        expect(secondInterpretPrompts).toHaveLength(1)
        expect(secondInterpretPrompts[0]).toContain('新增问题 1')
        expect(secondInterpretPrompts[0]).toContain('新增问题 4')
        expect(secondInterpretPrompts[0]).not.toContain('新增问题 5')
        expect(JSON.parse(secondBody.snapshot.trace_nodes_json)).toHaveLength(5)
        expect(secondBody.snapshot.source_message_count).toBe(10)

        prompts.length = 0
        const thirdRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const thirdBody = (await thirdRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number } }
        expect(thirdBody.ok).toBe(true)
        const thirdInterpretPrompts = prompts.filter((prompt) => prompt.includes('请按节点顺序输出 JSON'))
        expect(thirdInterpretPrompts).toHaveLength(1)
        expect(thirdInterpretPrompts[0]).toContain('新增问题 5')
        expect(thirdInterpretPrompts[0]).toContain('新增问题 6')
        expect(thirdInterpretPrompts[0]).not.toContain('新增问题 1')
        expect(JSON.parse(thirdBody.snapshot.trace_nodes_json)).toHaveLength(7)
        expect(thirdBody.snapshot.source_message_count).toBe(14)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      Date.now = originalNow
      teardownTestDb()
    }
  })

  it('incremental rebuild 用 raw event id 识别同毫秒新增事件', async () => {
    await setupTestDb()
    const originalNow = Date.now
    Date.now = () => 2_000_000
    try {
      const topic = await topicRepo.createTopic({ name: 'attention incremental same timestamp', kind: 'normal', agentType: 'general' })
      const userB = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: userB.id, kind: 'text', contentJson: JSON.stringify({ content: '旧节点 B：注册平台开户？' }) })
      const assistantB = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistantB.id, kind: 'text', contentJson: JSON.stringify({ content: '旧 B 结论：先校验资料。' }) })

      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '目标 A：设计 token 中心', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const prompts: string[] = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
        const prompt = body.messages?.[1]?.content ?? ''
        prompts.push(prompt)
        if (prompt.includes('组0')) return openAiResponse('{"groups":[]}')
        if (prompt.includes('同毫秒新增 D')) {
          return openAiResponse(JSON.stringify({
            normalizedGoal: '目标 A：设计 token 中心',
            nodes: [{
              userSummary: '同毫秒新增 D 摘要',
              assistantSummary: '同毫秒新增 D 结论',
              aggregateTitle: '同毫秒新增 D 标题',
              sameTopic: true,
              closeCurrentTopic: false,
              reason: '同毫秒 delta',
              goalAlignment: 6,
            }],
          }))
        }
        return openAiResponse(JSON.stringify({
          normalizedGoal: '目标 A：设计 token 中心',
          nodes: [{
            userSummary: '旧 B 摘要',
            assistantSummary: '旧 B 结论',
            aggregateTitle: '旧 B 标题',
            sameTopic: true,
            closeCurrentTopic: false,
            reason: '初始 B',
            goalAlignment: 9,
          }],
        }))
      }) as unknown as typeof fetch
      try {
        const firstRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const firstBody = (await firstRes.json()) as { ok: boolean; snapshot: { source_last_event_ts: number } }
        expect(firstBody.ok).toBe(true)

        const userD = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
        await messageRepo.createMessagePart({ messageId: userD.id, kind: 'text', contentJson: JSON.stringify({ content: '同毫秒新增 D：账单对账策略？' }) })
        const assistantD = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
        await messageRepo.createMessagePart({ messageId: assistantD.id, kind: 'text', contentJson: JSON.stringify({ content: '同毫秒新增 D 结论：保存差异表。' }) })

        prompts.length = 0
        const secondRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const secondBody = (await secondRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number; source_last_event_ts: number } }
        expect(secondBody.ok).toBe(true)
        expect(secondBody.snapshot.source_last_event_ts).toBe(firstBody.snapshot.source_last_event_ts)
        const interpretPrompts = prompts.filter((prompt) => prompt.includes('请按节点顺序输出 JSON'))
        expect(interpretPrompts).toHaveLength(1)
        expect(interpretPrompts[0]).toContain('同毫秒新增 D')
        expect(interpretPrompts[0]).not.toContain('旧节点 B')
        expect(JSON.parse(secondBody.snapshot.trace_nodes_json)).toHaveLength(2)

        prompts.length = 0
        const thirdRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const thirdBody = (await thirdRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string; source_message_count: number } }
        expect(thirdBody.ok).toBe(true)
        expect(prompts.filter((prompt) => prompt.includes('请按节点顺序输出 JSON'))).toHaveLength(0)
        expect(JSON.parse(thirdBody.snapshot.trace_nodes_json)).toHaveLength(2)
        expect(thirdBody.snapshot.source_message_count).toBe(4)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      Date.now = originalNow
      teardownTestDb()
    }
  })

  it('mode=full 允许从目标根节点刷新整棵树', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'attention full refresh', kind: 'normal', agentType: 'general' })
      const userB = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: userB.id, kind: 'text', contentJson: JSON.stringify({ content: '节点 B：开户' }) })
      const assistantB = await messageRepo.createMessage({ topicId: topic.id, role: 'assistant', status: 'done' })
      await messageRepo.createMessagePart({ messageId: assistantB.id, kind: 'text', contentJson: JSON.stringify({ content: 'B 初始结论' }) })
      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '目标 A', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      let version = 1
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
        const prompt = body.messages?.[1]?.content ?? ''
        if (prompt.includes('组0')) return openAiResponse('{"groups":[]}')
        return openAiResponse(JSON.stringify({
          normalizedGoal: '目标 A',
          nodes: [{
            userSummary: `B_v${version}`,
            assistantSummary: `B 结论 v${version}`,
            aggregateTitle: `B 标题 v${version}`,
            sameTopic: true,
            closeCurrentTopic: false,
            reason: `root refresh v${version}`,
            goalAlignment: version === 1 ? 8 : 4,
          }],
        }))
      }) as unknown as typeof fetch
      try {
        const firstRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const firstBody = (await firstRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string } }
        expect(firstBody.ok).toBe(true)
        expect(JSON.parse(firstBody.snapshot.trace_nodes_json)[0].user_message).toBe('B_v1')

        version = 2
        const fullRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ mode: 'full' }),
        })
        const fullBody = (await fullRes.json()) as { ok: boolean; snapshot: { trace_nodes_json: string } }
        expect(fullBody.ok).toBe(true)
        const refreshed = JSON.parse(fullBody.snapshot.trace_nodes_json)
        expect(refreshed[0].user_message).toBe('B_v2')
        expect(refreshed[0].assistant_summary).toBe('B 结论 v2')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      teardownTestDb()
    }
  })

  it('runtime todo/plan 事件落库后进入 attention rebuild rawEvents', async () => {
    await setupTestDb()
    try {
      const topic = await topicRepo.createTopic({ name: 'runtime events', kind: 'normal', agentType: 'general' })
      const user = await messageRepo.createMessage({ topicId: topic.id, role: 'user', status: 'done' })
      await messageRepo.createMessagePart({ messageId: user.id, kind: 'text', contentJson: JSON.stringify({ content: '做一个 trello 应用' }) })
      await runtimeEventRepo.createTopicRuntimeEvent({
        topicId: topic.id,
        kind: 'todo',
        ts: user.started_at + 1,
        payload: { input: { todos: [{ id: '1', content: '建 Next 框架', status: 'pending' }] } },
      })
      await runtimeEventRepo.createTopicRuntimeEvent({
        topicId: topic.id,
        kind: 'plan',
        ts: user.started_at + 2,
        payload: { text: '1. 初始化项目', items: [{ id: 'plan_1', text: '初始化项目', status: 'pending', depth: 0 }] },
      })
      const app = createAttentionRoutes(() => cfg({ attentionLlm: GOOD_LLM }))
      const auth = { Authorization: 'Bearer secret', 'content-type': 'application/json' }
      const defaultRes = await app.request(`/api/agent-chat/v1/attention/goals/${topic.id}/default`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ goalText: '做一个 trello 应用', title: '默认目标' }),
      })
      const defaultBody = (await defaultRes.json()) as { goal: { id: string } }

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => openAiResponse('{"nodes":[{"userSummary":"创建 trello 应用","assistantSummary":"已形成初始执行计划","aggregateTitle":"trello 初始化","sameTopic":true,"closeCurrentTopic":false,"reason":"todo/plan 纳入上下文","goalAlignment":9}]}')) as unknown as typeof fetch
      try {
        const rebuildRes = await app.request(`/api/agent-chat/v1/attention/goals/${defaultBody.goal.id}/rebuild`, {
          method: 'POST',
          headers: auth,
          body: '{}',
        })
        const rebuildBody = (await rebuildRes.json()) as { ok: boolean; snapshot: { raw_events_json: string; plan_items_json: string } }
        expect(rebuildBody.ok).toBe(true)
        const rawEvents = JSON.parse(rebuildBody.snapshot.raw_events_json) as Array<{ kind: string; payload: Record<string, unknown> }>
        expect(rawEvents.some((event) => event.kind === 'todo')).toBe(true)
        expect(rawEvents.some((event) => event.kind === 'plan')).toBe(true)
        expect(rebuildBody.snapshot.plan_items_json).toContain('建 Next 框架')
        expect(rebuildBody.snapshot.plan_items_json).toContain('初始化项目')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      teardownTestDb()
    }
  })
})
