import { eq } from 'drizzle-orm'
import type { Interaction } from '@agent-chat/protocol'
import { interactions } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

export async function createInteraction(input: {
  id?: string
  topicId: string
  messageId?: string | null
  kind: Interaction['kind']
  prompt: string
  optionsJson?: string | null
}): Promise<Interaction> {
  if (input.id) {
    const existing = await getInteraction(input.id)
    if (existing) return existing
  }
  const row = {
    id: input.id ?? ulid(),
    topicId: input.topicId,
    messageId: input.messageId ?? null,
    kind: input.kind,
    prompt: input.prompt,
    optionsJson: input.optionsJson ?? null,
    status: 'pending' as const,
    responseJson: null,
    createdAt: Date.now(),
    resolvedAt: null,
  }
  await getDb().insert(interactions).values(row).run()
  return toDomain(row)
}

export async function getInteraction(id: string): Promise<Interaction | undefined> {
  const rows = await getDb()
    .select()
    .from(interactions)
    .where(eq(interactions.id, id))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export async function updateInteraction(
  id: string,
  data: Partial<
    Pick<Interaction, 'status' | 'response_json' | 'resolved_at'>
  >,
): Promise<Interaction | undefined> {
  const updates: Record<string, unknown> = {}
  if (data.status !== undefined) updates.status = data.status
  if (data.response_json !== undefined)
    updates.responseJson = data.response_json
  if (data.resolved_at !== undefined) updates.resolvedAt = data.resolved_at

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(interactions)
      .set(updates)
      .where(eq(interactions.id, id))
      .run()
  }
  return getInteraction(id)
}

export async function listPendingInteractions(
  topicId: string,
): Promise<Interaction[]> {
  const rows = await getDb()
    .select()
    .from(interactions)
    .where(eq(interactions.topicId, topicId))
    .all()
  return rows
    .map(toDomain)
    .filter((i) => i.status === 'pending')
}

function toDomain(row: Record<string, unknown>): Interaction {
  return {
    id: row.id as string,
    topic_id: row.topicId as string,
    message_id: (row.messageId as string) || null,
    kind: row.kind as Interaction['kind'],
    prompt: row.prompt as string,
    options_json: (row.optionsJson as string) || null,
    status: row.status as Interaction['status'],
    response_json: (row.responseJson as string) || null,
    created_at: row.createdAt as number,
    resolved_at: (row.resolvedAt as number) || null,
  }
}
