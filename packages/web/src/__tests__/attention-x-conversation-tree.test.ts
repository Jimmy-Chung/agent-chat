import { describe, expect, it } from 'vitest'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import { governConversationTree } from '../lib/attention/conversation-tree'
import { buildMindMapProjection } from '../lib/attention/mind-map-projector'

const GOAL: GoalAnchor = { raw_query: '修复登录问题', normalized_goal: '修复登录问题', ts: 0 }

function node(id: string, over: Partial<TraceNode> = {}): TraceNode {
  const order = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: `用户回合 ${id}`,
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
    ts_start: order * 1000,
    ts_end: order * 1000 + 1,
    ...over,
  }
}

describe('attention-x conversation tree governance', () => {
  it('groups long chat turns into collapsed topic nodes while keeping the active topic expanded', () => {
    const tree = governConversationTree([
      node('n1'),
      node('n2'),
      node('n3'),
      node('n4'),
      node('n5'),
      node('n6', { user_kind: 'question' }),
    ], GOAL, [], { topicTurnLimit: 2, keepExpandedRecentTopics: 1 })

    const topics = tree.orderedIds.map((id) => tree.nodes[id]).filter((entry) => entry.kind === 'topic')
    expect(topics.length).toBeGreaterThan(1)
    expect(topics.some((topic) => topic.collapsed)).toBe(true)
    expect(topics.at(-1)?.active).toBe(true)
    expect(topics.at(-1)?.collapsed).toBe(false)
  })

  it('attaches off-goal work as a child topic under the active topic', () => {
    const tree = governConversationTree([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.8, user_kind: 'question' }),
      node('n3', { goal_distance: 0.82 }),
      node('n4', { goal_distance: 0.15 }),
    ], GOAL, [])

    const branchTopic = tree.orderedIds.map((id) => tree.nodes[id]).find((entry) => entry.kind === 'topic' && entry.relation === 'branch')
    expect(branchTopic?.parentId).toBe('topic_main_n1')
    expect(branchTopic?.childIds).toContain('turn_n2')
  })

  it('projects governed tree into a connected mind map with goal/topic/turn nodes', () => {
    const projection = buildMindMapProjection([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.72, user_kind: 'question' }),
    ], GOAL, [])

    expect(projection.nodes.map((entry) => entry.kind)).toContain('goal')
    expect(projection.nodes.map((entry) => entry.kind)).toContain('topic')
    expect(projection.nodes.map((entry) => entry.kind)).toContain('turn')
    expect(projection.edges.length).toBeGreaterThan(0)
    expect(projection.edges.some((edge) => edge.kind === 'branch')).toBe(true)
  })

  it('uses user messages as graph node subjects instead of assistant conclusions', () => {
    const tree = governConversationTree([
      node('n1', { user_message: '用户：我要修登录', conclusion: 'AI：定位 token 过期' }),
    ], GOAL, [])

    expect(tree.nodes.topic_main_n1.title).toContain('用户：我要修登录')
    expect(tree.nodes.topic_main_n1.title).not.toContain('AI：定位')
    expect(tree.nodes.turn_n1.title).toContain('用户：我要修登录')
    expect(tree.nodes.turn_n1.title).not.toContain('AI：定位')
  })

  it('lays out branch and return turns left-to-right by event time', () => {
    const projection = buildMindMapProjection([
      node('n1', { goal_distance: 0.1, user_message: '讨论 A' }),
      node('n2', { goal_distance: 0.8, user_kind: 'question', user_message: '突然讨论 B' }),
      node('n3', { goal_distance: 0.82, user_message: '继续 B' }),
      node('n4', { goal_distance: 0.15, user_kind: 'instruction', user_message: '回到 A' }),
    ], GOAL, [])

    const branch = projection.nodes.find((entry) => entry.id === 'topic_branch_n2')
    const n4 = projection.nodes.find((entry) => entry.id === 'turn_n4')
    expect(branch?.position.x).toBeLessThan(n4?.position.x ?? 0)
    expect(branch?.position.y).toBeGreaterThan(projection.nodes.find((entry) => entry.id === 'turn_n1')?.position.y ?? 0)
    expect(branch?.title).toContain('突然讨论 B')
  })

  it('archives a resolved child topic and marks the latest turn as current', () => {
    const tree = governConversationTree([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.78, user_kind: 'question' }),
      node('n3', { goal_distance: 0.82 }),
      node('n4', { goal_distance: 0.18, user_kind: 'instruction' }),
    ], GOAL, [], { topicTurnLimit: 3, keepExpandedRecentTopics: 1 })

    const branchTopic = tree.orderedIds.map((id) => tree.nodes[id]).find((entry) => entry.kind === 'topic' && entry.relation === 'branch')
    expect(branchTopic?.collapsed).toBe(true)
    expect(branchTopic?.aggregation?.reason).toBe('resolved')
    expect(tree.nodes.turn_n4.current).toBe(true)
    expect(tree.nodes.turn_n4.active).toBe(true)
  })
})
