import type { GoalAnchor, PlanItem, TraceNode } from './types'
import { projectChoices } from './choice-projector'
import { projectPlanGraph } from './plan-projector'

export type ConversationTreeNodeKind = 'goal' | 'topic' | 'turn' | 'plan' | 'decision'
export type ConversationRelation = 'main' | 'branch'
export type CollapseReason = 'resolved' | 'topic_shift' | 'too_long' | 'inactive' | null

export interface AggregationInfo {
  reason: CollapseReason
  childCount: number
  turnCount: number
  toolCount: number
  sourceTitles: string[]
}

export interface ConversationTreeNode {
  id: string
  kind: ConversationTreeNodeKind
  parentId: string | null
  childIds: string[]
  relation: ConversationRelation
  title: string
  summary: string
  sourceNodeIds: string[]
  goalDistance: number
  status: TraceNode['status']
  collapsed: boolean
  active: boolean
  current: boolean
  depth: number
  aggregation: AggregationInfo | null
  order: number
}

export interface ConversationTree {
  rootId: string
  nodes: Record<string, ConversationTreeNode>
  orderedIds: string[]
}

export interface ConversationTreeOptions {
  topicTurnLimit?: number
  keepExpandedRecentTopics?: number
}

const DEFAULT_TOPIC_TURN_LIMIT = 4
const DEFAULT_KEEP_EXPANDED_RECENT_TOPICS = 2

function compact(text: string | null | undefined, max = 52): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function isSubtopicStart(prev: TraceNode | null, next: TraceNode, currentTopicTurnCount: number): boolean {
  if (!prev) return true
  if (currentTopicTurnCount >= DEFAULT_TOPIC_TURN_LIMIT) return true
  if (next.user_kind === 'proposal') return true
  if (next.user_kind === 'question' && currentTopicTurnCount >= 2) return true
  if (next.goal_distance >= 0.68 && prev.goal_distance < 0.55) return true
  if ((next.ts_start ?? 0) - (prev.ts_end ?? prev.ts_start ?? 0) > 20 * 60 * 1000) return true
  return false
}

function shouldReturnToParent(prev: TraceNode | null, next: TraceNode): boolean {
  if (!prev) return false
  if (next.goal_distance <= 0.35 && prev.goal_distance >= 0.62) return true
  if (next.user_kind === 'instruction' && prev.user_kind === 'question' && next.goal_distance < 0.5) return true
  return false
}

function makeNode(input: Omit<ConversationTreeNode, 'childIds'>): ConversationTreeNode {
  return { ...input, childIds: [] }
}

function appendNode(tree: ConversationTree, node: ConversationTreeNode): void {
  tree.nodes[node.id] = node
  tree.orderedIds.push(node.id)
  if (node.parentId) tree.nodes[node.parentId]?.childIds.push(node.id)
}

function nearestTopic(tree: ConversationTree, id: string | null): ConversationTreeNode | null {
  let current = id ? tree.nodes[id] : null
  while (current) {
    if (current.kind === 'topic') return current
    current = current.parentId ? tree.nodes[current.parentId] : null
  }
  return null
}

function markActivePath(tree: ConversationTree, id: string | null): void {
  let current = id ? tree.nodes[id] : null
  while (current) {
    current.active = true
    current = current.parentId ? tree.nodes[current.parentId] : null
  }
}

function collapseFinishedTopics(tree: ConversationTree, opts: Required<ConversationTreeOptions>): void {
  const topics = tree.orderedIds.map((id) => tree.nodes[id]).filter((node) => node.kind === 'topic')
  const recentTopics = new Set(topics.slice(-opts.keepExpandedRecentTopics).map((node) => node.id))
  for (const topic of topics) {
    if (topic.aggregation?.reason === 'resolved' || topic.aggregation?.reason === 'topic_shift') {
      topic.collapsed = !topic.active
      continue
    }
    const turnCount = topic.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length
    const tooLong = turnCount > opts.topicTurnLimit
    const inactive = !topic.active && !recentTopics.has(topic.id)
    topic.collapsed = tooLong || inactive
    if (topic.collapsed) {
      topic.aggregation = {
        reason: tooLong ? 'too_long' : 'inactive',
        childCount: topic.childIds.length,
        turnCount,
        toolCount: 0,
        sourceTitles: topic.childIds.map((id) => tree.nodes[id]?.title).filter(Boolean).slice(0, 8),
      }
    }
  }
}

