import { describe, it, expect } from 'vitest'
import type { Message, MessagePart } from '@agent-chat/protocol'
import {
  storeToRawEvents,
  extractGoalAnchor,
  aggregate,
  type StoreToRawEventsInput,
} from '../lib/attention'

// ── fixtures ──────────────────────────────────────────────────────────────
let _mid = 0
function makeMessage(over: Partial<Message> = {}): Message {
  _mid++
  return {
    id: over.id ?? `msg-${_mid}`,
    topic_id: 'topic-1',
    role: 'user',
    status: 'done',
    started_at: 1000 * _mid,
    finished_at: 1000 * _mid + 500,
    stop_reason: null,
    cron_run_id: null,
    turn_id: null,
    client_message_id: null,
    retry_count: 0,
    max_retries: 0,
    ...over,
  }
}

let _pid = 0
function part(messageId: string, kind: MessagePart['kind'], content: unknown, ordinal = 0): MessagePart {
  _pid++
  return {
    id: `part-${_pid}`,
    message_id: messageId,
    ordinal,
    kind,
    content_json: typeof content === 'string' ? JSON.stringify({ content }) : JSON.stringify(content),
  }
}

function buildInput(
  rows: Array<{ msg: Message; parts: MessagePart[] }>,
  extra: Partial<StoreToRawEventsInput> = {},
): StoreToRawEventsInput {
  const partsByMessage: Record<string, MessagePart[]> = {}
  for (const r of rows) partsByMessage[r.msg.id] = r.parts
  return { messages: rows.map((r) => r.msg), partsByMessage, ...extra }
}

// ── TC-AIT-219-01：role/kind 分类，system/cron 不算真实用户消息 ──────────────
describe('TC-AIT-219-01 RawEvent 分类', () => {
  it('user/assistant/system/cron 正确分类，仅 user 记为真实用户', () => {
    const u = makeMessage({ id: 'u', role: 'user', turn_id: 't1' })
    const a = makeMessage({ id: 'a', role: 'assistant', turn_id: 't1' })
    const s = makeMessage({ id: 's', role: 'system', turn_id: 't1' })
    const c = makeMessage({ id: 'c', role: 'cron', turn_id: 't2' })
    const events = storeToRawEvents(
      buildInput([
        { msg: u, parts: [part('u', 'text', '帮我修一个 bug')] },
        { msg: a, parts: [part('a', 'text', '好的，我来看看')] },
        { msg: s, parts: [part('s', 'text', '<system-notice>x</system-notice>')] },
        { msg: c, parts: [part('c', 'text', '定时任务触发')] },
      ]),
    )
    const byId = Object.fromEntries(events.map((e) => [e.id, e]))
    expect(byId['part-1'].kind).toBe('message')
    expect(byId['part-1'].role).toBe('user')
    expect(byId['part-2'].role).toBe('assistant')
    // system / cron：既不是 user 也不是 assistant
    expect(byId['part-3'].role).toBeUndefined()
    expect(byId['part-4'].role).toBeUndefined()

    // 聚合时只有 1 条真实用户消息 → 1 个候选节点
    const { candidates } = aggregate(events)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].user_message).toBe('帮我修一个 bug')
  })
})

// ── TC-AIT-219-02：按用户消息/turn 切分，Turn 数 = 真实用户消息数 ────────────
describe('TC-AIT-219-02 Turn 切分', () => {
  it('3 条用户消息 → 3 个候选节点，turn_id 对应', () => {
    const rows: Array<{ msg: Message; parts: MessagePart[] }> = []
    for (let i = 1; i <= 3; i++) {
      const u = makeMessage({ id: `u${i}`, role: 'user', turn_id: `t${i}` })
      const a = makeMessage({ id: `a${i}`, role: 'assistant', turn_id: `t${i}` })
      rows.push({ msg: u, parts: [part(`u${i}`, 'text', `用户问题 ${i}`)] })
      rows.push({ msg: a, parts: [part(`a${i}`, 'text', `回答 ${i}`)] })
    }
    const { candidates } = aggregate(storeToRawEvents(buildInput(rows)))
    expect(candidates).toHaveLength(3)
    expect(candidates.map((c) => c.turn_id)).toEqual(['t1', 't2', 't3'])
  })
})

