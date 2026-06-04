import type { PlanItem, TraceNode } from './types'

export interface PlanGraphItem {
  id: string
  text: string
  status: PlanItem['status']
  depth: number
  nodeIds: string[]
  evidenceCount: number
}

export interface PlanGraph {
  items: PlanGraphItem[]
  inboxNodeIds: string[]
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s,，。:：/\\|()[\]{}"'`]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2),
  )
}

function overlapScore(a: string, b: string): number {
  const at = tokens(a)
  const bt = tokens(b)
  if (!at.size || !bt.size) return 0
  let overlap = 0
  for (const t of at) if (bt.has(t)) overlap += 1
  return overlap / Math.max(at.size, bt.size)
}

function bestPlanItem(node: TraceNode, items: PlanItem[]): PlanItem | null {
  if (node.planned_ref) {
    const exact = items.find((item) => item.id === node.planned_ref)
    if (exact) return exact
  }
  let best: { item: PlanItem; score: number } | null = null
  const nodeText = `${node.user_message} ${node.conclusion ?? ''}`
  for (const item of items) {
    const score = overlapScore(nodeText, item.text)
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= 0.18 ? best.item : null
}

export function projectPlanGraph(planItems: PlanItem[], traceNodes: TraceNode[]): PlanGraph {
  const itemMap = new Map<string, PlanGraphItem>()
  for (const item of planItems) {
    itemMap.set(item.id, {
      id: item.id,
      text: item.text,
      status: item.status,
      depth: item.depth,
      nodeIds: [],
      evidenceCount: 0,
    })
  }

  const inboxNodeIds: string[] = []
  for (const node of traceNodes) {
    const item = bestPlanItem(node, planItems)
    if (!item) {
      inboxNodeIds.push(node.id)
      continue
    }
    const graphItem = itemMap.get(item.id)
    if (!graphItem) continue
    graphItem.nodeIds.push(node.id)
    graphItem.evidenceCount += node.event_ids.length
  }

  return {
    items: [...itemMap.values()],
    inboxNodeIds,
  }
}
