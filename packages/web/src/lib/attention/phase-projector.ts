import type { TraceNode } from './types'

export type PhaseNode = TraceNode & {
  level: 0 | 1
  collapsed: boolean
  children: TraceNode[]
}

export interface PhaseProjection {
  phases: PhaseNode[]
  compressedCount: number
}

const DEFAULT_MAX_PHASES = 7

function isBoundary(prev: TraceNode, next: TraceNode): boolean {
  if (next.user_kind === 'question' || next.user_kind === 'proposal') return true
  if (next.goal_distance >= 0.7 && prev.goal_distance < 0.7) return true
  if ((next.ts_start ?? 0) - (prev.ts_end ?? prev.ts_start ?? 0) > 20 * 60 * 1000) return true
  return false
}

function summarizePhase(nodes: TraceNode[], index: number): PhaseNode {
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const eventIds = nodes.flatMap((n) => n.event_ids)
  const stepCount = nodes.reduce((sum, n) => sum + n.step_count, 0)
  const maxDistance = Math.max(...nodes.map((n) => n.goal_distance))
  return {
    ...first,
    id: `phase_${index}_${first.id}`,
    level: 0,
    collapsed: nodes.length > 1,
    parent_id: null,
    branch_id: 'main',
    conclusion: nodes.length === 1 ? first.conclusion : `${first.conclusion ?? first.user_message} → ${last.conclusion ?? last.user_message}`,
    user_message: nodes.length === 1 ? first.user_message : `${nodes.length} 轮：${first.user_message}`,
    goal_distance: maxDistance,
    status: nodes.some((n) => n.status === 'running') ? 'running' : last.status,
    event_ids: eventIds,
    step_count: stepCount,
    user_message_count: nodes.reduce((sum, n) => sum + (n.user_message_count ?? 1), 0),
    exchanges: nodes.flatMap((n) => n.exchanges ?? []),
    ts_start: first.ts_start,
    ts_end: last.ts_end,
    is_loading: nodes.some((n) => n.is_loading),
    children: nodes.map((n) => ({ ...n, parent_id: `phase_${index}_${first.id}` })),
  }
}

export function projectPhases(nodes: TraceNode[], maxPhases = DEFAULT_MAX_PHASES): PhaseProjection {
  if (nodes.length === 0) return { phases: [], compressedCount: 0 }
  const buckets: TraceNode[][] = []
  for (const node of nodes) {
    const prevBucket = buckets[buckets.length - 1]
    const prevNode = prevBucket?.[prevBucket.length - 1]
    if (!prevBucket || !prevNode || (buckets.length < maxPhases && isBoundary(prevNode, node))) {
      buckets.push([node])
    } else {
      prevBucket.push(node)
    }
  }

  while (buckets.length > maxPhases) {
    let mergeAt = 0
    let smallest = Number.POSITIVE_INFINITY
    for (let i = 0; i < buckets.length - 1; i++) {
      const size = buckets[i].length + buckets[i + 1].length
      if (size < smallest) {
        smallest = size
        mergeAt = i
      }
    }
    buckets[mergeAt] = [...buckets[mergeAt], ...buckets[mergeAt + 1]]
    buckets.splice(mergeAt + 1, 1)
  }

  const phases = buckets.map((bucket, i) => summarizePhase(bucket, i + 1))
  return {
    phases,
    compressedCount: nodes.length - phases.length,
  }
}
