import type { GoalAnchor, PlanItem, TraceExchange, TraceNode } from './types'
import { projectPlanGraph } from './plan-projector'

export type ConversationTreeNodeKind = 'goal' | 'topic' | 'turn' | 'plan' | 'decision'
export type ConversationRelation = 'main' | 'branch'
export type CollapseReason = 'resolved' | 'topic_shift' | 'too_long' | 'inactive' | 'capacity_compact' | null

export interface AggregationInfo {
  reason: CollapseReason
  groupKey?: string
  groupType?: 'capacity' | 'content' | 'branch'
  childCount: number
  turnCount: number
  toolCount: number
  sourceTitles: string[]
  semanticTitle?: string
  semanticSummary?: string
  semanticMergeable?: boolean
  semanticConfidence?: number
  semanticReason?: string
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

interface DecisionOption {
  id: string
  label: string
  selected: boolean
}

interface DecisionNode {
  id: string
  question: string
  selectedOptionId: string | null
  affectedNodeIds: string[]
}

function inferDecisionOptions(exchange: TraceExchange): DecisionOption[] {
  const explicit = (exchange as unknown as { options?: string[] }).options
  if (explicit?.length) {
    return explicit.map((label, index) => ({ id: `opt_${index + 1}`, label, selected: false }))
  }

  const optionMatches = [...exchange.assistant_summary.matchAll(/([ABC123])[\).、:：]\s*([\s\S]*?)(?=\s+[ABC123][\).、:：]|$)/g)]
  return optionMatches.map((match) => ({ id: String(match[1]), label: match[2].trim(), selected: false }))
}

function decisionChoiceMatchesOption(choice: string, option: DecisionOption): boolean {
  const normalized = choice.trim().toLowerCase()
  return normalized.includes(option.id.toLowerCase()) || normalized.includes(option.label.toLowerCase())
}

function findDecisionQuestionExchange(exchanges: TraceExchange[], choiceIndex: number): TraceExchange | null {
  for (let i = choiceIndex - 1; i >= 0; i--) {
    const exchange = exchanges[i]
    if (exchange.assistant_actions.includes('ask') || exchange.assistant_actions.includes('options')) return exchange
  }
  return null
}

function inferDecisionNodes(nodes: TraceNode[]): DecisionNode[] {
  const decisions: DecisionNode[] = []
  const allExchanges = nodes.flatMap((node) => (node.exchanges ?? []).map((exchange) => ({ node, exchange })))

  for (let i = 0; i < allExchanges.length; i++) {
    const { exchange } = allExchanges[i]
    if (exchange.user_kind !== 'choice') continue
    const questionExchange = findDecisionQuestionExchange(allExchanges.map((entry) => entry.exchange), i)
    if (!questionExchange) continue

    const options = inferDecisionOptions(questionExchange).map((option) => ({
      ...option,
      selected: decisionChoiceMatchesOption(exchange.user_message, option),
    }))
    const selected = options.find((option) => option.selected) ?? null
    const affectedNodeIds = allExchanges
      .slice(i)
      .map((entry) => entry.node.id)
      .filter((id, index, array) => array.indexOf(id) === index)

    decisions.push({
      id: `decision_${questionExchange.id}_${exchange.id}`,
      question: questionExchange.assistant_summary || questionExchange.user_message,
      selectedOptionId: selected?.id ?? null,
      affectedNodeIds,
    })
  }

  return decisions
}

export interface ConversationTreeOptions {
  topicTurnLimit?: number
  keepExpandedRecentTopics?: number
  maxDirectChildren?: number
  compactSoftLimit?: number
  blockedAggregationKeys?: ReadonlySet<string>
}

const DEFAULT_TOPIC_TURN_LIMIT = 4
const DEFAULT_KEEP_EXPANDED_RECENT_TOPICS = 2
const DEFAULT_MAX_DIRECT_CHILDREN = 10
const DEFAULT_COMPACT_SOFT_LIMIT = 8
const COMPACT_GROUP_TARGET_SIZE = 6
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
  '讨论',
  'the',
  'and',
  'for',
  'with',
])

