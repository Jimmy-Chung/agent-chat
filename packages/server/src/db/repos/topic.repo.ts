import { eq, and, ne } from 'drizzle-orm'
import type { Topic } from '@agent-chat/protocol'
import { topics } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

function normalizeCwd(cwd: string): string {
  return cwd.trim().replace(/\/+$/, '') || '/'
}

function parseProgrammingSpec(topic: Topic): { cwd?: string } | null {
  if (!topic.programming_spec_json) return null
  try {
    return JSON.parse(topic.programming_spec_json) as { cwd?: string }
  } catch {
    return null
  }
}

export async function createTopic(input: {
  name: string
  kind: Topic['kind']
  agentType: Topic['agent_type']
  programmingSpecJson?: string | null
  generalSpecJson?: string | null
  sopTemplateId?: string | null
  currentModel?: string | null
}): Promise<Topic> {
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
    planMode: false,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  await getDb().insert(topics).values(row).run()
  return toDomain(row)
}

export async function getTopic(id: string): Promise<Topic | undefined> {
  const rows = await getDb().select().from(topics).where(eq(topics.id, id)).all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export async function getTopicByName(name: string): Promise<Topic | undefined> {
  const rows = await getDb()
    .select()
    .from(topics)
    .where(and(eq(topics.name, name), eq(topics.archived, false)))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export async function listTopics(): Promise<Topic[]> {
  const rows = await getDb()
    .select()
    .from(topics)
    .where(eq(topics.archived, false))
    .all()
  return rows.map(toDomain)
}

export async function getTopicByCwd(cwd: string, excludeTopicId?: string): Promise<Topic | undefined> {
  const normalized = normalizeCwd(cwd)
  const rows = await getDb()
    .select()
    .from(topics)
    .where(
      excludeTopicId
        ? and(eq(topics.archived, false), eq(topics.agentType, 'programming'), ne(topics.id, excludeTopicId))
        : and(eq(topics.archived, false), eq(topics.agentType, 'programming')),
    )
    .all()

  return rows
    .map(toDomain)
    .find((topic) => {
      const spec = parseProgrammingSpec(topic)
      if (!spec?.cwd) return false
      return normalizeCwd(spec.cwd) === normalized
    })
}

const topicKeyMap: Record<string, string> = {
  name: 'name',
  pi_session_id: 'piSessionId',
  agent_type: 'agentType',
  current_model: 'currentModel',
  history_frozen_at: 'historyFrozenAt',
  programming_spec_json: 'programmingSpecJson',
  general_spec_json: 'generalSpecJson',
  plan_mode: 'planMode',
}

export async function updateTopic(
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
      | 'plan_mode'
    >
  >,
): Promise<Topic | undefined> {
  const db = getDb()
  const existing = await getTopic(id)
  if (!existing) return undefined

  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      const col = topicKeyMap[k] ?? k
      updates[col] = v
    }
  }
  await db.update(topics)
    .set(updates)
    .where(eq(topics.id, id))
    .run()
  return getTopic(id)
}

export async function deleteTopic(id: string): Promise<boolean> {
  const topic = await getTopic(id)
  if (!topic) return false
  if (topic.kind !== 'normal') return false

  await getDb()
    .update(topics)
    .set({ archived: true, updatedAt: Date.now() })
    .where(eq(topics.id, id))
    .run()
  return true
}

export async function upsertSystemTopic(
  id: string,
  name: string,
  kind: Topic['kind'],
): Promise<Topic> {
  const existing = await getDb()
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
    planMode: false,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  await getDb().insert(topics).values(row).run()
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
    plan_mode: Boolean(row.planMode),
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
    archived: Boolean(row.archived),
  }
}
