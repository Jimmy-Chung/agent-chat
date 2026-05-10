import { eq, isNull } from 'drizzle-orm'
import type { Artifact } from '@agent-chat/protocol'
import { artifacts } from '../schema'
import { getDb } from '../migrate'
import { ulid } from 'ulid'

export function createArtifact(input: {
  id?: string
  topicId?: string | null
  originTopicId?: string | null
  name: string
  mime?: string | null
  sizeBytes?: number | null
  r2Key: string
  source: Artifact['source']
  metadataJson?: string | null
}): Artifact {
  const row = {
    id: input.id ?? ulid(),
    topicId: input.topicId ?? null,
    originTopicId: input.originTopicId ?? null,
    name: input.name,
    mime: input.mime ?? null,
    sizeBytes: input.sizeBytes ?? null,
    r2Key: input.r2Key,
    source: input.source,
    createdAt: Date.now(),
    metadataJson: input.metadataJson ?? null,
  }
  getDb().insert(artifacts).values(row).run()
  return toDomain(row)
}

export function getArtifact(id: string): Artifact | undefined {
  const rows = getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, id))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export function listArtifactsByTopic(topicId: string): Artifact[] {
  const rows = getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.topicId, topicId))
    .all()
  return rows.map(toDomain)
}

export function listPoolArtifacts(): Artifact[] {
  const rows = getDb()
    .select()
    .from(artifacts)
    .where(isNull(artifacts.topicId))
    .all()
  return rows.map(toDomain)
}

export function updateArtifactTopic(
  id: string,
  topicId: string | null,
): Artifact | undefined {
  getDb()
    .update(artifacts)
    .set({ topicId })
    .where(eq(artifacts.id, id))
    .run()
  return getArtifact(id)
}

export function deleteArtifact(id: string): boolean {
  const result = getDb()
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .run()
  return result.changes > 0
}

function toDomain(row: Record<string, unknown>): Artifact {
  return {
    id: row.id as string,
    topic_id: (row.topicId as string) || null,
    origin_topic_id: (row.originTopicId as string) || null,
    name: row.name as string,
    mime: (row.mime as string) || null,
    size_bytes: (row.sizeBytes as number) || null,
    r2_key: row.r2Key as string,
    source: row.source as Artifact['source'],
    created_at: row.createdAt as number,
    metadata_json: (row.metadataJson as string) || null,
  }
}
