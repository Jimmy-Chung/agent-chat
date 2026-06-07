import type { GoalAnchor, PlanItem, TraceNode } from './types'
import { governConversationTree, type AggregationInfo, type ConversationTreeOptions } from './conversation-tree'

export type MindMapNodeKind = 'goal' | 'user' | 'aggregate'
export type MindMapEdgeKind = 'main' | 'branch'

export interface MindMapNode {
  id: string
  kind: MindMapNodeKind
  treeNodeId: string
  title: string
  subtitle: string
  relation: 'main' | 'branch'
  goalDistance: number
  active: boolean
  current: boolean
  collapsed: boolean
  depth: number
  sourceNodeIds: string[]
  focusMessageId?: string | null
  aggregation: AggregationInfo | null
  hasChildren: boolean
  status?: TraceNode['status']
  position: { x: number; y: number }
}

export interface MindMapEdge {
  id: string
  source: string
  target: string
  kind: MindMapEdgeKind
}

export interface MindMapProjection {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

const ROOT_X = 0
const ROOT_Y = 0
const START_X = 300
const STEP_X = 270
const MAIN_Y = 0
const BRANCH_Y = 360
const SUBGRAPH_Y = 210

function cleanTitleText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(帮我|请|可以|能不能|麻烦你|你帮我)/, '')
    .replace(/[?？。,.，、:：;；!！]+$/g, '')
    .trim()
}

function readableSummary(text: string | null | undefined, fallback: string): string {
  const value = cleanTitleText(text)
  if (!value) return fallback
  if (value.length <= 34) return value
  const separators = /[，,。；;：:\n]/
  const firstClause = value.split(separators).map((part) => part.trim()).find(Boolean)
  if (firstClause && firstClause.length <= 34) return firstClause
  const nouns = value.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,11}/gu) ?? []
  return nouns.slice(0, 3).join(' / ') || fallback
}

function traceTitle(node: TraceNode): string {
  if (node.aggregate_title?.trim()) return readableSummary(node.aggregate_title, '节点概要')
  if (node.user_summary?.trim()) return readableSummary(node.user_summary, '用户侧概要')
  if (node.user_message_count && node.user_message_count > 1) {
    const combined = (node.exchanges ?? [])
      .map((exchange) => exchange.user_message)
      .filter(Boolean)
      .join('；')
    return readableSummary(node.intent || combined || node.user_message, '用户输入聚合')
  }
  if (node.intent?.trim()) return readableSummary(node.intent, '用户意图')
  return readableSummary(node.user_message, '用户输入')
}

function traceMessageCount(node: TraceNode): number {
  return Math.max(node.user_message_count ?? 0, node.exchanges?.length ?? 0)
}

function firstFocusMessageId(node: TraceNode): string | null {
  return node.source_message_ids.find(Boolean) ?? node.exchanges?.map((exchange) => exchange.message_id).find(Boolean) ?? null
}

function focusMessageForSources(traceNodes: TraceNode[], sourceNodeIds: string[]): string | null {
  const sourceSet = new Set(sourceNodeIds)
  for (const node of traceNodes) {
    if (!sourceSet.has(node.id)) continue
    const messageId = firstFocusMessageId(node)
    if (messageId) return messageId
  }
  return null
}

function aggregateTitle(traceNodes: TraceNode[], sourceNodeIds: string[]): string {
  const sourceSet = new Set(sourceNodeIds)
  const sources = traceNodes.filter((node) => sourceSet.has(node.id))
  if (!sources.length) return '聚合上下文'
  if (sources.length === 1) return traceTitle(sources[0])
  const topicTerms = readableSummary(
    sources.map((node) => node.intent || node.user_message).join('；'),
    '聚合上下文',
  )
  return `${topicTerms} · ${sources.length} 轮`
}

function sourceSummary(traceNodes: TraceNode[], sourceNodeIds: string[]): string {
  const sourceSet = new Set(sourceNodeIds)
  const sources = traceNodes.filter((node) => sourceSet.has(node.id))
  const turnCount = sources.reduce((sum, node) => sum + Math.max(1, traceMessageCount(node)), 0)
  const toolCount = sources.reduce((sum, node) => sum + node.step_count, 0)
  return `${turnCount} 轮用户输入${toolCount ? ` · ${toolCount} 工具` : ''}`
}

