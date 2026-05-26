/**
 * Server-side PI event log buffer for debugging
 * Stores recent PI events and outbound gateway activity for cross-validation
 */

interface LogEntry {
  ts: number
  source: 'pi-client' | 'gateway'
  sessionId?: string
  eventKind: string
  seq?: number
  // BUG-046 — cross-hop correlation keys for aligning with adapter logs.
  turnId?: string
  messageId?: string
  topicId?: string
  clientMessageId?: string
  attempt?: number
  status?: string
  payloadPreview: string
}

const MAX_ENTRIES = 500
const entries: LogEntry[] = []

export function logPiEvent(
  sessionId: string,
  event: { seq: number; turnId?: string; payload?: { kind?: string; messageId?: string }; [key: string]: unknown },
) {
  const kind = event.payload?.kind ?? 'unknown'
  const preview = JSON.stringify(event.payload).slice(0, 200)
  entries.push({
    ts: Date.now(),
    source: 'pi-client',
    sessionId,
    eventKind: kind,
    seq: event.seq,
    turnId: event.turnId,
    messageId: event.payload?.messageId,
    payloadPreview: preview,
  })
  // Keep only recent entries
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function logGatewayEvent(input: {
  eventKind: string
  topicId?: string
  sessionId?: string
  messageId?: string
  clientMessageId?: string
  turnId?: string
  attempt?: number
  status?: string
  payload?: unknown
}) {
  const preview = JSON.stringify(input.payload ?? {}).slice(0, 400)
  entries.push({
    ts: Date.now(),
    source: 'gateway',
    sessionId: input.sessionId,
    eventKind: input.eventKind,
    turnId: input.turnId,
    messageId: input.messageId,
    topicId: input.topicId,
    clientMessageId: input.clientMessageId,
    attempt: input.attempt,
    status: input.status,
    payloadPreview: preview,
  })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function getLogs() {
  return {
    ok: true,
    count: entries.length,
    entries: entries.slice().reverse(), // Most recent first
  }
}

export function clearLogs() {
  entries.length = 0
}
