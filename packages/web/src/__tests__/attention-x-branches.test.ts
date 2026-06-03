import { describe, expect, it } from 'vitest'
import type { TraceNode } from '../lib/attention'
import { projectBranches } from '../lib/attention/branch-projector'

function node(id: string, goalDistance: number, userKind: TraceNode['user_kind'] = 'instruction'): TraceNode {
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
    goal_distance: goalDistance,
    status: 'done',
    event_ids: [id],
    step_count: 1,
    user_kind: userKind,
    ts_start: 0,
    ts_end: 1,
  }
}

describe('attention-x branch projection', () => {
  it('keeps goal-aligned nodes on the main chain and moves unrelated work to a side branch', () => {
    const projection = projectBranches([
      node('goal', 0.05),
      node('root-cause', 0.2),
      node('unrelated-question', 0.76, 'question'),
      node('unrelated-follow-up', 0.82),
      node('fix', 0.18),
    ])

    expect(projection.branchCount).toBe(1)
    expect(projection.nodes.map((n) => [n.id, n.branch_id, n.parentMainId])).toEqual([
      ['goal', 'main', null],
      ['root-cause', 'main', null],
      ['unrelated-question', 'side_1', 'root-cause'],
      ['unrelated-follow-up', 'side_1', 'root-cause'],
      ['fix', 'main', null],
    ])
    expect(projection.edges.map((e) => [e.source, e.target, e.kind])).toEqual([
      ['goal', 'root-cause', 'progress'],
      ['root-cause', 'unrelated-question', 'branch'],
      ['unrelated-question', 'unrelated-follow-up', 'progress'],
      ['root-cause', 'fix', 'progress'],
      ['unrelated-follow-up', 'fix', 'return'],
    ])
  })
})
