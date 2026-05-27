import { eq, and, desc } from 'drizzle-orm'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { messages, messageParts } from '../schema'
import { getDb, getD1 } from '../migrate'
import { ulid } from '../../lib/ulid'

// ─── Message CRUD ──────────────────────────────────────────────────

export async function createMessage(input: {
  topicId: string
  role: Message['role']
    status?: Message['status']
    cronRunId?: string | null
    id?: string
    clientMessageId?: string | null
    retryCount?: number
    maxRetries?: number
  }): Promise<Message> {
  const row = {
    id: input.id ?? ulid(),
    topicId: input.topicId,
    role: input.role,
    status: input.status ?? 'streaming',
    startedAt: Date.now(),
    finishedAt: null,
    stopReason: null,
    cronRunId: input.cronRunId ?? null,
    clientMessageId: input.clientMessageId ?? null,
    retryCount: input.retryCount ?? 0,
    maxRetries: input.maxRetries ?? 2,
  }
  await getDb().insert(messages).values(row).run()
  return toMessageDomain(row)
}

export async function getMessage(id: string): Promise<Message | undefined> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .all()
  return rows[0] ? toMessageDomain(rows[0]) : undefined
}

export async function updateMessage(
  id: string,
  data: Partial<
    Pick<Message, 'status' | 'finished_at' | 'stop_reason' | 'retry_count' | 'max_retries'>
  >,
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (data.status !== undefined) updates.status = data.status
  if (data.finished_at !== undefined) updates.finishedAt = data.finished_at
  if (data.stop_reason !== undefined) updates.stopReason = data.stop_reason
  if (data.retry_count !== undefined) updates.retryCount = data.retry_count
  if (data.max_retries !== undefined) updates.maxRetries = data.max_retries

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(messages)
      .set(updates)
      .where(eq(messages.id, id))
      .run()
  }
}

export async function deleteMessage(id: string): Promise<void> {
  await getDb().delete(messageParts).where(eq(messageParts.messageId, id)).run()
  try {
    await getD1().prepare('DELETE FROM messages_fts WHERE message_id = ?').bind(id).run()
  } catch {
    // FTS may be unavailable in some local/test environments.
  }
  await getDb().delete(messages).where(eq(messages.id, id)).run()
}

export async function listMessagesByTopic(
  topicId: string,
  limit = 100,
): Promise<Message[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.topicId, topicId))
    .orderBy(desc(messages.startedAt))
    .limit(limit)
    .all()
  return rows.map(toMessageDomain).reverse()
}

// ─── MessagePart CRUD ──────────────────────────────────────────────

export async function createMessagePart(input: {
  messageId: string
  kind: MessagePart['kind']
  contentJson: string
}): Promise<MessagePart> {
  const existing = await getDb()
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
  await getDb().insert(messageParts).values(row).run()
  return toPartDomain(row)
}

export async function getMessageParts(messageId: string): Promise<MessagePart[]> {
  const rows = await getDb()
    .select()
    .from(messageParts)
    .where(eq(messageParts.messageId, messageId))
    .orderBy(messageParts.ordinal)
    .all()
  return rows.map(toPartDomain)
}

export async function updateMessagePartContent(
  id: string,
  contentJson: string,
): Promise<void> {
  await getDb()
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
// Flush lock: chain all flush calls so they run serially.
// Prevents concurrent flushParts executions racing on DB ordinal assignment,
// which previously caused duplicate ordinal entries for text/thinking parts.
let flushLock: Promise<void> = Promise.resolve()

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
    if (kind === 'text' || kind === 'thinking') {
      try {
        const prevData = JSON.parse(existing.contentJson)
        const newData = JSON.parse(contentJson)
        if (typeof newData.content === 'string') {
          prevData.content = (prevData.content ?? '') + newData.content
        }
        existing.contentJson = JSON.stringify(prevData)
      } catch {
        existing.contentJson = contentJson
      }
    } else {
      existing.contentJson = contentJson
    }
  } else {
    // For accumulative kinds we need to check DB — but bufferPartDelta is called synchronously
    // from event-router. We defer the DB check to flushParts.
    const reuseOrdinal = 0 // placeholder, resolved in flushParts
    pendingParts.set(key, {
      id: ulid(),
      messageId,
      ordinal: reuseOrdinal,
      kind,
      contentJson,
    })
  }

  const totalSize = [...pendingParts.values()].reduce(
    (sum, p) => sum + p.contentJson.length,
    0,
  )

  if (totalSize >= FLUSH_SIZE_THRESHOLD) {
    void flushParts()
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => { void flushParts() }, FLUSH_INTERVAL_MS)
  }
}

