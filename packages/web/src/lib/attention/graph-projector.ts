// S4：TraceNode[] → React Flow 图数据（纯函数，可单测）。
// v1 用横向链式布局（Phase 节点从左到右），节点 id 直接复用 TraceNode.id —— 实时 append
// 时已有节点的 id/position 稳定，新节点追加在右侧，不触发整树重排。
import type { TraceNode } from './types'

export const NODE_W = 200
export const NODE_GAP = 64
const NODE_Y = 0

export interface RFNode {
  id: string
  type: 'attention'
  position: { x: number; y: number }
  data: { node: TraceNode; index: number }
}
export interface RFEdge {
  id: string
  source: string
  target: string
}

export function buildGraphData(nodes: TraceNode[]): { nodes: RFNode[]; edges: RFEdge[] } {
  const rfNodes: RFNode[] = nodes.map((node, i) => ({
    id: node.id,
    type: 'attention',
    position: { x: i * (NODE_W + NODE_GAP), y: NODE_Y },
    data: { node, index: i },
  }))
  const edges: RFEdge[] = []
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ id: `e_${nodes[i - 1].id}__${nodes[i].id}`, source: nodes[i - 1].id, target: nodes[i].id })
  }
  return { nodes: rfNodes, edges }
}