function aggregateTopicMetadata(tree: ConversationTree): void {
  for (const id of [...tree.orderedIds].reverse()) {
    const node = tree.nodes[id]
    if (node.kind !== 'topic') continue
    const children = node.childIds.map((childId) => tree.nodes[childId]).filter(Boolean)
    const sourceNodeIds = children.flatMap((child) => child.sourceNodeIds)
    node.sourceNodeIds = sourceNodeIds
    node.goalDistance = children.length ? Math.max(...children.map((child) => child.goalDistance)) : node.goalDistance
    node.status = children.some((child) => child.status === 'running') ? 'running' : node.status
    node.summary = `${children.filter((child) => child.kind === 'turn').length} 轮 · ${compact(children.at(-1)?.title, 28)}`
    const turnChildren = children.filter((child) => child.kind === 'turn')
    const childToolCount = turnChildren.reduce((sum, child) => sum + child.sourceNodeIds.length, 0)
    node.aggregation = node.aggregation
      ? { ...node.aggregation, toolCount: childToolCount }
      : null
  }
}

export function governConversationTree(
  traceNodes: TraceNode[],
  goalAnchor: GoalAnchor | null,
  planItems: PlanItem[],
  options: ConversationTreeOptions = {},
): ConversationTree {
  const opts: Required<ConversationTreeOptions> = {
    topicTurnLimit: options.topicTurnLimit ?? DEFAULT_TOPIC_TURN_LIMIT,
    keepExpandedRecentTopics: options.keepExpandedRecentTopics ?? DEFAULT_KEEP_EXPANDED_RECENT_TOPICS,
  }
  const rootId = 'tree_goal'
  const tree: ConversationTree = {
    rootId,
    nodes: {},
    orderedIds: [],
  }
  appendNode(tree, makeNode({
    id: rootId,
    kind: 'goal',
    parentId: null,
    relation: 'main',
    title: compact(goalAnchor?.normalized_goal || '当前目标', 68),
    summary: `${traceNodes.length} 个对话轨迹节点`,
    sourceNodeIds: traceNodes.map((node) => node.id),
    goalDistance: 0,
    status: traceNodes.some((node) => node.status === 'running') ? 'running' : 'done',
    collapsed: false,
    active: false,
    current: false,
    depth: 0,
    aggregation: null,
    order: 0,
  }))

  let activeTopicId: string | null = null
  let lastTurn: TraceNode | null = null
  let currentTopicTurnCount = 0

  traceNodes.forEach((traceNode, index) => {
    if (activeTopicId && shouldReturnToParent(lastTurn, traceNode)) {
      const activeTopic = tree.nodes[activeTopicId]
      if (activeTopic && !activeTopic.active) {
        activeTopic.collapsed = true
        activeTopic.aggregation = {
          reason: 'resolved',
          childCount: activeTopic.childIds.length,
          turnCount: activeTopic.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length,
          toolCount: 0,
          sourceTitles: activeTopic.childIds.map((id) => tree.nodes[id]?.title).filter(Boolean).slice(0, 8),
        }
      }
      const parentTopic = nearestTopic(tree, activeTopic?.parentId ?? null)
      activeTopicId = parentTopic?.id ?? null
      currentTopicTurnCount = activeTopicId
        ? tree.nodes[activeTopicId].childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length
        : 0
    }

    const activeTopic = activeTopicId ? tree.nodes[activeTopicId] : null
    const capacitySplit = !!activeTopic && currentTopicTurnCount >= opts.topicTurnLimit
    const needNewTopic = !activeTopicId || isSubtopicStart(lastTurn, traceNode, currentTopicTurnCount)
    let topicId = activeTopicId
    if (!topicId || needNewTopic) {
      const parentTopic = capacitySplit ? nearestTopic(tree, activeTopic?.parentId ?? null) : activeTopic
      const relation: ConversationRelation = parentTopic ? 'branch' : 'main'
      topicId = `topic_${relation}_${traceNode.id}`
      if (activeTopic && !activeTopic.active) {
        activeTopic.collapsed = true
        activeTopic.aggregation = {
          reason: capacitySplit ? 'too_long' : 'topic_shift',
          childCount: activeTopic.childIds.length,
          turnCount: activeTopic.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length,
          toolCount: 0,
          sourceTitles: activeTopic.childIds.map((id) => tree.nodes[id]?.title).filter(Boolean).slice(0, 8),
        }
      }
      appendNode(tree, makeNode({
        id: topicId,
        kind: 'topic',
        parentId: parentTopic?.id ?? rootId,
        relation,
        title: parentTopic ? `子话题：${compact(traceNode.user_message, 34)}` : compact(traceNode.conclusion || traceNode.user_message, 42),
        summary: '0 轮',
        sourceNodeIds: [],
        goalDistance: traceNode.goal_distance,
        status: traceNode.status,
        collapsed: false,
        active: false,
        current: false,
        depth: parentTopic ? parentTopic.depth + 1 : 1,
        aggregation: null,
        order: index + 1,
      }))
      activeTopicId = topicId
      currentTopicTurnCount = 0
    }

    const turnId = `turn_${traceNode.id}`
    const topic = tree.nodes[topicId]
    appendNode(tree, makeNode({
      id: turnId,
      kind: 'turn',
      parentId: topicId,
      relation: topic.relation,
      title: compact(traceNode.conclusion || traceNode.user_message, 46),
      summary: compact(traceNode.user_message, 64),
      sourceNodeIds: [traceNode.id],
      goalDistance: traceNode.goal_distance,
      status: traceNode.status,
      collapsed: false,
      active: false,
      current: false,
      depth: topic.depth + 1,
      aggregation: null,
      order: index + 1,
    }))

    currentTopicTurnCount += 1
    lastTurn = traceNode
  })

  const planGraph = projectPlanGraph(planItems, traceNodes)
  for (const item of planGraph.items.filter((entry) => entry.nodeIds.length > 0)) {
    const targetTurnId = `turn_${item.nodeIds[0]}`
    const parentId = tree.nodes[targetTurnId] ? targetTurnId : rootId
    appendNode(tree, makeNode({
      id: `plan_${item.id}`,
      kind: 'plan',
      parentId,
      relation: tree.nodes[parentId]?.relation ?? 'main',
      title: compact(item.text, 48),
      summary: `${item.status} · ${item.nodeIds.length} 个关联节点`,
      sourceNodeIds: item.nodeIds,
      goalDistance: 0.2,
      status: item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'running' : 'pending',
      collapsed: false,
      active: false,
      current: false,
      depth: (tree.nodes[parentId]?.depth ?? 0) + 1,
      aggregation: null,
      order: tree.orderedIds.length,
    }))
  }

  const choiceProjection = projectChoices(traceNodes)
  for (const decision of choiceProjection.decisions) {
    const targetTurnId = `turn_${decision.affectedNodeIds[0]}`
    const parentId = tree.nodes[targetTurnId] ? targetTurnId : rootId
    appendNode(tree, makeNode({
      id: `decision_${decision.id}`,
      kind: 'decision',
      parentId,
      relation: tree.nodes[parentId]?.relation ?? 'main',
      title: compact(decision.question, 48),
      summary: decision.selectedOptionId ? `选择 ${decision.selectedOptionId}` : '未识别选择',
      sourceNodeIds: decision.affectedNodeIds,
      goalDistance: 0.45,
      status: 'done',
      collapsed: false,
      active: false,
      current: false,
      depth: (tree.nodes[parentId]?.depth ?? 0) + 1,
      aggregation: null,
      order: tree.orderedIds.length,
    }))
  }

  aggregateTopicMetadata(tree)
  const lastTurnId = [...tree.orderedIds].reverse().find((id) => tree.nodes[id]?.kind === 'turn') ?? null
  if (lastTurnId) tree.nodes[lastTurnId].current = true
  markActivePath(tree, lastTurnId)
  collapseFinishedTopics(tree, opts)

  for (const node of tree.orderedIds.map((id) => tree.nodes[id])) {
    if (node.kind === 'turn') {
      const topic = nearestTopic(tree, node.parentId)
      if (topic?.collapsed && !node.active) node.collapsed = true
    }
  }

  return tree
}