export function flushParts(): Promise<void> {
  // Chain onto the lock so concurrent calls always run sequentially.
  flushLock = flushLock.then(() => _doFlushParts()).catch((err) => {
    // Log but don't rethrow — a failed flush shouldn't break the chain.
    console.warn('[flushParts] error during flush:', err)
  })
  return flushLock
}

async function _doFlushParts(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingParts.size === 0) return

  const entries = [...pendingParts.values()]
  pendingParts.clear()

  const db = getDb()
  for (const p of entries) {
    // For text/thinking kinds, check if a DB part already exists to accumulate into
    if (p.kind === 'text' || p.kind === 'thinking') {
      const dbParts = await getMessageParts(p.messageId)
      const existingPart = dbParts.find((ep) => ep.kind === p.kind)
      if (existingPart) {
        // Accumulate with DB content
        try {
          const dbData = JSON.parse(existingPart.content_json)
          const newData = JSON.parse(p.contentJson)
          if (typeof newData.content === 'string' && typeof dbData.content === 'string') {
            dbData.content = dbData.content + newData.content
            p.contentJson = JSON.stringify(dbData)
          }
        } catch { /* keep new content */ }
        p.id = existingPart.id
        p.ordinal = existingPart.ordinal
      } else {
        p.ordinal = dbParts.length
      }
    } else {
      const dbParts = await getMessageParts(p.messageId)
      // Check if part at this ordinal already exists
      const existing = await db
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
        p.id = existing.id as string
      } else {
        p.ordinal = dbParts.length
      }
    }

    const existing = await db
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
      await db.update(messageParts)
        .set({ contentJson: p.contentJson })
        .where(eq(messageParts.id, existing.id as string))
        .run()
    } else {
      await db.insert(messageParts).values(p).run()
    }
  }
}

// ─── FTS5 ──────────────────────────────────────────────────────────

export async function indexMessageForSearch(
  messageId: string,
  topicId: string,
  content: string,
): Promise<void> {
  const d1 = getD1()
  await d1
    .prepare(
      'INSERT OR REPLACE INTO messages_fts(message_id, topic_id, content) VALUES (?, ?, ?)',
    )
    .bind(messageId, topicId, content)
    .run()
}

export async function searchMessages(
  query: string,
  topicId?: string,
  limit = 50,
): Promise<Array<{ messageId: string; topicId: string; content: string; rank: number }>> {
  const d1 = getD1()
  if (topicId) {
    const result = await d1
      .prepare(
        `SELECT message_id, topic_id, content, rank
         FROM messages_fts
         WHERE messages_fts MATCH ? AND topic_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .bind(query, topicId, limit)
      .all()
    return (result.results ?? []) as Array<{
      messageId: string
      topicId: string
      content: string
      rank: number
    }>
  }
  const result = await d1
    .prepare(
      `SELECT message_id, topic_id, content, rank
       FROM messages_fts
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .bind(query, limit)
    .all()
  return (result.results ?? []) as Array<{
    messageId: string
    topicId: string
    content: string
    rank: number
  }>
}

// ─── Stale streaming cleanup ────────────────────────────────────────

export async function finalizeStaleMessagesByTopic(topicId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.topicId, topicId),
        eq(messages.status, 'streaming'),
      ),
    )
    .all()

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id as string)
  const now = Date.now()
  for (const id of ids) {
    await getDb()
      .update(messages)
      .set({ status: 'done', finishedAt: now, stopReason: 'error' })
      .where(eq(messages.id, id))
      .run()
  }
  return ids
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
    turn_id: (row.turnId as string) || null,
    client_message_id: (row.clientMessageId as string) || null,
    retry_count: typeof row.retryCount === 'number' ? row.retryCount : 0,
    max_retries: typeof row.maxRetries === 'number' ? row.maxRetries : 2,
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
