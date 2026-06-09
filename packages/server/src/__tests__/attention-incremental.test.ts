import { describe, it, expect } from 'vitest'
import type { CandidateNode, GoalAnchor } from '@agent-chat/protocol'
import {
  candidateFreezeKey,
  buildFrozenInterpMap,
  planIncrementalInterpret,
  mergeInterpret,
  resolveGoalPinning,
} from '../services/attention-incremental'

function cand(id: string, sourceMessageIds: string[]): CandidateNode {
  return {
    id,
    user_message: `msg-${id}`,
    user_messages: [`msg-${id}`],
    user_kind: 'question',
    exchanges: [],
    source_message_ids: sourceMessageIds,
    turn_id: `turn-${id}`,
    thinking: [],
    tools: [],
    messages: [],
    assistant_actions: [],
    ts_start: 0,
    ts_end: 0,
  }
}

function interpretJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    conclusion: ['c0', 'c1'],
    goalAlignment: [8, 3],
    userSummary: ['u0', 'u1'],
    assistantSummary: ['a0', 'a1'],
    aggregateTitle: ['t0', 't1'],
    sameTopic: [true, false],
    closeCurrentTopic: [false, true],
    nodeReason: ['r0', 'r1'],
    normalizedGoal: 'G',
    ...over,
  })
}

describe('candidateFreezeKey', () => {
  it('排序后拼接，与顺序无关', () => {
    expect(candidateFreezeKey(['b', 'a', 'c'])).toBe('a|b|c')
    expect(candidateFreezeKey(['c', 'b', 'a'])).toBe('a|b|c')
  })
  it('空集合返回空字符串（不冻结）', () => {
    expect(candidateFreezeKey([])).toBe('')
    expect(candidateFreezeKey(undefined)).toBe('')
  })
})

describe('buildFrozenInterpMap', () => {
  it('按 source_message_ids 集合建冻结表', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1']), cand('cand_2', ['m2', 'm3'])])
    const map = buildFrozenInterpMap(candidatesJson, interpretJson())
    expect(map.size).toBe(2)
    const f0 = map.get('m1')
    expect(f0?.conclusion).toBe('c0')
    expect(f0?.goalAlignment).toBe(8)
    expect(f0?.aggregateTitle).toBe('t0')
    expect(map.get('m2|m3')?.conclusion).toBe('c1')
  })
  it('解析异常返回空表（退回全量）', () => {
    expect(buildFrozenInterpMap('not-json', '{}').size).toBe(0)
    expect(buildFrozenInterpMap('[]', 'not-json').size).toBe(0)
  })
  it('缺 conclusion 数组返回空表', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1'])])
    expect(buildFrozenInterpMap(candidatesJson, '{}').size).toBe(0)
  })
})

describe('planIncrementalInterpret', () => {
  it('命中冻结的复用、未命中的进 pending', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1']), cand('cand_2', ['m2'])])
    const frozen = buildFrozenInterpMap(candidatesJson, interpretJson())
    // 当前候选：m1（旧，冻结）+ m9（新）
    const candidates = [cand('cand_1', ['m1']), cand('cand_x', ['m9'])]
    const { pending, pendingIdx } = planIncrementalInterpret(candidates, frozen)
    expect(pending.map((c) => c.id)).toEqual(['cand_x'])
    expect(pendingIdx).toEqual([1])
  })
  it('全部命中时 pending 为空（可跳过 LLM）', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1']), cand('cand_2', ['m2'])])
    const frozen = buildFrozenInterpMap(candidatesJson, interpretJson())
    const candidates = [cand('cand_1', ['m1']), cand('cand_2', ['m2'])]
    expect(planIncrementalInterpret(candidates, frozen).pending.length).toBe(0)
  })
})

describe('mergeInterpret', () => {
  it('按 candidates 顺序交织冻结与新 LLM 结果', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1'])])
    const frozen = buildFrozenInterpMap(candidatesJson, interpretJson({ conclusion: ['FROZEN'], goalAlignment: [9] }))
    // 候选：m9（新，下标0） + m1（旧冻结，下标1）
    const candidates = [cand('cand_x', ['m9']), cand('cand_1', ['m1'])]
    const { pendingIdx } = planIncrementalInterpret(candidates, frozen)
    expect(pendingIdx).toEqual([0])
    const llm = { conclusion: ['NEW'], goalAlignment: [2] }
    const merged = mergeInterpret(candidates, frozen, pendingIdx, llm, 'PINNED')
    expect(merged.conclusion).toEqual(['NEW', 'FROZEN'])
    expect(merged.goalAlignment).toEqual([2, 9])
    expect(merged.normalizedGoal).toBe('PINNED')
  })
  it('全冻结、无 LLM 时也能产出全长数组', () => {
    const candidatesJson = JSON.stringify([cand('cand_1', ['m1']), cand('cand_2', ['m2'])])
    const frozen = buildFrozenInterpMap(candidatesJson, interpretJson())
    const candidates = [cand('cand_1', ['m1']), cand('cand_2', ['m2'])]
    const merged = mergeInterpret(candidates, frozen, [], null, 'G')
    expect(merged.conclusion).toEqual(['c0', 'c1'])
    expect(merged.goalAlignment).toEqual([8, 3])
  })
})

describe('resolveGoalPinning', () => {
  const anchor: GoalAnchor = { raw_query: '目标A', normalized_goal: '目标A', ts: 0 }
  it('无历史视为目标变更，用 LLM 归一化', () => {
    const r = resolveGoalPinning({ currentAnchor: anchor, prevGoalJson: null, llmNormalizedGoal: '归一A' })
    expect(r.goalChanged).toBe(true)
    expect(r.pinnedNormalizedGoal).toBe('归一A')
  })
  it('目标未变：钉死旧归一化，忽略本次 LLM 措辞', () => {
    const prev = JSON.stringify({ raw_query: '目标A', normalized_goal: '旧归一', ts: 0 })
    const r = resolveGoalPinning({ currentAnchor: anchor, prevGoalJson: prev, llmNormalizedGoal: '新措辞' })
    expect(r.goalChanged).toBe(false)
    expect(r.pinnedNormalizedGoal).toBe('旧归一')
  })
  it('目标已变：用本次 LLM 归一化', () => {
    const prev = JSON.stringify({ raw_query: '旧目标', normalized_goal: '旧归一', ts: 0 })
    const r = resolveGoalPinning({ currentAnchor: anchor, prevGoalJson: prev, llmNormalizedGoal: '新归一' })
    expect(r.goalChanged).toBe(true)
    expect(r.pinnedNormalizedGoal).toBe('新归一')
  })
})
