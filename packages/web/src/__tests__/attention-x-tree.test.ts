import { describe, expect, it } from 'vitest'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import { buildAttentionTree } from '../lib/attention/tree-projector'

const GOAL: GoalAnchor = { raw_query: '修复支付回调', normalized_goal: '修复支付回调', ts: 0 }

function node(over: Partial<TraceNode> = {}): TraceNode {
  return {
    id: over.id ?? 'n1',
    parent_id: null,
    branch_id: 'main',
    user_message: over.user_message ?? '先看回调日志',
    intent: '',
    rationale: null,
    conclusion: over.conclusion ?? '定位回调失败',
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: over.goal_distance ?? 0.2,
    status: over.status ?? 'done',
    event_ids: ['evt1'],
    step_count: 1,
    ts_start: 0,
    ts_end: 1,
    exchanges: over.exchanges ?? [
      {
        id: 'ex1',
        user_message: '先看回调日志',
        user_kind: 'instruction',
        assistant_summary: '发现签名校验失败',
        assistant_actions: ['solve'],
        event_ids: ['evt1'],
        tool_count: 2,
        ts_start: 0,
        ts_end: 1,
      },
      {
        id: 'ex2',
        user_message: '选方案 B',
        user_kind: 'choice',
        assistant_summary: '改为兼容旧签名',
        assistant_actions: ['solve'],
        event_ids: ['evt2'],
        tool_count: 1,
        ts_start: 1,
        ts_end: 2,
      },
    ],
    ...over,
  }
}

describe('attention-x tree projection', () => {
  it('projects goal and phase nodes by default', () => {
    const tree = buildAttentionTree([node({ id: 'n1' }), node({ id: 'n2' })], GOAL)
    expect(tree.nodes.map((n) => n.kind)).toEqual(['goal', 'phase', 'phase'])
    expect(tree.edges).toHaveLength(2)
    expect(tree.nodes[0].title).toBe('修复支付回调')
  })

  it('expands phase nodes into exchange children on demand', () => {
    const tree = buildAttentionTree([node({ id: 'n1' })], GOAL, new Set(['phase_n1']))
    expect(tree.nodes.map((n) => n.kind)).toEqual(['goal', 'phase', 'exchange', 'exchange'])
    expect(tree.nodes.find((n) => n.id === 'exchange_ex2')?.title).toBe('选择：选方案 B')
    expect(tree.edges.map((e) => `${e.source}->${e.target}`)).toContain('phase_n1->exchange_ex2')
  })
})
