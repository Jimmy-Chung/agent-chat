import { and, desc, eq } from 'drizzle-orm'
import type { RawEvent } from '@agent-chat/protocol'
import { topicRuntimeEvents } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

export type TopicRuntimeEventKind = 'todo' | 'plan'

export interface TopicRuntimeEvent {
  id: string
  topic_id: string
  kind: TopicRuntimeEventKind
  ts: number
  message_id: string | null
  payload_json: string
}

export async function createTopicRuntimeEvent(input: {
  topicId: string
  kind: TopicRuntimeEventKind
  payload: unknown
  messageId?: string | null
  ts?: number
}): Promise<TopicRuntimeEvent> {
  const row = {
    id: ulid(),
    topicId: input.topicId,
    kind: input.kind,
    ts: input.ts ?? Date.now(),
    messageId: input.messageId ?? null,
    payloadJson: JSON.stringify(input.payload ?? {}),
  }
  await getDb().insert(topicRuntimeEvents).values(row).run()
  return toDomain(row)
}

export async function listTopicRuntimeEvents(topicId: string, limit = 500): Promise<TopicRuntimeEvent[]> {
  const rows = await getDb()
    .select()
    .from(topicRuntimeEvents)
    .where(eq(topicRuntimeEvents.topicId, topicId))
    .orderBy(desc(topicRuntimeEvents.ts))
    .limit(limit)
    .all()
  return rows.map(toDomain).reverse()
}

export async function getLatestTopicRuntimeEvent(
  topicId: string,
  kind: TopicRuntimeEventKind,
): Promise<TopicRuntimeEvent | undefined> {
  const rows = await getDb()
    .select()
    .from(topicRuntimeEvents)
    .where(and(eq(topicRuntimeEvents.topicId, topicId), eq(topicRuntimeEvents.kind, kind)))
    .orderBy(desc(topicRuntimeEvents.ts))
    .limit(1)
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export function runtimeEventToRawEvent(event: TopicRuntimeEvent): RawEvent {
  let payload: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(event.payload_json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>
    }
  } catch {
    payload = {}
  }
  return {
    id: event.id,
    ts: event.ts,
    kind: event.kind,
    role: 'assistant',
    message_id: event.message_id ?? undefined,
    payload,
  }
}

function toDomain(row: {
  id: string
  topicId?: string
  topic_id?: string
  kind: string
  ts: number
  messageId?: string | null
  message_id?: string | null
  payloadJson?: string
  payload_json?: string
}): TopicRuntimeEvent {
  return {
    id: row.id,
    topic_id: row.topicId ?? row.topic_id ?? '',
    kind: row.kind as TopicRuntimeEventKind,
    ts: row.ts,
    message_id: row.messageId ?? row.message_id ?? null,
    payload_json: row.payloadJson ?? row.payload_json ?? '{}',
  }
}
