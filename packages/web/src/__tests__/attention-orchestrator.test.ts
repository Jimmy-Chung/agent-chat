import { describe, it, expect } from 'vitest'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { storeToRawEvents, aggregate, type CandidateNode } from '../lib/attention'
import {
  planInterpret,
  makeInterpretKey,
  buildTrace,
  buildInterpretPrompt,
  callInterpret,
} from '../lib/attention/orchestrator'
import { computeGoalDistance } from '../lib/attention/goal-distance'
import type { GoalAnchor } from '../lib/attention'

// ── helpers：用 S1 适配器+聚合产出真实 candidates ───────────────────────────
let _id = 0
function msg(role: Message['role'], turn: string): Message {
  _id++
  return {
    id: `m${_id}`,
    topic_id: 't',
    role,
    status: 'done',
    started_at: 1000 * _id,
    finished_at: 1000 * _id + 1,
    stop_reason: null,
    cron_run_id: null,
    turn_id: turn,
    client_message_id: null,
    retry_count: 0,
    max_retries: 0,
  }
}
function textPart(mid: string, content: string): MessagePart {
  _id++
  return { id: `p${_id}`, message_id: mid, ordinal: 0, kind: 'text', content_json: JSON.stringify({ content }) }
}

function candidatesFrom(pairs: Array<[string, string]>): CandidateNode[] {
  const messages: Message[] = []
  const partsByMessage: Record<string, MessagePart[]> = {}
  pairs.forEach(([uText, aText], i) => {
    const u = msg('user', `t${i + 1}`)
    const a = msg('assistant', `t${i + 1}`)
    messages.push(u, a)
    partsByMessage[u.id] = [textPart(u.id, uText)]
    partsByMessage[a.id] = [textPart(a.id, aText)]
  })
  return aggregate(storeToRawEvents({ messages, partsByMessage })).candidates
}

const GOAL: GoalAnchor = { raw_query: '修复 SSE 端口泄漏', normalized_goal: '修复 SSE 端口泄漏', ts: 0 }

// ── TC-AIT-221-01：turn 落定才触发；delta 期间不触发 ─────────────────────────
describe('TC-AIT-221-01 触发时机', () => {
  it('processing 中不触发；idle 才触发', () => {
    expect(
      planInterpret({ candidateCount: 2, lastEventTs: 100, agentStatus: 'processing', lastInterpretedKey: null }).shouldCall,
    ).toBe(false)
    expect(
      planInterpret({ candidateCount: 2, lastEventTs: 100, agentStatus: 'aborting', lastInterpretedKey: null }).shouldCall,
    ).toBe(false)
    expect(
      planInterpret({ candidateCount: 2, lastEventTs: 100, agentStatus: 'idle', lastInterpretedKey: null }).shouldCall,
    ).toBe(true)
  })

  it('无候选节点不触发', () => {
    expect(
      planInterpret({ candidateCount: 0, lastEventTs: 0, agentStatus: 'idle', lastInterpretedKey: null }).shouldCall,
    ).toBe(false)
  })
})

// ── TC-AIT-221-02：缓存命中不二次调用 ────────────────────────────────────────
describe('TC-AIT-221-02 缓存命中', () => {
  it('同 cacheKey（候选数+末事件 ts 不变）→ 不重复调用', () => {
    const key = makeInterpretKey(3, 5000)
    const r = planInterpret({ candidateCount: 3, lastEventTs: 5000, agentStatus: 'idle', lastInterpretedKey: key })
    expect(r.cacheKey).toBe(key)
    expect(r.shouldCall).toBe(false)
  })

  it('轨迹变化（末事件 ts 变）→ 重新调用', () => {
    const key = makeInterpretKey(3, 5000)
    expect(
      planInterpret({ candidateCount: 3, lastEventTs: 6000, agentStatus: 'idle', lastInterpretedKey: key }).shouldCall,
    ).toBe(true)
  })
})

// ── TC-AIT-226-01：server 失败 → 不进入本地语义兜底 ─────────────────────────
describe('TC-AIT-226-01 LLM 不可用', () => {
  it('callInterpret 遇到 degraded 响应 → null', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, degraded: true, reason: 'not_configured' }), { status: 200 })) as unknown as typeof fetch
    const r = await callInterpret('p', { serverBase: 'https://s', fetchImpl, timeoutMs: 500 })
    expect(r).toBeNull()
  })

  it('callInterpret 网络异常 → null', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const r = await callInterpret('p', { serverBase: 'https://s', fetchImpl, timeoutMs: 500 })
    expect(r).toBeNull()
  })
})

