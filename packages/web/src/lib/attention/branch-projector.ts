import type { TraceNode } from './types'

export type AttentionBranchKind = 'main' | 'side'

export interface BranchedNode extends TraceNode {
  branchKind: AttentionBranchKind
  branchLabel: string
  parentMainId: string | null
}

export interface BranchEdge {
  id: string
  source: string
  target: string
  kind: 'progress' | 'branch' | 'return'
}

export interface BranchProjection {
  nodes: BranchedNode[]
  edges: BranchEdge[]
  branchCount: number
}

function shouldBranch(node: TraceNode): boolean {
  if (node.branch_id !== 'main') return true
  if (node.goal_distance >= 0.68) return true
  if (node.user_kind === 'question' && node.goal_distance >= 0.5) return true
  return false
}

function branchLabel(node: TraceNode, index: number): string {
  if (node.user_kind === 'question') return `支线 ${index}: 问题`
  if (node.user_kind === 'proposal') return `支线 ${index}: 方案`
  return `支线 ${index}: 偏离目标`
}

export function projectBranches(nodes: TraceNode[]): BranchProjection {
  const projected: BranchedNode[] = []
  const edges: BranchEdge[] = []
  let lastMain: TraceNode | null = null
  let lastInBranch: BranchedNode | null = null
  let branchCount = 0

  for (const node of nodes) {
    const side = shouldBranch(node)
    if (!side) {
      const projectedNode: BranchedNode = {
        ...node,
        branch_id: 'main',
        branchKind: 'main',
        branchLabel: '主目标',
        parentMainId: null,
      }
      if (lastMain) {
        edges.push({ id: `edge_${lastMain.id}_${node.id}`, source: lastMain.id, target: node.id, kind: 'progress' })
      }
      if (lastInBranch) {
        edges.push({ id: `return_${lastInBranch.id}_${node.id}`, source: lastInBranch.id, target: node.id, kind: 'return' })
      }
      projected.push(projectedNode)
      lastMain = node
      lastInBranch = null
      continue
    }

    if (!lastInBranch) branchCount += 1
    const parentMainId = lastMain?.id ?? null
    const projectedNode: BranchedNode = {
      ...node,
      branch_id: `side_${branchCount}`,
      branchKind: 'side',
      branchLabel: branchLabel(node, branchCount),
      parentMainId,
    }
    const source = lastInBranch?.id ?? parentMainId
    if (source) {
      edges.push({
        id: `edge_${source}_${node.id}`,
        source,
        target: node.id,
        kind: lastInBranch ? 'progress' : 'branch',
      })
    }
    projected.push(projectedNode)
    lastInBranch = projectedNode
  }

  return { nodes: projected, edges, branchCount }
}
