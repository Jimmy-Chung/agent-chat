import { describe, expect, it } from 'vitest'
import type { PlanItem, TraceNode } from '../lib/attention'
import { projectPlanGraph } from '../lib/attention/plan-projector'

const planItems: PlanItem[] = [
  { id: 'p1', text: '定位登录 token 失效根因', status: 'completed', depth: 0 },
  { id: 'p2', text: '修复登录 token 刷新逻辑', status: 'in_progress', depth: 0 },
  { id: 'p3', text: '补充回归测试', status: 'pending', depth: 1 },
]

function node(id: string, over: Partial<TraceNode>): TraceNode {
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: '',
    intent: '',
    rationale: null,
    conclusion: null,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [id],
    source_message_ids: [id],
    step_count: 1,
    ts_start: 0,
    ts_end: 1,
    ...over,
  }
}

describe('attention-x plan projection', () => {
  it('attaches trace nodes to plan items and keeps unmatched work in inbox', () => {
    const graph = projectPlanGraph(planItems, [
      node('n1', { planned_ref: 'p1', user_message: '先定位问题' }),
      node('n2', { user_message: '修改 token 刷新逻辑', conclusion: '刷新逻辑修好了' }),
      node('n3', { user_message: '顺手看一下主题色' }),
    ])

    expect(graph.items.find((item) => item.id === 'p1')?.nodeIds).toEqual(['n1'])
    expect(graph.items.find((item) => item.id === 'p2')?.nodeIds).toEqual(['n2'])
    expect(graph.items.find((item) => item.id === 'p3')?.nodeIds).toEqual([])
    expect(graph.inboxNodeIds).toEqual(['n3'])
  })
})