// ── TC-AIT-219-03：tool_use / tool_result 按 toolUseId 配对 ───────────────────
describe('TC-AIT-219-03 工具配对', () => {
  it('tool_result 的 output 归并到对应 tool_use，不单独成事件', () => {
    const u = makeMessage({ id: 'u', role: 'user', turn_id: 't1' })
    const a = makeMessage({ id: 'a', role: 'assistant', turn_id: 't1' })
    const events = storeToRawEvents(
      buildInput([
        { msg: u, parts: [part('u', 'text', '读个文件')] },
        {
          msg: a,
          parts: [
            part('a', 'tool_use', { toolUseId: 'tu1', name: 'Read', input: { path: '/x' } }, 0),
            part('a', 'tool_result', { toolUseId: 'tu1', output: 'file contents', isError: false }, 1),
          ],
        },
      ]),
    )
    const toolEvents = events.filter((e) => e.kind === 'tool_use')
    expect(toolEvents).toHaveLength(1)
    expect(toolEvents[0].payload.name).toBe('Read')
    expect(toolEvents[0].payload.output).toBe('file contents')
    expect(toolEvents[0].payload.isError).toBe(false)
    // 没有单独的 tool_result 事件
    expect(events.some((e) => e.id === 'part-3' && e.kind !== 'tool_use')).toBe(false)
  })

  it('孤儿 tool_result（无匹配 tool_use）补一个工具事件，不丢信息', () => {
    const a = makeMessage({ id: 'a', role: 'assistant', turn_id: 't1' })
    const events = storeToRawEvents(
      buildInput([
        { msg: a, parts: [part('a', 'tool_result', { toolUseId: 'orphan', output: 'z' }, 0)] },
      ]),
    )
    const tools = events.filter((e) => e.kind === 'tool_use')
    expect(tools).toHaveLength(1)
    expect(tools[0].payload.output).toBe('z')
  })
})

// ── TC-AIT-219-04：todos / plan 取最新快照 ───────────────────────────────────
describe('TC-AIT-219-04 todos/plan 映射', () => {
  it('todos 与 plan 快照映射为 todo/plan 事件并进入 planItems', () => {
    const u = makeMessage({ id: 'u', role: 'user', turn_id: 't1' })
    const events = storeToRawEvents(
      buildInput([{ msg: u, parts: [part('u', 'text', '做计划')] }], {
        todos: [
          { id: '1', content: '写代码', status: 'in_progress' },
          { id: '2', content: '写测试', status: 'pending' },
        ],
        plan: '- 第一步\n- 第二步',
      }),
    )
    const todoEvt = events.find((e) => e.kind === 'todo')
    const planEvt = events.find((e) => e.kind === 'plan')
    expect((todoEvt?.payload.input as { todos: unknown[] }).todos).toHaveLength(2)
    expect((planEvt?.payload.items as unknown[]).length).toBe(2)

    const { planItems } = aggregate(events)
    const texts = planItems.map((p) => p.text)
    expect(texts).toContain('写代码')
    expect(texts).toContain('第一步')
    // in_progress 状态保留
    expect(planItems.find((p) => p.text === '写代码')?.status).toBe('in_progress')
  })

  it('最新快照覆盖：只反映传入的当前 todos', () => {
    const u = makeMessage({ id: 'u', role: 'user', turn_id: 't1' })
    const events = storeToRawEvents(
      buildInput([{ msg: u, parts: [part('u', 'text', 'x')] }], {
        todos: [{ id: '9', content: '最新任务', status: 'completed' }],
      }),
    )
    const todos = (events.find((e) => e.kind === 'todo')?.payload.input as { todos: Array<{ content: string }> }).todos
    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe('最新任务')
  })
})

