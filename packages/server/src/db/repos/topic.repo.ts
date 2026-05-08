import { eq } from 'drizzle-orm'
import type { Topic } from '@agent-chat/protocol'
import { topics } from '../schema'
import { getDb } from '../migrate'
import { ulid } from 'ulid'

export function createTopic(input: {
  name: string
  kind: Topic['kind']
  agentType: Topic['agent_type']
  programmingSpecJson?: string | null
  generalSpecJson?: string | null
  sopTemplateId?: string | null
  currentModel?: string | null
}): Topic {
  const now = Date.now()
  const row = {
    id: ulid(),
    name: input.name,
    kind: input.kind,
    agentType: input.agentType,
    piSessionId: null,
    programmingSpecJson: input.programmingSpecJson ?? null,
    generalSpecJson: input.generalSpecJson ?? null,
    sopTemplateId: input.sopTemplateId ?? null,
    currentModel: input.currentModel ?? null,
    historyFrozenAt: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  getDb().insert(topics).values(row).run()
  return toDomain(row)
}

export function getTopic(id: string): Topic | undefined {
  const rows = getDb().select().from(topics).where(eq(topics.id, id)).all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export function listTopics(): Topic[] {
  const rows = getDb()
    .select()
    .from(topics)
    .where(eq(topics.archived, false))
    .all()
  return rows.map(toDomain)
}

export function updateTopic(
  id: string,
  data: Partial<
    Pick<
      Topic,
      | 'name'
      | 'pi_session_id'
      | 'agent_type'
      | 'current_model'
      | 'history_frozen_at'
      | 'programming_spec_json'
      | 'general_spec_json'
    >
  >,
): Topic | undefined {
  const db = getDb()
  const existing = getTopic(id)
  if (!existing) return undefined

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      const col = k as string
      updates[col] = v
    }
  }
  db.update(topics)
    .set(updates)
    .where(eq(topics.id, id))
    .run()
  return getTopic(id)
}

export function deleteTopic(id: string): boolean {
  const topic = getTopic(id)
  if (!topic) return false
  if (topic.kind !== 'normal') return false // system topics cannot be deleted

  getDb()
    .update(topics)
    .set({ archived: true, updatedAt: Date.now() })
    .where(eq(topics.id, id))
    .run()
  return true
}

export function upsertSystemTopic(
  id: string,
  name: string,
  kind: Topic['kind'],
): Topic {
  const existing = getDb()
    .select()
    .from(topics)
    .where(eq(topics.id, id))
    .get()
  if (existing) return toDomain(existing)

  const now = Date.now()
  const row = {
    id,
    name,
    kind,
    agentType: 'general' as const,
    piSessionId: null,
    programmingSpecJson: null,
    generalSpecJson: null,
    sopTemplateId: null,
    currentModel: null,
    historyFrozenAt: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  getDb().insert(topics).values(row).run()
  return toDomain(row)
}

function toDomain(row: Record<string, unknown>): Topic {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as Topic['kind'],
    agent_type: row.agentType as Topic['agent_type'],
    pi_session_id: (row.piSessionId as string) || null,
    programming_spec_json: (row.programmingSpecJson as string) || null,
    general_spec_json: (row.generalSpecJson as string) || null,
    sop_template_id: (row.sopTemplateId as string) || null,
    current_model: (row.currentModel as string) || null,
    history_frozen_at: (row.historyFrozenAt as number) || null,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
    archived: Boolean(row.archived),
  }
}
