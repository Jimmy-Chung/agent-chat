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
const STOP_WORDS = new Set([
  '一下',
  '一个',
  '这个',
  '那个',
  '今天',
  '现在',
  '帮我',
  '用户',
  '用户回合',
  '回合',
  '户回',
  '看看',
  '效果',
  '好的',
  '可以',
  '怎么',
  '什么',
  '如何',
  'the',
  'and',
  'for',
  'with',
])

const PREVIOUS_AI_FOLLOW_UP_THRESHOLD = 0.12
const PREVIOUS_AI_FOLLOW_UP_MAX_DISTANCE = 0.78

type RouteDecision =
  | { type: 'continue_main'; targetTopicId: string }
  | { type: 'continue_branch'; targetTopicId: string }
  | { type: 'start_branch'; fromTopicId: string }
  | { type: 'return_to_main'; targetTopicId: string; resolvedBranchId: string | null }
  | { type: 'start_new_main_phase'; afterTopicId: string }

function compact(text: string | null | undefined, max = 52): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function userTitle(node: TraceNode, max = 52): string {
  return compact(node.user_message || node.intent || '用户输入', max)
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

function normalizeForTokens(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function tokenize(text: string | null | undefined): Set<string> {
  const normalized = normalizeForTokens(text)
  const tokens = new Set<string>()
  for (const word of normalized.split(/\s+/).filter(Boolean)) {
    if (word.length > 1 && !STOP_WORDS.has(word)) tokens.add(word)
    const chars = [...word]
    if (chars.length === 1 && /[\p{L}\p{N}]/u.test(word) && !STOP_WORDS.has(word)) tokens.add(word)
    for (let i = 0; i < chars.length - 1; i += 1) {
      const pair = `${chars[i]}${chars[i + 1]}`
      if (!STOP_WORDS.has(pair)) tokens.add(pair)
    }
  }
  return tokens
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const token of a) {
    if (b.has(token)) overlap += 1
  }
  return overlap / Math.sqrt(a.size * b.size)
}

function topicText(tree: ConversationTree, topicId: string | null, traceById: Map<string, TraceNode>): string {
  const topic = topicId ? tree.nodes[topicId] : null
  if (!topic) return ''
  const parts: string[] = [topic.title, topic.summary]
  const sourceIds = new Set(topic.sourceNodeIds)
  for (const childId of topic.childIds) {
    const child = tree.nodes[childId]
    if (child?.kind === 'turn') {
      for (const sourceId of child.sourceNodeIds) sourceIds.add(sourceId)
    }
  }
  for (const sourceId of sourceIds) {
    const source = traceById.get(sourceId)
    if (!source) continue
    parts.push(source.user_message, source.intent, source.conclusion ?? '')
    for (const exchange of source.exchanges ?? []) {
      parts.push(exchange.user_message, exchange.prev_ai_summary ?? '', exchange.assistant_summary)
    }
  }
  return parts.join(' ')
}

function latestAssistantContext(node: TraceNode | null): string {
  if (!node) return ''
  const exchanges = node.exchanges ?? []
  return [
    node.user_message,
    node.intent,
    node.conclusion,
    node.assistant_actions?.join(' '),
    ...exchanges.flatMap((exchange) => [
      exchange.user_message,
      exchange.assistant_summary,
      exchange.prev_ai_summary ?? '',
      exchange.assistant_actions.join(' '),
    ]),
  ].filter(Boolean).join(' ')
}

function resolveBranch(tree: ConversationTree, branchId: string | null): void {
  const branch = branchId ? tree.nodes[branchId] : null
  if (!branch || branch.kind !== 'topic' || branch.relation !== 'branch') return
  branch.collapsed = true
  branch.aggregation = {
    reason: 'resolved',
    childCount: branch.childIds.length,
    turnCount: branch.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length,
    toolCount: 0,
    sourceTitles: branch.childIds.map((id) => tree.nodes[id]?.title).filter(Boolean).slice(0, 8),
  }
}

function decideRoute(input: {
  tree: ConversationTree
  traceById: Map<string, TraceNode>
  next: TraceNode
  lastTurn: TraceNode | null
  activeTopicId: string | null
  mainTopicId: string | null
  activeBranchTopicId: string | null
  currentTopicTurnCount: number
  topicTurnLimit: number
  goalAnchor: GoalAnchor | null
}): RouteDecision {
  const {
    tree,
    traceById,
    next,
    lastTurn,
    activeTopicId,
    mainTopicId,
    activeBranchTopicId,
    currentTopicTurnCount,
    topicTurnLimit,
    goalAnchor,
  } = input
  if (!mainTopicId) return { type: 'start_new_main_phase', afterTopicId: tree.rootId }

  const nextTokens = tokenize([next.user_message, next.intent].filter(Boolean).join(' '))
  const mainTokens = tokenize([
    goalAnchor?.normalized_goal,
    goalAnchor?.raw_query,
    topicText(tree, mainTopicId, traceById),
  ].filter(Boolean).join(' '))
  const branchTokens = tokenize(topicText(tree, activeBranchTopicId, traceById))
  const previousAiTokens = tokenize(latestAssistantContext(lastTurn))

  const mainScore = tokenSimilarity(nextTokens, mainTokens)
  const branchScore = tokenSimilarity(nextTokens, branchTokens)
  const previousAiScore = tokenSimilarity(nextTokens, previousAiTokens)
  const activeTopic = activeTopicId ? tree.nodes[activeTopicId] : null
  const activeIsBranch = activeTopic?.relation === 'branch'
  const stronglyMain = mainScore >= 0.16 || next.goal_distance <= 0.35
  const followsPreviousAi =
    previousAiScore >= PREVIOUS_AI_FOLLOW_UP_THRESHOLD &&
    next.goal_distance < PREVIOUS_AI_FOLLOW_UP_MAX_DISTANCE
  const stronglyBranch = !!activeBranchTopicId && (branchScore >= 0.18 || (activeIsBranch && previousAiScore >= 0.12))

  if (next.user_kind === 'choice' && activeTopicId) {
    return activeIsBranch
      ? { type: 'continue_branch', targetTopicId: activeTopicId }
      : { type: 'continue_main', targetTopicId: mainTopicId }
  }

  if (activeIsBranch) {
    const branchTopicId = activeTopicId ?? mainTopicId
    if (stronglyMain && mainScore >= branchScore) {
      return { type: 'return_to_main', targetTopicId: mainTopicId, resolvedBranchId: branchTopicId }
    }
    if (stronglyBranch || next.goal_distance >= 0.62) {
      return { type: 'continue_branch', targetTopicId: branchTopicId }
    }
    return { type: 'return_to_main', targetTopicId: mainTopicId, resolvedBranchId: branchTopicId }
  }

  if (stronglyBranch && activeBranchTopicId && branchScore > mainScore + 0.04) {
    return { type: 'continue_branch', targetTopicId: activeBranchTopicId }
  }

  if (followsPreviousAi) {
    return { type: 'continue_main', targetTopicId: mainTopicId }
  }

  if (currentTopicTurnCount >= topicTurnLimit && stronglyMain) {
    return { type: 'start_new_main_phase', afterTopicId: mainTopicId }
  }

  if (stronglyMain) {
    return { type: 'continue_main', targetTopicId: mainTopicId }
  }

  if (next.goal_distance >= 0.62 || next.user_kind === 'question' || next.user_kind === 'proposal') {
    return { type: 'start_branch', fromTopicId: mainTopicId }
  }

  return { type: 'continue_main', targetTopicId: mainTopicId }
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
    node.summary = `${children.filter((child) => child.kind === 'turn').length} 轮用户输入 · ${compact(children.at(-1)?.title, 28)}`
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
  let mainTopicId: string | null = null
  let activeBranchTopicId: string | null = null
  let lastTurn: TraceNode | null = null
  let currentTopicTurnCount = 0
  const traceById = new Map<string, TraceNode>()

  traceNodes.forEach((traceNode, index) => {
    const route = decideRoute({
      tree,
      traceById,
      next: traceNode,
      lastTurn,
      activeTopicId,
      mainTopicId,
      activeBranchTopicId,
      currentTopicTurnCount,
      topicTurnLimit: opts.topicTurnLimit,
      goalAnchor,
    })
    let topicId = activeTopicId

    if (route.type === 'return_to_main') {
      resolveBranch(tree, route.resolvedBranchId)
      topicId = route.targetTopicId
      activeTopicId = topicId
      currentTopicTurnCount = tree.nodes[topicId]?.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length ?? 0
    } else if (route.type === 'continue_main' || route.type === 'continue_branch') {
      topicId = route.targetTopicId
      activeTopicId = topicId
      currentTopicTurnCount = tree.nodes[topicId]?.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length ?? 0
    } else {
      const relation: ConversationRelation = route.type === 'start_branch' ? 'branch' : 'main'
      const parentId = route.type === 'start_branch' ? route.fromTopicId : rootId
      const parentTopic = tree.nodes[parentId]
      topicId = `topic_${relation}_${traceNode.id}`
      const activeTopic = activeTopicId ? tree.nodes[activeTopicId] : null
      if (activeTopic && activeTopic.id !== parentId && !activeTopic.active) {
        activeTopic.collapsed = true
        activeTopic.aggregation = {
          reason: route.type === 'start_new_main_phase' ? 'too_long' : 'topic_shift',
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
        title: relation === 'branch' ? `支线：${userTitle(traceNode, 34)}` : userTitle(traceNode, 42),
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
      if (relation === 'main') mainTopicId = topicId
      if (relation === 'branch') activeBranchTopicId = topicId
      currentTopicTurnCount = 0
    }

    const turnId = `turn_${traceNode.id}`
    const topic = tree.nodes[topicId]
    appendNode(tree, makeNode({
      id: turnId,
      kind: 'turn',
      parentId: topicId,
      relation: topic.relation,
      title: userTitle(traceNode, 46),
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
    traceById.set(traceNode.id, traceNode)
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
