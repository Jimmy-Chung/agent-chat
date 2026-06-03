import type { GoalAnchor, TraceExchange, TraceNode } from './types'

export type AttentionTreeNodeKind = 'goal' | 'phase' | 'exchange'

export interface AttentionTreeNode {
  id: string
  kind: AttentionTreeNodeKind
  parentId: string | null
  title: string
  detail: string
  goalDistance: number
  status: TraceNode['status']
  eventIds: string[]
  childCount: number
  sourceNodeId?: string
  sourceExchangeId?: string
}

export interface AttentionTreeEdge {
  id: string
  source: string
  target: string
}

export interface AttentionTree {
  nodes: AttentionTreeNode[]
  edges: AttentionTreeEdge[]
}

function exchangeTitle(exchange: TraceExchange): string {
  if (exchange.user_kind === 'choice') return `选择：${exchange.user_message}`
  if (exchange.user_kind === 'question') return `问题：${exchange.user_message}`
  return exchange.user_message
}

export function buildAttentionTree(
  traceNodes: TraceNode[],
  goalAnchor: GoalAnchor | null,
  expandedIds: ReadonlySet<string> = new Set(),
): AttentionTree {
  const rootId = 'goal_root'
  const root: AttentionTreeNode = {
    id: rootId,
    kind: 'goal',
    parentId: null,
    title: goalAnchor?.normalized_goal || '未识别目标',
    detail: goalAnchor?.raw_query ?? '',
    goalDistance: traceNodes.length ? Math.max(...traceNodes.map((n) => n.goal_distance)) : 0,
    status: traceNodes.some((n) => n.status === 'running') ? 'running' : 'done',
    eventIds: traceNodes.flatMap((n) => n.event_ids),
    childCount: traceNodes.length,
  }

  const nodes: AttentionTreeNode[] = [root]
  const edges: AttentionTreeEdge[] = []

  for (const traceNode of traceNodes) {
    const phaseId = `phase_${traceNode.id}`
    nodes.push({
      id: phaseId,
      kind: 'phase',
      parentId: rootId,
      title: traceNode.conclusion || traceNode.user_message,
      detail: traceNode.user_message,
      goalDistance: traceNode.goal_distance,
      status: traceNode.status,
      eventIds: traceNode.event_ids,
      childCount: traceNode.exchanges?.length ?? 0,
      sourceNodeId: traceNode.id,
    })
    edges.push({ id: `edge_${rootId}_${phaseId}`, source: rootId, target: phaseId })

    if (!expandedIds.has(phaseId)) continue
    for (const exchange of traceNode.exchanges ?? []) {
      const exchangeId = `exchange_${exchange.id}`
      nodes.push({
        id: exchangeId,
        kind: 'exchange',
        parentId: phaseId,
        title: exchangeTitle(exchange),
        detail: exchange.assistant_summary,
        goalDistance: traceNode.goal_distance,
        status: traceNode.status,
        eventIds: exchange.event_ids,
        childCount: 0,
        sourceNodeId: traceNode.id,
        sourceExchangeId: exchange.id,
      })
      edges.push({ id: `edge_${phaseId}_${exchangeId}`, source: phaseId, target: exchangeId })
    }
  }

  return { nodes, edges }
}