const PREVIOUS_AI_FOLLOW_UP_THRESHOLD = 0.12
const STRONG_PREVIOUS_AI_FOLLOW_UP_THRESHOLD = 0.14
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

function cleanTitleText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(帮我|请|可以|能不能|麻烦你|你帮我)/, '')
    .replace(/[?？。,.，、:：;；!！]+$/g, '')
    .trim()
}

function titleSummary(text: string | null | undefined, fallback: string): string {
  const value = cleanTitleText(text)
  if (!value) return fallback
  if (value.length <= 30) return value
  const firstClause = value.split(/[，,。；;：:\n]/).map((part) => part.trim()).find(Boolean)
  if (firstClause && firstClause.length <= 30) return firstClause
  const chunks = value.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,11}/gu) ?? []
  return chunks.slice(0, 3).join(' / ') || fallback
}

function userTitle(node: TraceNode): string {
  if (node.user_message_count && node.user_message_count > 1) {
    const combined = (node.exchanges ?? [])
      .map((exchange) => exchange.user_message)
      .filter(Boolean)
      .join('；')
    return titleSummary(node.intent || combined || node.user_message, '用户输入聚合')
  }
  if (node.intent?.trim()) return titleSummary(node.intent, '用户意图')
  return titleSummary(node.user_message, '用户输入')
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
  const cosine = overlap / Math.sqrt(a.size * b.size)
  const shortInputCoverage = overlap / a.size
  return Math.max(cosine, shortInputCoverage)
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

function resolveBranch(
  tree: ConversationTree,
  branchId: string | null,
  opts: Required<Omit<ConversationTreeOptions, 'blockedAggregationKeys'>> & Pick<ConversationTreeOptions, 'blockedAggregationKeys'>,
): void {
  const branch = branchId ? tree.nodes[branchId] : null
  if (!branch || branch.kind !== 'topic' || branch.relation !== 'branch') return
  const sourceNodeIds = collectSourceNodeIds(tree, branch.id)
  if (isAggregationBlocked(opts, 'branch', sourceNodeIds)) return
  branch.collapsed = true
  branch.aggregation = {
    reason: 'resolved',
    groupKey: groupKeyFromSourceNodeIds(sourceNodeIds),
    groupType: 'branch',
    childCount: branch.childIds.length,
    turnCount: branch.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length,
    toolCount: 0,
    sourceTitles: branch.childIds.map((id) => tree.nodes[id]?.title).filter(Boolean).slice(0, 8),
  }
}

function countTurns(tree: ConversationTree, nodeId: string): number {
  const node = tree.nodes[nodeId]
  if (!node) return 0
  if (node.kind === 'turn') return 1
  return node.childIds.reduce((sum, childId) => sum + countTurns(tree, childId), 0)
}

function collectSourceTitles(tree: ConversationTree, childIds: string[]): string[] {
  return childIds
    .map((id) => tree.nodes[id]?.title)
    .filter(Boolean)
    .slice(0, 8)
}

function collectSourceNodeIds(tree: ConversationTree, nodeId: string): string[] {
  const node = tree.nodes[nodeId]
  if (!node) return []
  const ids = new Set(node.sourceNodeIds)
  for (const childId of node.childIds) {
    for (const sourceId of collectSourceNodeIds(tree, childId)) ids.add(sourceId)
  }
  return [...ids]
}

function groupKeyFromSourceNodeIds(sourceNodeIds: string[]): string {
  return [...new Set(sourceNodeIds)].sort().join('|')
}

function aggregationDecisionKey(groupType: 'capacity' | 'content' | 'branch', groupKey: string): string {
  return `${groupType}:${groupKey}`
}

function isAggregationBlocked(
  opts: Required<Omit<ConversationTreeOptions, 'blockedAggregationKeys'>> & Pick<ConversationTreeOptions, 'blockedAggregationKeys'>,
  groupType: 'content' | 'branch',
  sourceNodeIds: string[],
): boolean {
  const groupKey = groupKeyFromSourceNodeIds(sourceNodeIds)
  return !!groupKey && (opts.blockedAggregationKeys?.has(aggregationDecisionKey(groupType, groupKey)) ?? false)
}

function compactId(parentId: string, childIds: string[]): string {
  const first = childIds[0]?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'group'
  return `topic_compact_${parentId}_${first}`
}

function shiftDepth(tree: ConversationTree, nodeId: string, delta: number): void {
  const node = tree.nodes[nodeId]
  if (!node) return
  node.depth += delta
  for (const childId of node.childIds) shiftDepth(tree, childId, delta)
}

function makeCapacityCompactNode(
  tree: ConversationTree,
  parent: ConversationTreeNode,
  childIds: string[],
): ConversationTreeNode {
  const children = childIds.map((id) => tree.nodes[id]).filter(Boolean)
  const first = children[0]
  const last = children[children.length - 1]
  const sourceNodeIds = childIds.flatMap((childId) => collectSourceNodeIds(tree, childId))
  const turnCount = childIds.reduce((sum, childId) => sum + countTurns(tree, childId), 0)
  const id = compactId(parent.id, childIds)
  return makeNode({
    id,
    kind: 'topic',
    parentId: parent.id,
    relation: parent.relation,
    title: `已 compact：${titleSummary(first?.title, '旧上下文')}`,
    summary: `${turnCount} 轮用户输入 · ${titleSummary(last?.title, '最近上下文')}`,
    sourceNodeIds,
    goalDistance: children.length ? Math.max(...children.map((child) => child.goalDistance)) : parent.goalDistance,
    status: children.some((child) => child.status === 'running') ? 'running' : parent.status,
    collapsed: true,
    active: children.some((child) => child.active),
    current: children.some((child) => child.current),
    depth: parent.depth + 1,
    aggregation: {
      reason: 'capacity_compact',
      groupKey: groupKeyFromSourceNodeIds(sourceNodeIds),
      groupType: 'capacity',
      childCount: childIds.length,
      turnCount,
      toolCount: 0,
      sourceTitles: collectSourceTitles(tree, childIds),
    },
    order: first?.order ?? parent.order,
  })
}

function replaceChildrenWithCompactGroup(
  tree: ConversationTree,
  parent: ConversationTreeNode,
  childIds: string[],
): void {
  if (childIds.length < 2) return
  const groupId = compactId(parent.id, childIds)
  if (tree.nodes[groupId]) return
  const group = makeCapacityCompactNode(tree, parent, childIds)
  tree.nodes[group.id] = group
  tree.orderedIds.push(group.id)
  const childSet = new Set(childIds)
  const nextChildIds: string[] = []
  let inserted = false
  for (const childId of parent.childIds) {
    if (!childSet.has(childId)) {
      nextChildIds.push(childId)
      continue
    }
    if (!inserted) {
      nextChildIds.push(group.id)
      inserted = true
    }
    const child = tree.nodes[childId]
    if (child) {
      child.parentId = group.id
      shiftDepth(tree, child.id, 1)
      group.childIds.push(child.id)
    }
  }
  parent.childIds = nextChildIds
}

function chunkForCompact(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += COMPACT_GROUP_TARGET_SIZE) {
    const chunk = ids.slice(i, i + COMPACT_GROUP_TARGET_SIZE)
    if (chunk.length > 1) chunks.push(chunk)
  }
  return chunks
}

