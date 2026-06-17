import { desc, eq, and, gte, lte, lt } from 'drizzle-orm'
import { getDb } from './db/migrate'
import { auditLog } from './db/schema'

export interface ServerLogEntry {
  ts: number
  source: 'pi-client' | 'gateway'
  sessionId?: string
  eventKind: string
  seq?: number
  turnId?: string
  messageId?: string
  topicId?: string
  clientMessageId?: string
  attempt?: number
  status?: string
  payloadPreview: string
}

export interface GatewayLogInput {
  eventKind: string
  topicId?: string
  sessionId?: string
  messageId?: string
  clientMessageId?: string
  turnId?: string
  attempt?: number
  status?: string
  payload?: unknown
}

const MAX_PREVIEW_CHARS = 400

function normalizePayloadPreview(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? {}).slice(0, MAX_PREVIEW_CHARS)
  } catch {
    return '"[unserializable payload]"'
  }
}

function logDetail(entry: ServerLogEntry): string {
  return JSON.stringify(entry)
}

function parseEntry(detailJson: string | null): ServerLogEntry | null {
  if (!detailJson) return null
  try {
    const value = JSON.parse(detailJson) as ServerLogEntry
    return value
  } catch {
    return null
  }
}

export async function logPiEvent(
  sessionId: string,
  event: { seq: number; turnId?: string; payload?: { kind?: string; messageId?: string }; [key: string]: unknown },
) {
  const entry: ServerLogEntry = {
    ts: Date.now(),
    source: 'pi-client',
    sessionId,
    eventKind: event.payload?.kind ?? 'unknown',
    seq: event.seq,
    turnId: event.turnId,
    messageId: event.payload?.messageId,
    payloadPreview: normalizePayloadPreview(event.payload),
  }
  try {
    await getDb().insert(auditLog).values({
      ts: entry.ts,
      kind: 'server-log',
      detailJson: logDetail(entry),
    }).run()
  } catch {
    // Debug logging must never break the PI event path.
  }
}

export async function logGatewayEvent(input: GatewayLogInput) {
  const entry: ServerLogEntry = {
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
    payloadPreview: normalizePayloadPreview(input.payload),
  }
  try {
    await getDb().insert(auditLog).values({
      ts: entry.ts,
      kind: 'server-log',
      detailJson: logDetail(entry),
    }).run()
  } catch {
    // Debug logging must never break message delivery.
  }
}

export async function getLogs(input?: {
  sessionId?: string
  topicId?: string
  messageId?: string
  turnId?: string
  limit?: number
  from?: number
  to?: number
}) {
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500)
  const clauses = [eq(auditLog.kind, 'server-log')]
  if (input?.from) clauses.push(gte(auditLog.ts, input.from))
  if (input?.to) clauses.push(lte(auditLog.ts, input.to))

  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(clauses.length > 1 ? and(...clauses) : clauses[0])
    .orderBy(desc(auditLog.ts))
    .limit(limit)
    .all()

  const entries = rows
    .map((row) => parseEntry(row.detailJson ?? null))
    .filter((entry): entry is ServerLogEntry => !!entry)
    .filter((entry) => {
      if (input?.sessionId && entry.sessionId !== input.sessionId) return false
      if (input?.topicId && entry.topicId !== input.topicId) return false
      if (input?.messageId && entry.messageId !== input.messageId) return false
      if (input?.turnId && entry.turnId !== input.turnId) return false
      return true
    })

  return {
    ok: true,
    count: entries.length,
    entries,
  }
}

export async function clearLogs() {
  await getDb()
    .delete(auditLog)
    .where(eq(auditLog.kind, 'server-log'))
    .run()
}

// ─── R2 archival ──────────────────────────────────────────────────────────────

function utcDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function dayBounds(dateStr: string): { startTs: number; endTs: number } {
  return {
    startTs: new Date(`${dateStr}T00:00:00.000Z`).getTime(),
    endTs: new Date(`${dateStr}T23:59:59.999Z`).getTime(),
  }
}

export async function flushLogsToR2(
  r2: R2Bucket,
  dateStr: string,
): Promise<{ date: string; flushed: number }> {
  const { startTs, endTs } = dayBounds(dateStr)

  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.kind, 'server-log'), gte(auditLog.ts, startTs), lte(auditLog.ts, endTs)))
    .orderBy(auditLog.ts)
    .all()

  if (rows.length > 0) {
    const jsonl = rows.map((r) => r.detailJson ?? '{}').join('\n')
    await r2.put(`logs/${dateStr}.jsonl`, jsonl, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })
    await getDb()
      .delete(auditLog)
      .where(and(eq(auditLog.kind, 'server-log'), gte(auditLog.ts, startTs), lte(auditLog.ts, endTs)))
      .run()
  }

  return { date: dateStr, flushed: rows.length }
}

export async function flushAllHistoricalLogsToR2(
  r2: R2Bucket,
): Promise<{ dates: string[]; total: number }> {
  // Find distinct UTC dates of all logs older than today
  const todayStart = new Date(utcDateStr(Date.now()) + 'T00:00:00.000Z').getTime()
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.kind, 'server-log'), lt(auditLog.ts, todayStart)))
    .orderBy(auditLog.ts)
    .all()

  if (rows.length === 0) return { dates: [], total: 0 }

  // Group by date
  const byDate = new Map<string, string[]>()
  for (const row of rows) {
    const d = utcDateStr(row.ts)
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(row.detailJson ?? '{}')
  }

  // Write each day to R2
  for (const [date, lines] of byDate) {
    await r2.put(`logs/${date}.jsonl`, lines.join('\n'), {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })
  }

  // Clear all flushed rows from D1
  await getDb()
    .delete(auditLog)
    .where(and(eq(auditLog.kind, 'server-log'), lt(auditLog.ts, todayStart)))
    .run()

  return { dates: [...byDate.keys()], total: rows.length }
}

export async function getLogsFromR2(r2: R2Bucket, dateStr: string): Promise<ServerLogEntry[]> {
  const obj = await r2.get(`logs/${dateStr}.jsonl`)
  if (!obj) return []
  const text = await obj.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => parseEntry(line))
    .filter((e): e is ServerLogEntry => e !== null)
}