// ── TC-AIT-221-04：进行中节点「分析中」，落定后替换为 LLM 结果 ───────────────
describe('TC-AIT-221-04 进行中 → 落定', () => {
  const cands = candidatesFrom([
    ['修复端口泄漏', '定位根因'],
    ['继续验证', '正在跑回归'],
  ])

  it('inProgress：最后一个节点 running + is_loading', () => {
    const nodes = buildTrace(cands, GOAL, null, { inProgress: true })
    expect(nodes[nodes.length - 1].status).toBe('running')
    expect(nodes[nodes.length - 1].is_loading).toBe(true)
    // 前序节点不受影响
    expect(nodes[0].status).toBe('done')
  })

  it('落定 + 有 LLM 结果：结论被替换，状态 done', () => {
    const nodes = buildTrace(cands, GOAL, { conclusion: ['锁定泄漏点', '回归通过'], goalAlignment: [9, 2] }, { inProgress: false })
    expect(nodes[0].conclusion).toBe('锁定泄漏点')
    expect(nodes[1].conclusion).toBe('回归通过')
    expect(nodes[1].status).toBe('done')
    expect(nodes[1].is_loading).toBe(false)
    // goalAlignment 2 → distance 0.8
    expect(nodes[1].goal_distance).toBeCloseTo(0.8, 5)
  })
})

// ── TC-AIT-229-02：LLM 语义摘要驱动节点标题/结论 ────────────────────────────
describe('TC-AIT-229-02 语义节点摘要', () => {
  it('buildTrace 使用 userSummary / assistantSummary / aggregateTitle，而不是照搬原文', () => {
    const cands = candidatesFrom([
      [
        '那我如何注册平台呢，比如我要一个叫 helm 的平台，它需要注册成为这个 token 中心的成员',
        '可以设计平台注册表、券码购买和应用校验链路。',
      ],
    ])
    const nodes = buildTrace(cands, GOAL, {
      conclusion: ['注册方案'],
      goalAlignment: [8],
      userSummary: ['如何管理业务平台在 token 中心的注册'],
      assistantSummary: ['设计平台注册、券码购买与应用校验方案'],
      aggregateTitle: ['平台接入 token 中心'],
      sameTopic: [true],
      closeCurrentTopic: [true],
      nodeReason: ['AI 已给出完整接入方案'],
      normalizedGoal: '管理平台接入 token 中心',
    })

    expect(nodes[0].user_message).toBe('如何管理业务平台在 token 中心的注册')
    expect(nodes[0].intent).toBe('平台接入 token 中心')
    expect(nodes[0].conclusion).toBe('设计平台注册、券码购买与应用校验方案')
    expect(nodes[0].same_topic).toBe(true)
    expect(nodes[0].close_current_topic).toBe(true)
    expect(nodes[0].rationale).toBe('AI 已给出完整接入方案')
  })

  it('buildInterpretPrompt 包含交互选择和工具输入，要求输出语义字段', () => {
    const cands = candidatesFrom([
      ['用户选择：Next.js — 前后端一体', '继续按 Next.js 方案推进'],
    ])
    cands[0].tools.push({
      id: 'tool-1',
      ts: 3000,
      kind: 'tool_use',
      role: 'assistant',
      payload: { name: 'Read', input: { path: '/workspace/app.ts' }, output: 'export const x = 1' },
    })
    const prompt = buildInterpretPrompt(cands, GOAL)
    expect(prompt).toContain('用户选择：Next.js')
    expect(prompt).toContain('input={"path":"/workspace/app.ts"}')
    expect(prompt).toContain('userSummary')
    expect(prompt).toContain('sameTopic')
  })
})

// ── 附：goal-distance cosine 合理性 ──────────────────────────────────────────
describe('goal-distance cosine', () => {
  it('贴目标文本距离 < 偏离文本距离', () => {
    const goal = '修复 SSE 端口泄漏'
    const aligned = computeGoalDistance(goal, '定位端口泄漏根因并修复')
    const off = computeGoalDistance(goal, '查询数据库表结构与字段类型')
    expect(aligned).toBeLessThan(off)
  })

  it('空文本 → 0.5 中性', () => {
    expect(computeGoalDistance('', 'x')).toBe(0.5)
    expect(computeGoalDistance('x', '')).toBe(0.5)
  })
})
