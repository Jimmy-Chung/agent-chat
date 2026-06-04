import type { GoalAnchor, PlanItem, TraceNode } from './types'
import { governConversationTree, type AggregationInfo } from './conversation-tree'

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
const BRANCH_Y = 230
const SUBGRAPH_Y = 210

function compact(text: string | null | undefined, max = 54): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function firstUserTitle(traceNodes: TraceNode[], sourceNodeIds: string[]): string {
  const sourceSet = new Set(sourceNodeIds)
  const first = traceNodes.find((node) => sourceSet.has(node.id))
  return compact(first?.user_message || '用户输入')
}

function sourceSummary(traceNodes: TraceNode[], sourceNodeIds: string[]): string {
  const sourceSet = new Set(sourceNodeIds)
  const sources = traceNodes.filter((node) => sourceSet.has(node.id))
  const turnCount = sources.length
  const toolCount = sources.reduce((sum, node) => sum + node.step_count, 0)
  return `${turnCount} 轮用户输入${toolCount ? ` · ${toolCount} 工具` : ''}`
}

export function buildMindMapProjection(
  traceNodes: TraceNode[],
  goalAnchor: GoalAnchor | null,
  planItems: PlanItem[],
  expandedIds: ReadonlySet<string> = new Set(),
): MindMapProjection {
  const tree = governConversationTree(traceNodes, goalAnchor, planItems)
  const outputNodes: MindMapNode[] = [{
    id: tree.rootId,
    kind: 'goal',
    treeNodeId: tree.rootId,
    title: compact(goalAnchor?.normalized_goal || goalAnchor?.raw_query || '当前目标', 64),
    subtitle: `${traceNodes.length} 轮轨迹`,
    relation: 'main',
    goalDistance: 0,
    active: false,
    current: false,
    collapsed: false,
    depth: 0,
    sourceNodeIds: traceNodes.map((node) => node.id),
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

  const emitUserNode = (traceNode: TraceNode, opts: { nested?: boolean } = {}): string => {
    const id = opts.nested ? `nested_${traceNode.id}` : `user_${traceNode.id}`
    if (emittedBySource.has(id)) return id
    const topicId = topicByTurn.get(traceNode.id)
    const topic = topicId ? tree.nodes[topicId] : null
    const relation = topic?.relation ?? 'main'
    const y = opts.nested
      ? SUBGRAPH_Y + (topic?.relation === 'branch' ? BRANCH_Y : 0)
      : relation === 'branch'
        ? BRANCH_Y + Math.max(0, (topic?.depth ?? 1) - 1) * 90
        : MAIN_Y
    outputNodes.push({
      id,
      kind: 'user',
      treeNodeId: `turn_${traceNode.id}`,
      title: compact(traceNode.user_message || traceNode.intent || '用户输入'),
      subtitle: traceNode.user_message_count && traceNode.user_message_count > 1 ? `${traceNode.user_message_count} 条用户输入` : '',
      relation,
      goalDistance: traceNode.goal_distance,
      active: false,
      current: !!tree.nodes[`turn_${traceNode.id}`]?.current,
      collapsed: false,
      depth: topic?.depth ?? 1,
      sourceNodeIds: [traceNode.id],
      aggregation: null,
      hasChildren: false,
      status: traceNode.status,
      position: {
        x: opts.nested
          ? START_X + (orderByTraceId.get(traceNode.id) ?? 1) * 120
          : START_X + ((orderByTraceId.get(traceNode.id) ?? 1) - 1) * STEP_X,
        y,
      },
    })
    emittedBySource.add(id)
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
      title: firstUserTitle(traceNodes, topic.sourceNodeIds),
      subtitle: `${sourceSummary(traceNodes, topic.sourceNodeIds)} · 已聚合`,
      relation: topic.relation,
      goalDistance: topic.goalDistance,
      active: topic.active,
      current: false,
      collapsed: !expandedIds.has(id),
      depth: topic.depth,
      sourceNodeIds: topic.sourceNodeIds,
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
      const aggregateId = emitAggregateNode(topic.id)
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
