/**
 * Server-side PI event log buffer for debugging
 * Stores recent PI events received from adapter for cross-validation
 */

interface LogEntry {
  ts: number
  source: 'pi-client'
  sessionId: string
  eventKind: string
  seq: number
  payloadPreview: string
}

const MAX_ENTRIES = 500
const entries: LogEntry[] = []

export function logPiEvent(sessionId: string, event: { seq: number; payload?: { kind?: string }; [key: string]: unknown }) {
  const kind = event.payload?.kind ?? 'unknown'
  const preview = JSON.stringify(event.payload).slice(0, 200)
  entries.push({
    ts: Date.now(),
    source: 'pi-client',
    sessionId,
    eventKind: kind,
    seq: event.seq,
    payloadPreview: preview,
  })
  // Keep only recent entries
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