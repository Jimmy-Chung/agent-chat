import type { TraceNode } from './types'

export function resolveFocusMessageId(sourceNodeIds: string[], traceById: Map<string, TraceNode>): string | null {
  for (const sourceNodeId of sourceNodeIds) {
    const node = traceById.get(sourceNodeId)
    if (!node) continue
    const direct = node.source_message_ids.find(Boolean)
    if (direct) return direct
    const fromExchanges = node.exchanges?.map((exchange) => exchange.message_id).find(Boolean)
    if (fromExchanges) return fromExchanges
  }
  return null
}