function enforceLayerLimits(tree: ConversationTree, parentId: string, opts: Required<ConversationTreeOptions>): void {
  const parent = tree.nodes[parentId]
  if (!parent) return
  const visibleChildIds = parent.childIds.filter((id) => {
    const child = tree.nodes[id]
    return child?.kind === 'turn' || child?.kind === 'topic'
  })
  if (visibleChildIds.length > opts.compactSoftLimit) {
    const protectedIds = new Set(
      visibleChildIds
        .filter((id) => tree.nodes[id]?.active || tree.nodes[id]?.current)
        .concat(visibleChildIds.slice(-2)),
    )
    const compactableIds = visibleChildIds.filter((id) => !protectedIds.has(id))
    const projectedCount = protectedIds.size + Math.ceil(compactableIds.length / COMPACT_GROUP_TARGET_SIZE)
    if (visibleChildIds.length > opts.maxDirectChildren || projectedCount <= opts.compactSoftLimit) {
      for (const chunk of chunkForCompact(compactableIds)) {
        replaceChildrenWithCompactGroup(tree, parent, chunk)
      }
    }
  }
  for (const childId of [...parent.childIds]) {
    const child = tree.nodes[childId]
    if (child?.kind === 'topic') enforceLayerLimits(tree, child.id, opts)
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
    (next.goal_distance < PREVIOUS_AI_FOLLOW_UP_MAX_DISTANCE ||
      previousAiScore >= STRONG_PREVIOUS_AI_FOLLOW_UP_THRESHOLD)
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

function collapseFinishedTopics(
  tree: ConversationTree,
  opts: Required<Omit<ConversationTreeOptions, 'blockedAggregationKeys'>> & Pick<ConversationTreeOptions, 'blockedAggregationKeys'>,
): void {
  const topics = tree.orderedIds.map((id) => tree.nodes[id]).filter((node) => node.kind === 'topic')
  const recentTopics = new Set(topics.slice(-opts.keepExpandedRecentTopics).map((node) => node.id))
  for (const topic of topics) {
    if (
      topic.aggregation?.reason === 'resolved' ||
      topic.aggregation?.reason === 'topic_shift' ||
      topic.aggregation?.reason === 'capacity_compact'
    ) {
      topic.collapsed = !topic.active
      continue
    }
    const turnCount = topic.childIds.filter((id) => tree.nodes[id]?.kind === 'turn').length
    const tooLong = turnCount > opts.topicTurnLimit
    const inactive = !topic.active && !recentTopics.has(topic.id)
    const sourceNodeIds = collectSourceNodeIds(tree, topic.id)
    topic.collapsed = (tooLong || inactive) && !isAggregationBlocked(opts, 'content', sourceNodeIds)
    if (topic.collapsed) {
      topic.aggregation = {
        reason: tooLong ? 'too_long' : 'inactive',
        groupKey: groupKeyFromSourceNodeIds(sourceNodeIds),
        groupType: 'content',
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
    maxDirectChildren: options.maxDirectChildren ?? DEFAULT_MAX_DIRECT_CHILDREN,
    compactSoftLimit: options.compactSoftLimit ?? DEFAULT_COMPACT_SOFT_LIMIT,
    blockedAggregationKeys: options.blockedAggregationKeys ?? new Set(),
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
      resolveBranch(tree, route.resolvedBranchId, opts)
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
      const activeTopicSourceIds = activeTopic ? collectSourceNodeIds(tree, activeTopic.id) : []
      if (activeTopic && activeTopic.id !== parentId && !activeTopic.active && !isAggregationBlocked(opts, 'content', activeTopicSourceIds)) {
        activeTopic.collapsed = true
        activeTopic.aggregation = {
          reason: route.type === 'start_new_main_phase' ? 'too_long' : 'topic_shift',
          groupKey: groupKeyFromSourceNodeIds(activeTopicSourceIds),
          groupType: 'content',
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
        title: relation === 'branch' ? `支线：${userTitle(traceNode)}` : userTitle(traceNode),
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
      title: userTitle(traceNode),
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

  for (const decision of inferDecisionNodes(traceNodes)) {
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

  const lastTurnId = [...tree.orderedIds].reverse().find((id) => tree.nodes[id]?.kind === 'turn') ?? null
  if (lastTurnId) tree.nodes[lastTurnId].current = true
  markActivePath(tree, lastTurnId)
  enforceLayerLimits(tree, rootId, opts)
  aggregateTopicMetadata(tree)
  collapseFinishedTopics(tree, opts)

  for (const node of tree.orderedIds.map((id) => tree.nodes[id])) {
    if (node.kind === 'turn') {
      const topic = nearestTopic(tree, node.parentId)
      if (topic?.collapsed && !node.active) node.collapsed = true
    }
  }

  return tree
}
