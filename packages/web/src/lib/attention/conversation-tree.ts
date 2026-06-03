import type { GoalAnchor, PlanItem, TraceNode } from './types'
import { projectChoices } from './choice-projector'
import { projectPlanGraph } from './plan-projector'

export type ConversationTreeNodeKind = 'goal' | 'topic' | 'turn' | 'plan' | 'decision'
export type ConversationRelation = 'main' | 'branch'

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

function isBranchTurn(node: TraceNode): boolean {
  if (node.branch_id !== 'main') return true
  if (node.goal_distance >= 0.68) return true
  if ((node.user_kind === 'question' || node.user_kind === 'proposal') && node.goal_distance >= 0.48) return true
  return false
}

function startsNewTopic(prev: TraceNode | null, next: TraceNode, currentTopicTurnCount: number): boolean {
  if (!prev) return true
  if (currentTopicTurnCount >= DEFAULT_TOPIC_TURN_LIMIT) return true
  if (next.user_kind === 'proposal') return true
  if (next.user_kind === 'question' && currentTopicTurnCount >= 2) return true
  if (Math.abs(next.goal_distance - prev.goal_distance) >= 0.45) return true
  if ((next.ts_start ?? 0) - (prev.ts_end ?? prev.ts_start ?? 0) > 20 * 60 * 1000) return true
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
  const activeTopics = new Set(topics.filter((node) => node.active).map((node) => node.id))
  const recentTopics = new Set(topics.slice(-opts.keepExpandedRecentTopics).map((node) => node.id))
  for (const topic of topics) {
    const turnCount = topic.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length
    topic.collapsed = turnCount > opts.topicTurnLimit || (!activeTopics.has(topic.id) && !recentTopics.has(topic.id))
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
    order: 0,
  }))

  let currentMainTopicId: string | null = null
  let currentBranchTopicId: string | null = null
  let lastMainTurnId: string | null = null
  let lastTurn: TraceNode | null = null
  let mainTopicTurnCount = 0
  let branchTopicTurnCount = 0

  traceNodes.forEach((traceNode, index) => {
    const branch = isBranchTurn(traceNode)
    const relation: ConversationRelation = branch ? 'branch' : 'main'
    const currentTopicId = branch ? currentBranchTopicId : currentMainTopicId
    const currentCount = branch ? branchTopicTurnCount : mainTopicTurnCount
    const needNewTopic = startsNewTopic(lastTurn, traceNode, currentCount)
    const topicParentId = branch ? (lastMainTurnId ?? currentMainTopicId ?? rootId) : rootId

    let topicId = currentTopicId
    if (!topicId || needNewTopic) {
      topicId = `topic_${relation}_${traceNode.id}`
      appendNode(tree, makeNode({
        id: topicId,
        kind: 'topic',
        parentId: topicParentId,
        relation,
        title: branch ? `支线：${compact(traceNode.user_message, 34)}` : compact(traceNode.conclusion || traceNode.user_message, 42),
        summary: '0 轮',
        sourceNodeIds: [],
        goalDistance: traceNode.goal_distance,
        status: traceNode.status,
        collapsed: false,
        active: false,
        order: index + 1,
      }))
      if (branch) {
        currentBranchTopicId = topicId
        branchTopicTurnCount = 0
      } else {
        currentMainTopicId = topicId
        currentBranchTopicId = null
        mainTopicTurnCount = 0
      }
    }

    const turnId = `turn_${traceNode.id}`
    appendNode(tree, makeNode({
      id: turnId,
      kind: 'turn',
      parentId: topicId,
      relation,
      title: compact(traceNode.conclusion || traceNode.user_message, 46),
      summary: compact(traceNode.user_message, 64),
      sourceNodeIds: [traceNode.id],
      goalDistance: traceNode.goal_distance,
      status: traceNode.status,
      collapsed: false,
      active: false,
      order: index + 1,
    }))

    if (branch) {
      branchTopicTurnCount += 1
    } else {
      lastMainTurnId = turnId
      currentBranchTopicId = null
      mainTopicTurnCount += 1
    }
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
      order: tree.orderedIds.length,
    }))
  }

  aggregateTopicMetadata(tree)
  const lastTurnId = [...tree.orderedIds].reverse().find((id) => tree.nodes[id]?.kind === 'turn') ?? null
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
