import { eq, and, desc } from 'drizzle-orm'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { messages, messageParts } from '../schema'
import { getDb, getSqlite } from '../migrate'
import { ulid } from 'ulid'

// ─── Message CRUD ──────────────────────────────────────────────────

export function createMessage(input: {
  topicId: string
  role: Message['role']
  status?: Message['status']
  cronRunId?: string | null
  id?: string
}): Message {
  const row = {
    id: input.id ?? ulid(),
    topicId: input.topicId,
    role: input.role,
    status: input.status ?? 'streaming',
    startedAt: Date.now(),
    finishedAt: null,
    stopReason: null,
    cronRunId: input.cronRunId ?? null,
  }
  getDb().insert(messages).values(row).run()
  return toMessageDomain(row)
}

export function getMessage(id: string): Message | undefined {
  const rows = getDb()
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .all()
  return rows[0] ? toMessageDomain(rows[0]) : undefined
}

export function updateMessage(
  id: string,
  data: Partial<
    Pick<Message, 'status' | 'finished_at' | 'stop_reason'>
  >,
): void {
  const updates: Record<string, unknown> = {}
  if (data.status !== undefined) updates.status = data.status
  if (data.finished_at !== undefined) updates.finishedAt = data.finished_at
  if (data.stop_reason !== undefined) updates.stopReason = data.stop_reason

  if (Object.keys(updates).length > 0) {
    getDb()
      .update(messages)
      .set(updates)
      .where(eq(messages.id, id))
      .run()
  }
}

export function listMessagesByTopic(
  topicId: string,
  limit = 100,
): Message[] {
  const rows = getDb()
    .select()
    .from(messages)
    .where(eq(messages.topicId, topicId))
    .orderBy(desc(messages.startedAt))
    .limit(limit)
    .all()
  return rows.map(toMessageDomain).reverse()
}

// ─── MessagePart CRUD ──────────────────────────────────────────────

export function createMessagePart(input: {
  messageId: string
  kind: MessagePart['kind']
  contentJson: string
}): MessagePart {
  // Get next ordinal
  const existing = getDb()
    .select({ ordinal: messageParts.ordinal })
    .from(messageParts)
    .where(eq(messageParts.messageId, input.messageId))
    .all()
  const ordinal = existing.length

  const row = {
    id: ulid(),
    messageId: input.messageId,
    ordinal,
    kind: input.kind,
    contentJson: input.contentJson,
  }
  getDb().insert(messageParts).values(row).run()
  return toPartDomain(row)
}

export function getMessageParts(messageId: string): MessagePart[] {
  const rows = getDb()
    .select()
    .from(messageParts)
    .where(eq(messageParts.messageId, messageId))
    .orderBy(messageParts.ordinal)
    .all()
  return rows.map(toPartDomain)
}

export function updateMessagePartContent(
  id: string,
  contentJson: string,
): void {
  getDb()
    .update(messageParts)
    .set({ contentJson })
    .where(eq(messageParts.id, id))
    .run()
}

// ─── Batch flush helpers ───────────────────────────────────────────

interface PendingPart {
  id: string
  messageId: string
  ordinal: number
  kind: MessagePart['kind']
  contentJson: string
}

const pendingParts = new Map<string, PendingPart>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const FLUSH_INTERVAL_MS = 100
const FLUSH_SIZE_THRESHOLD = 32 * 1024

export function bufferPartDelta(
  messageId: string,
  kind: MessagePart['kind'],
  contentJson: string,
): void {
  const key = `${messageId}:${kind}`
  const existing = pendingParts.get(key)

  if (existing) {
    existing.contentJson = contentJson
  } else {
    const parts = getMessageParts(messageId)
    const ordinal = parts.length
    const id = ulid()
    pendingParts.set(key, {
      id,
      messageId,
      ordinal,
      kind,
      contentJson,
    })
  }

  const totalSize = [...pendingParts.values()].reduce(
    (sum, p) => sum + p.contentJson.length,
    0,
  )

  if (totalSize >= FLUSH_SIZE_THRESHOLD) {
    flushParts()
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushParts, FLUSH_INTERVAL_MS)
  }
}

export function flushParts(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingParts.size === 0) return

  const entries = [...pendingParts.values()]
  pendingParts.clear()

  const db = getDb()
  for (const p of entries) {
    // Check if part already exists in DB for this message+ordinal
    const existing = db
      .select()
      .from(messageParts)
      .where(
        and(
          eq(messageParts.messageId, p.messageId),
          eq(messageParts.ordinal, p.ordinal),
        ),
      )
      .get()

    if (existing) {
      db.update(messageParts)
        .set({ contentJson: p.contentJson })
        .where(eq(messageParts.id, existing.id))
        .run()
    } else {
      db.insert(messageParts).values(p).run()
    }
  }
}

// ─── FTS5 ──────────────────────────────────────────────────────────

export function indexMessageForSearch(
  messageId: string,
  topicId: string,
  content: string,
): void {
  const sqlite = getSqlite()
  sqlite
    .prepare(
      'INSERT OR REPLACE INTO messages_fts(message_id, topic_id, content) VALUES (?, ?, ?)',
    )
    .run(messageId, topicId, content)
}

export function searchMessages(
  query: string,
  topicId?: string,
  limit = 50,
): Array<{ messageId: string; topicId: string; content: string; rank: number }> {
  const sqlite = getSqlite()
  if (topicId) {
    return sqlite
      .prepare(
        `SELECT message_id, topic_id, content, rank
         FROM messages_fts
         WHERE messages_fts MATCH ? AND topic_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, topicId, limit) as Array<{
      messageId: string
      topicId: string
      content: string
      rank: number
    }>
  }
  return sqlite
    .prepare(
      `SELECT message_id, topic_id, content, rank
       FROM messages_fts
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as Array<{
    messageId: string
    topicId: string
    content: string
    rank: number
  }>
}

// ─── Helpers ───────────────────────────────────────────────────────

function toMessageDomain(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    topic_id: row.topicId as string,
    role: row.role as Message['role'],
    status: row.status as Message['status'],
    started_at: row.startedAt as number,
    finished_at: (row.finishedAt as number) || null,
    stop_reason: (row.stopReason as string) || null,
    cron_run_id: (row.cronRunId as string) || null,
  }
}

function toPartDomain(row: Record<string, unknown>): MessagePart {
  return {
    id: row.id as string,
    message_id: row.messageId as string,
    ordinal: row.ordinal as number,
    kind: row.kind as MessagePart['kind'],
    content_json: row.contentJson as string,
  }
}