export function buildMindMapProjection(
  traceNodes: TraceNode[],
  goalAnchor: GoalAnchor | null,
  planItems: PlanItem[],
  expandedIds: ReadonlySet<string> = new Set(),
  treeOptions: ConversationTreeOptions = {},
): MindMapProjection {
  const tree = governConversationTree(traceNodes, goalAnchor, planItems, treeOptions)
  const outputNodes: MindMapNode[] = [{
    id: tree.rootId,
    kind: 'goal',
    treeNodeId: tree.rootId,
    title: readableSummary(goalAnchor?.normalized_goal || goalAnchor?.raw_query, '当前目标'),
    subtitle: `${traceNodes.length} 轮轨迹`,
    relation: 'main',
    goalDistance: 0,
    active: false,
    current: false,
    collapsed: false,
    depth: 0,
    sourceNodeIds: traceNodes.map((node) => node.id),
    focusMessageId: focusMessageForSources(traceNodes, traceNodes.map((node) => node.id)),
    aggregation: null,
    hasChildren: true,
    status: traceNodes.some((node) => node.status === 'running') ? 'running' : 'done',
    position: { x: ROOT_X, y: ROOT_Y },
  }]
  const outputEdges: MindMapEdge[] = []

  const topicByTurn = new Map<string, string>()
  const orderByTraceId = new Map(traceNodes.map((node, index) => [node.id, index + 1]))
  for (const node of Object.values(tree.nodes)) {
    if (node.kind !== 'turn' || !node.sourceNodeIds[0] || !node.parentId) continue
    topicByTurn.set(node.sourceNodeIds[0], node.parentId)
  }

  const emittedBySource = new Set<string>()
  const emittedByTopic = new Set<string>()
  let lastMainId = tree.rootId
  let lastBranchByTopic = new Map<string, string>()

  const topicChildren = (topicId: string) =>
    tree.nodes[topicId]?.childIds.map((id) => tree.nodes[id]).filter(Boolean) ?? []

  const branchAnchorId = (topicId: string | null | undefined): string => {
    const topic = topicId ? tree.nodes[topicId] : null
    if (!topic) return lastMainId
    const anchor = [...traceNodes]
      .reverse()
      .find((node) => {
        const nodeOrder = orderByTraceId.get(node.id) ?? 0
        const nodeTopic = topicByTurn.get(node.id)
        return nodeOrder < topic.order && tree.nodes[nodeTopic ?? '']?.relation === 'main'
      })
    return anchor ? `user_${anchor.id}` : lastMainId
  }

  const multiTraceAggregation = (traceNode: TraceNode): AggregationInfo => ({
    reason: 'too_long',
    childCount: traceMessageCount(traceNode),
    turnCount: traceMessageCount(traceNode),
    toolCount: traceNode.step_count,
    sourceTitles: (traceNode.exchanges ?? [])
      .map((exchange) => readableSummary(exchange.user_message, '用户输入'))
      .filter(Boolean),
  })

  const emitUserNode = (traceNode: TraceNode, opts: { nested?: boolean } = {}): string => {
    const id = opts.nested ? `nested_${traceNode.id}` : `user_${traceNode.id}`
    if (emittedBySource.has(id)) return id
    const topicId = topicByTurn.get(traceNode.id)
    const topic = topicId ? tree.nodes[topicId] : null
    const relation = topic?.relation ?? 'main'
    const messageCount = traceMessageCount(traceNode)
    const isMultiTrace = messageCount > 1
    const y = opts.nested
      ? SUBGRAPH_Y + (topic?.relation === 'branch' ? BRANCH_Y : 0)
      : relation === 'branch'
        ? BRANCH_Y + Math.max(0, (topic?.depth ?? 1) - 1) * 140
        : MAIN_Y
    const x = opts.nested
      ? START_X + (orderByTraceId.get(traceNode.id) ?? 1) * 280
      : START_X + ((orderByTraceId.get(traceNode.id) ?? 1) - 1) * STEP_X
    outputNodes.push({
      id,
      kind: isMultiTrace ? 'aggregate' : 'user',
      treeNodeId: `turn_${traceNode.id}`,
      title: traceTitle(traceNode),
      subtitle: isMultiTrace ? `${messageCount} 条消息 · 已聚合` : '',
      relation,
      goalDistance: traceNode.goal_distance,
      active: false,
      current: !!tree.nodes[`turn_${traceNode.id}`]?.current,
      collapsed: isMultiTrace ? !expandedIds.has(id) : false,
      depth: topic?.depth ?? 1,
      sourceNodeIds: [traceNode.id],
      focusMessageId: firstFocusMessageId(traceNode),
      aggregation: isMultiTrace ? multiTraceAggregation(traceNode) : null,
      hasChildren: isMultiTrace,
      status: traceNode.status,
      position: { x, y },
    })
    emittedBySource.add(id)

    if (isMultiTrace && expandedIds.has(id)) {
      let previousNested: string | null = null
      const exchanges = traceNode.exchanges ?? []
      exchanges.forEach((exchange, index) => {
        const nestedId = `${id}_exchange_${exchange.id}`
        outputNodes.push({
          id: nestedId,
          kind: 'user',
          treeNodeId: `turn_${traceNode.id}_${exchange.id}`,
          title: readableSummary(exchange.user_message, '用户输入'),
          subtitle: exchange.assistant_summary ? readableSummary(exchange.assistant_summary, 'AI 概要') : '',
          relation,
          goalDistance: traceNode.goal_distance,
          active: false,
          current: false,
          collapsed: false,
          depth: (topic?.depth ?? 1) + 1,
          sourceNodeIds: [traceNode.id],
          focusMessageId: exchange.message_id || firstFocusMessageId(traceNode),
          aggregation: null,
          hasChildren: false,
          status: traceNode.status,
          position: {
            x: x + index * 280,
            y: y + SUBGRAPH_Y,
          },
        })
        outputEdges.push({
          id: previousNested ? `multi_${previousNested}_${nestedId}` : `multi_${id}_${nestedId}`,
          source: previousNested ?? id,
          target: nestedId,
          kind: relation === 'branch' ? 'branch' : 'main',
        })
        previousNested = nestedId
      })
    }
    return id
  }

  const emitAggregateNode = (topicId: string): string => {
    const topic = tree.nodes[topicId]
    const id = `agg_${topicId}`
    if (emittedByTopic.has(id)) return id
    outputNodes.push({
      id,
      kind: 'aggregate',
      treeNodeId: topicId,
      title: aggregateTitle(traceNodes, topic.sourceNodeIds),
      subtitle: `${sourceSummary(traceNodes, topic.sourceNodeIds)} · 已聚合`,
      relation: topic.relation,
      goalDistance: topic.goalDistance,
      active: topic.active,
      current: false,
      collapsed: !expandedIds.has(id),
      depth: topic.depth,
      sourceNodeIds: topic.sourceNodeIds,
      focusMessageId: focusMessageForSources(traceNodes, topic.sourceNodeIds),
      aggregation: topic.aggregation,
      hasChildren: topic.childIds.length > 0,
      status: topic.status,
      position: {
        x: START_X + Math.max(0, topic.order - 1) * STEP_X,
        y: topic.relation === 'branch' ? BRANCH_Y + Math.max(0, topic.depth - 1) * 90 : MAIN_Y,
      },
    })
    emittedByTopic.add(id)

    if (expandedIds.has(id)) {
      let previousNested: string | null = null
      for (const child of topicChildren(topicId).filter((node) => node.kind === 'turn' || node.kind === 'topic')) {
        let nestedId: string | null = null
        if (child.kind === 'turn') {
          const source = traceNodes.find((node) => node.id === child.sourceNodeIds[0])
          if (!source) continue
          nestedId = emitUserNode(source, { nested: true })
        } else {
          nestedId = emitAggregateNode(child.id)
        }
        if (!nestedId) continue
        outputEdges.push({
          id: previousNested ? `nested_${previousNested}_${nestedId}` : `expand_${id}_${nestedId}`,
          source: previousNested ?? id,
          target: nestedId,
          kind: child.relation === 'branch' ? 'branch' : 'main',
        })
        previousNested = nestedId
      }
    }
    return id
  }

  for (const traceNode of traceNodes) {
    const topicId = topicByTurn.get(traceNode.id)
    const topic = topicId ? tree.nodes[topicId] : null
    if (topic?.collapsed && !topic.active) {
      const aggregateAlreadyEmitted = outputNodes.some((node) => node.id === `agg_${topic.id}`)
      const aggregateId = emitAggregateNode(topic.id)
      if (aggregateAlreadyEmitted) continue
      if (topic.relation === 'branch') {
        const parentId = branchAnchorId(topic.id)
        outputEdges.push({ id: `branch_${parentId}_${aggregateId}`, source: parentId, target: aggregateId, kind: 'branch' })
        lastBranchByTopic = new Map(lastBranchByTopic).set(topic.id, aggregateId)
      } else if (lastMainId !== aggregateId) {
        outputEdges.push({ id: `main_${lastMainId}_${aggregateId}`, source: lastMainId, target: aggregateId, kind: 'main' })
        lastMainId = aggregateId
      }
      continue
    }

    const nodeId = emitUserNode(traceNode)
    if (topic?.relation === 'branch') {
      const previousBranch = topic.id ? lastBranchByTopic.get(topic.id) : undefined
      const sourceId = previousBranch ?? branchAnchorId(topic.id)
      outputEdges.push({ id: `branch_${sourceId}_${nodeId}`, source: sourceId, target: nodeId, kind: 'branch' })
      lastBranchByTopic = new Map(lastBranchByTopic).set(topic.id, nodeId)
    } else {
      outputEdges.push({ id: `main_${lastMainId}_${nodeId}`, source: lastMainId, target: nodeId, kind: 'main' })
      lastMainId = nodeId
    }
  }

  return { nodes: outputNodes, edges: outputEdges }
}
