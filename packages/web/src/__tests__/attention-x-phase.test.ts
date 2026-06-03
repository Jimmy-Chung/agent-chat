import { describe, expect, it } from 'vitest'
import type { TraceNode } from '../lib/attention'
import { projectPhases } from '../lib/attention/phase-projector'

function node(id: string, over: Partial<TraceNode> = {}): TraceNode {
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: `消息 ${id}`,
    intent: '',
    rationale: null,
    conclusion: `结论 ${id}`,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [id],
    step_count: 1,
    user_kind: 'instruction',
    user_message_count: 1,
    ts_start: Number(id.replace(/\D/g, '')) * 1000,
    ts_end: Number(id.replace(/\D/g, '')) * 1000 + 1,
    ...over,
  }
}

describe('attention-x phase projection', () => {
  it('compresses low-boundary turns into expandable phase nodes', () => {
    const projection = projectPhases([
      node('n1'),
      node('n2', { user_kind: 'choice' }),
      node('n3', { user_kind: 'evidence' }),
      node('n4', { user_kind: 'question' }),
      node('n5'),
    ])

    expect(projection.phases).toHaveLength(2)
    expect(projection.compressedCount).toBe(3)
    expect(projection.phases[0].children.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(projection.phases[1].children.map((n) => n.id)).toEqual(['n4', 'n5'])
    expect(projection.phases[0].collapsed).toBe(true)
  })

  it('keeps high goal-distance shifts as phase boundaries', () => {
    const projection = projectPhases([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.8 }),
      node('n3', { goal_distance: 0.85 }),
    ])

    expect(projection.phases).toHaveLength(2)
    expect(projection.phases[1].goal_distance).toBe(0.85)
  })
})
