import { describe, expect, it } from 'vitest'
import type { TraceExchange, TraceNode } from '../lib/attention'
import { projectChoices } from '../lib/attention/choice-projector'

function exchange(over: Partial<TraceExchange>): TraceExchange {
  return {
    id: over.id ?? 'ex',
    user_message: over.user_message ?? '',
    user_kind: over.user_kind ?? 'instruction',
    assistant_summary: over.assistant_summary ?? '',
    assistant_actions: over.assistant_actions ?? [],
    event_ids: [],
    tool_count: 0,
    ts_start: 0,
    ts_end: 1,
    ...over,
  }
}

function node(id: string, exchanges: TraceExchange[]): TraceNode {
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: id,
    intent: '',
    rationale: null,
    conclusion: id,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [],
    step_count: 1,
    ts_start: 0,
    ts_end: 1,
    exchanges,
  }
}

describe('attention-x choice projection', () => {
  it('links assistant options, user choice, and following work', () => {
    const projection = projectChoices([
      node('n1', [
        exchange({
          id: 'ask',
          user_message: '怎么修？',
          user_kind: 'question',
          assistant_summary: '三个方案：A. 热修配置 B. 改 provider 透传 C. 重构 adapter',
          assistant_actions: ['ask', 'options'],
        }),
        exchange({
          id: 'choice',
          user_message: '选 B',
          user_kind: 'choice',
          assistant_summary: '采用 provider 透传',
          assistant_actions: ['solve'],
        }),
      ]),
      node('n2', [exchange({ id: 'work', user_message: '开始改', assistant_summary: '完成修改' })]),
    ])

    expect(projection.decisions).toHaveLength(1)
    expect(projection.decisions[0].selectedOptionId).toBe('B')
    expect(projection.decisions[0].options.map((o) => [o.id, o.selected])).toEqual([
      ['A', false],
      ['B', true],
      ['C', false],
    ])
    expect(projection.decisions[0].affectedNodeIds).toEqual(['n1', 'n2'])
  })
})