// ── TC-AIT-229-01：adapter 选择进入注意力轨迹 ───────────────────────────────
describe('TC-AIT-229-01 交互选择映射', () => {
  it('interaction request/response 会转成 assistant 提问与 user choice 事件', () => {
    const u = makeMessage({ id: 'u', role: 'user', turn_id: 't1', started_at: 1000 })
    const a = makeMessage({ id: 'a', role: 'assistant', turn_id: 't1', started_at: 2000 })
    const events = storeToRawEvents(
      buildInput([
        { msg: u, parts: [part('u', 'text', '帮我搭一个平台')] },
        { msg: a, parts: [part('a', 'text', '请选择技术栈')] },
      ], {
        interactions: [{
          interactionId: 'toolu_choice_1',
          messageId: 'a',
          topicId: 'topic-1',
          interactionKind: 'choice',
          prompt: '技术栈用哪套？',
          options: ['Next.js — 前后端一体', 'Hono — API 优先'],
          status: 'resolved',
          response: 'Next.js — 前后端一体',
        }],
      }),
    )
    const request = events.find((e) => e.id === 'interaction_request_toolu_choice_1')
    const response = events.find((e) => e.id === 'interaction_response_toolu_choice_1')
    expect(request?.role).toBe('assistant')
    expect(request?.payload.assistant_action).toBe('options')
    expect(request?.payload.text).toContain('技术栈用哪套')
    expect(response?.role).toBe('user')
    expect(response?.payload.user_kind).toBe('choice')
    expect(response?.payload.text).toContain('Next.js')

    const { candidates } = aggregate(events)
    expect(candidates.some((c) => c.user_kind === 'choice' && c.user_message.includes('Next.js'))).toBe(true)
  })
})

// ── TC-AIT-219-05：aggregate ≤12 + goalAnchor ────────────────────────────────
describe('TC-AIT-219-05 候选数上限 + 目标锚点', () => {
  it('20 个用户回合压到 ≤12 个候选节点', () => {
    const rows: Array<{ msg: Message; parts: MessagePart[] }> = []
    for (let i = 1; i <= 20; i++) {
      const u = makeMessage({ id: `u${i}`, role: 'user', turn_id: `t${i}` })
      const a = makeMessage({ id: `a${i}`, role: 'assistant', turn_id: `t${i}` })
      rows.push({ msg: u, parts: [part(`u${i}`, 'text', `第 ${i} 个独立问题，需要单独处理的内容 ${i}`)] })
      rows.push({ msg: a, parts: [part(`a${i}`, 'text', `回答 ${i}`)] })
    }
    const { candidates } = aggregate(storeToRawEvents(buildInput(rows)))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(12)
  })

  it('goalAnchor = 第一条 user 消息文本', () => {
    const s = makeMessage({ id: 's', role: 'system', turn_id: 't0' })
    const u1 = makeMessage({ id: 'u1', role: 'user', turn_id: 't1' })
    const u2 = makeMessage({ id: 'u2', role: 'user', turn_id: 't2' })
    const input = buildInput([
      { msg: s, parts: [part('s', 'text', '系统提示')] },
      { msg: u1, parts: [part('u1', 'text', '我的原始目标：修复登录') ] },
      { msg: u2, parts: [part('u2', 'text', '再补一句')] },
    ])
    const anchor = extractGoalAnchor(input)
    expect(anchor?.raw_query).toBe('我的原始目标：修复登录')
    expect(anchor?.normalized_goal).toBe('我的原始目标：修复登录')
  })
})

// ── TC-AIT-219-06：增量重跑骨架稳定 ──────────────────────────────────────────
describe('TC-AIT-219-06 增量稳定', () => {
  it('追加第 3 个回合后，前两个候选节点 id/user_message 不变', () => {
    const mk = (i: number) => [
      { msg: makeMessage({ id: `u${i}`, role: 'user' as const, turn_id: `t${i}` }), parts: [part(`u${i}`, 'text', `问题 ${i}`)] },
      { msg: makeMessage({ id: `a${i}`, role: 'assistant' as const, turn_id: `t${i}` }), parts: [part(`a${i}`, 'text', `答 ${i}`)] },
    ]
    const rows2 = [...mk(1), ...mk(2)]
    const first = aggregate(storeToRawEvents(buildInput(rows2))).candidates
    expect(first).toHaveLength(2)

    const rows3 = [...rows2, ...mk(3)]
    const second = aggregate(storeToRawEvents(buildInput(rows3))).candidates
    expect(second).toHaveLength(3)

    // 前两个节点保持稳定
    expect(second[0].id).toBe(first[0].id)
    expect(second[1].id).toBe(first[1].id)
    expect(second[0].user_message).toBe(first[0].user_message)
    expect(second[1].user_message).toBe(first[1].user_message)
  })
})
