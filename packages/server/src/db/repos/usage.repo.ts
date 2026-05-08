import { eq, and, gte, lte } from 'drizzle-orm'
import type { UsageRecord } from '@agent-chat/protocol'
import { usageRecords } from '../schema'
import { getDb } from '../migrate'

export function createUsageRecord(input: {
  topicId?: string | null
  messageId?: string | null
  model: string
  inputTokens: number
  outputTokens: number
  costMicroUsd?: number | null
}): void {
  getDb()
    .insert(usageRecords)
    .values({
      topicId: input.topicId ?? null,
      messageId: input.messageId ?? null,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costMicroUsd: input.costMicroUsd ?? null,
      createdAt: Date.now(),
    })
    .run()
}

export function getUsageByTopic(
  topicId: string,
  from?: number,
  to?: number,
): UsageRecord[] {
  const conditions = [eq(usageRecords.topicId, topicId)]
  if (from !== undefined) conditions.push(gte(usageRecords.createdAt, from))
  if (to !== undefined) conditions.push(lte(usageRecords.createdAt, to))

  const rows = getDb()
    .select()
    .from(usageRecords)
    .where(and(...conditions))
    .all()
  return rows.map(toDomain)
}

export function getUsageGlobal(
  from?: number,
  to?: number,
): UsageRecord[] {
  const conditions = []
  if (from !== undefined) conditions.push(gte(usageRecords.createdAt, from))
  if (to !== undefined) conditions.push(lte(usageRecords.createdAt, to))

  const rows = conditions.length
    ? getDb()
        .select()
        .from(usageRecords)
        .where(and(...conditions))
        .all()
    : getDb().select().from(usageRecords).all()
  return rows.map(toDomain)
}

function toDomain(row: Record<string, unknown>): UsageRecord {
  return {
    id: row.id as number,
    topic_id: (row.topicId as string) || null,
    message_id: (row.messageId as string) || null,
    model: row.model as string,
    input_tokens: row.inputTokens as number,
    output_tokens: row.outputTokens as number,
    cost_micro_usd: (row.costMicroUsd as number) || null,
    created_at: row.createdAt as number,
  }
}
