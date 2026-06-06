import { eq, desc, and } from 'drizzle-orm'
import { attentionGoalSnapshots } from '../schema'
import { getDb, getD1 } from '../migrate'
import { ulid } from '../../lib/ulid'

export interface AttentionGoalSnapshotMeta {
  id: string
  topic_id: string
  goal_text: string
  title: string | null
  is_default: boolean
  active: boolean
  source_message_count: number
  source_last_event_ts: number
  created_at: number
  updated_at: number
  has_snapshot: boolean
}

export interface AttentionGoalSnapshot extends AttentionGoalSnapshotMeta {
  goal_json: string | null
  raw_events_json: string
  candidates_json: string
  interpret_json: string
  trace_nodes_json: string
  plan_items_json: string
}

const EMPTY_JSON = '[]'

export async function listAttentionGoals(topicId: string): Promise<AttentionGoalSnapshotMeta[]> {
  const rows = await getDb()
    .select()
    .from(attentionGoalSnapshots)
    .where(eq(attentionGoalSnapshots.topicId, topicId))
    .orderBy(desc(attentionGoalSnapshots.active), desc(attentionGoalSnapshots.updatedAt))
    .all()
  return rows.map(toMeta)
}

export async function getAttentionGoalSnapshot(id: string): Promise<AttentionGoalSnapshot | null> {
  const row = await getDb()
    .select()
    .from(attentionGoalSnapshots)
    .where(eq(attentionGoalSnapshots.id, id))
    .get()
  return row ? toSnapshot(row) : null
}

export async function getActiveAttentionGoal(topicId: string): Promise<AttentionGoalSnapshot | null> {
  const row = await getDb()
    .select()
    .from(attentionGoalSnapshots)
    .where(and(eq(attentionGoalSnapshots.topicId, topicId), eq(attentionGoalSnapshots.active, true)))
    .get()
  return row ? toSnapshot(row) : null
}

export async function ensureDefaultAttentionGoal(input: {
  topicId: string
  goalText: string
  title?: string | null
}): Promise<AttentionGoalSnapshot> {
  const existing = await getDb()
    .select()
    .from(attentionGoalSnapshots)
    .where(and(eq(attentionGoalSnapshots.topicId, input.topicId), eq(attentionGoalSnapshots.isDefault, true)))
    .get()
  if (existing) return toSnapshot(existing)
  return createAttentionGoal({
    topicId: input.topicId,
    goalText: input.goalText,
    title: input.title ?? '默认目标',
    isDefault: true,
    active: true,
  })
}

export async function createAttentionGoal(input: {
  topicId: string
  goalText: string
  title?: string | null
  isDefault?: boolean
  active?: boolean
}): Promise<AttentionGoalSnapshot> {
  const now = Date.now()
  const id = ulid()
  if (input.active ?? true) await clearActive(input.topicId)
  const row = {
    id,
    topicId: input.topicId,
    goalText: input.goalText,
    title: input.title ?? null,
    isDefault: input.isDefault ?? false,
    active: input.active ?? true,
    sourceMessageCount: 0,
    sourceLastEventTs: 0,
    goalJson: null,
    rawEventsJson: EMPTY_JSON,
    candidatesJson: EMPTY_JSON,
    interpretJson: '{}',
    traceNodesJson: EMPTY_JSON,
    planItemsJson: EMPTY_JSON,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(attentionGoalSnapshots).values(row).run()
  return (await getAttentionGoalSnapshot(id))!
}

export async function activateAttentionGoal(id: string): Promise<AttentionGoalSnapshot | null> {
  const existing = await getAttentionGoalSnapshot(id)
  if (!existing) return null
  await clearActive(existing.topic_id)
  await getDb()
    .update(attentionGoalSnapshots)
    .set({ active: true, updatedAt: Date.now() })
    .where(eq(attentionGoalSnapshots.id, id))
    .run()
  return getAttentionGoalSnapshot(id)
}

export async function renameAttentionGoal(input: { id: string; title: string | null }): Promise<AttentionGoalSnapshot | null> {
  const existing = await getAttentionGoalSnapshot(input.id)
  if (!existing) return null
  await getDb()
    .update(attentionGoalSnapshots)
    .set({ title: input.title, updatedAt: Date.now() })
    .where(eq(attentionGoalSnapshots.id, input.id))
    .run()
  return getAttentionGoalSnapshot(input.id)
}

export async function upsertAttentionGoalSnapshot(input: {
  id: string
  goalJson: string | null
  rawEventsJson: string
  candidatesJson: string
  interpretJson: string
  traceNodesJson: string
  planItemsJson: string
  sourceMessageCount: number
  sourceLastEventTs: number
}): Promise<AttentionGoalSnapshot | null> {
  const existing = await getAttentionGoalSnapshot(input.id)
  if (!existing) return null
  await getDb()
    .update(attentionGoalSnapshots)
    .set({
      goalJson: input.goalJson,
      rawEventsJson: input.rawEventsJson,
      candidatesJson: input.candidatesJson,
      interpretJson: input.interpretJson,
      traceNodesJson: input.traceNodesJson,
      planItemsJson: input.planItemsJson,
      sourceMessageCount: input.sourceMessageCount,
      sourceLastEventTs: input.sourceLastEventTs,
      updatedAt: Date.now(),
    })
    .where(eq(attentionGoalSnapshots.id, input.id))
    .run()
  return getAttentionGoalSnapshot(input.id)
}

async function clearActive(topicId: string): Promise<void> {
  await getD1()
    .prepare('UPDATE attention_goal_snapshots SET active = 0 WHERE topic_id = ?')
    .bind(topicId)
    .run()
}

function toMeta(row: Record<string, unknown>): AttentionGoalSnapshotMeta {
  const sourceMessageCount = Number(row.sourceMessageCount ?? 0)
  const sourceLastEventTs = Number(row.sourceLastEventTs ?? 0)
  return {
    id: row.id as string,
    topic_id: row.topicId as string,
    goal_text: row.goalText as string,
    title: (row.title as string) || null,
    is_default: Boolean(row.isDefault),
    active: Boolean(row.active),
    source_message_count: sourceMessageCount,
    source_last_event_ts: sourceLastEventTs,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
    has_snapshot: sourceMessageCount > 0 || sourceLastEventTs > 0,
  }
}

function toSnapshot(row: Record<string, unknown>): AttentionGoalSnapshot {
  return {
    ...toMeta(row),
    goal_json: (row.goalJson as string) || null,
    raw_events_json: (row.rawEventsJson as string) || EMPTY_JSON,
    candidates_json: (row.candidatesJson as string) || EMPTY_JSON,
    interpret_json: (row.interpretJson as string) || '{}',
    trace_nodes_json: (row.traceNodesJson as string) || EMPTY_JSON,
    plan_items_json: (row.planItemsJson as string) || EMPTY_JSON,
  }
}
