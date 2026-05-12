import { eq, isNull } from 'drizzle-orm'
import type { Artifact } from '@agent-chat/protocol'
import { artifacts } from '../schema'
import { getDb } from '../migrate'
import { ulid } from 'ulid'

export async function createArtifact(input: {
  id?: string
  topicId?: string | null
  originTopicId?: string | null
  name: string
  mime?: string | null
  sizeBytes?: number | null
  r2Key: string
  source: Artifact['source']
  metadataJson?: string | null
}): Promise<Artifact> {
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
  await getDb().insert(artifacts).values(row).run()
  return toDomain(row)
}

export async function getArtifact(id: string): Promise<Artifact | undefined> {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, id))
    .all()
  return rows[0] ? toDomain(rows[0]) : undefined
}

export async function listArtifactsByTopic(topicId: string): Promise<Artifact[]> {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.topicId, topicId))
    .all()
  return rows.map(toDomain)
}

export async function listPoolArtifacts(): Promise<Artifact[]> {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(isNull(artifacts.topicId))
    .all()
  return rows.map(toDomain)
}

export async function updateArtifactTopic(
  id: string,
  topicId: string | null,
): Promise<Artifact | undefined> {
  await getDb()
    .update(artifacts)
    .set({ topicId })
    .where(eq(artifacts.id, id))
    .run()
  return getArtifact(id)
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const result = await getDb()
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .run()
  const meta = result.meta as { rows_written?: number } | undefined
  return (meta?.rows_written ?? 0) > 0
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
