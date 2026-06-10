import { and, eq, isNull } from 'drizzle-orm'
import type { Artifact } from '@agent-chat/protocol'
import { artifacts, messageArtifactRefs, messages, topics } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

export async function createArtifact(input: {
  id?: string
  topicId?: string | null
  originTopicId?: string | null
  name: string
  mime?: string | null
  sizeBytes?: number | null
  r2Key: string
  source: Artifact['source']
  uploadStatus?: Artifact['upload_status']
  failureCode?: string | null
  failureMessage?: string | null
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
    uploadStatus: input.uploadStatus ?? 'uploaded',
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
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

export async function updateArtifact(
  id: string,
  input: Partial<{
    topicId: string | null
    originTopicId: string | null
    name: string
    mime: string | null
    sizeBytes: number | null
    r2Key: string
    source: Artifact['source']
    uploadStatus: Artifact['upload_status']
    failureCode: string | null
    failureMessage: string | null
    metadataJson: string | null
  }>,
): Promise<Artifact | undefined> {
  const updates: Record<string, unknown> = {}
  if ('topicId' in input) updates.topicId = input.topicId ?? null
  if ('originTopicId' in input) updates.originTopicId = input.originTopicId ?? null
  if ('name' in input) updates.name = input.name
  if ('mime' in input) updates.mime = input.mime ?? null
  if ('sizeBytes' in input) updates.sizeBytes = input.sizeBytes ?? null
  if ('r2Key' in input) updates.r2Key = input.r2Key
  if ('source' in input) updates.source = input.source
  if ('uploadStatus' in input) updates.uploadStatus = input.uploadStatus
  if ('failureCode' in input) updates.failureCode = input.failureCode ?? null
  if ('failureMessage' in input) updates.failureMessage = input.failureMessage ?? null
  if ('metadataJson' in input) updates.metadataJson = input.metadataJson ?? null

  if (Object.keys(updates).length === 0) return getArtifact(id)
  await getDb()
    .update(artifacts)
    .set(updates)
    .where(eq(artifacts.id, id))
    .run()
  return getArtifact(id)
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

export async function countActiveMessageRefs(id: string, options?: { excludeTopicId?: string }): Promise<number> {
  const rows = await getDb()
    .select({ messageId: messageArtifactRefs.messageId, topicId: messages.topicId })
    .from(messageArtifactRefs)
    .innerJoin(messages, eq(messageArtifactRefs.messageId, messages.id))
    .innerJoin(topics, eq(messages.topicId, topics.id))
    .where(and(
      eq(messageArtifactRefs.artifactId, id),
      eq(topics.archived, false),
    ))
    .all()
  return rows.filter((row) => row.topicId !== options?.excludeTopicId).length
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
    upload_status: ((row.uploadStatus as Artifact['upload_status'] | undefined) ?? 'uploaded'),
    failure_code: (row.failureCode as string) || null,
    failure_message: (row.failureMessage as string) || null,
    created_at: row.createdAt as number,
    metadata_json: (row.metadataJson as string) || null,
  }
}
