import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as topicRepo from '../db/repos/topic.repo'

describe('ArtifactRepo', () => {
  let topicId: string

  beforeAll(async () => {
    await setupTestDb()
    const topic = await topicRepo.createTopic({
      name: 'Artifact Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create an artifact with a topic', async () => {
    const artifact = await artifactRepo.createArtifact({
      topicId,
      name: 'test.txt',
      mime: 'text/plain',
      sizeBytes: 42,
      r2Key: 'uploads/test.txt',
      source: 'uploaded',
    })

    expect(artifact.id).toBeTruthy()
    expect(artifact.topic_id).toBe(topicId)
    expect(artifact.name).toBe('test.txt')
    expect(artifact.mime).toBe('text/plain')
    expect(artifact.size_bytes).toBe(42)
    expect(artifact.r2_key).toBe('uploads/test.txt')
    expect(artifact.source).toBe('uploaded')
    expect(artifact.created_at).toBeGreaterThan(0)
  })

  it('should create a pool artifact (no topicId)', async () => {
    const artifact = await artifactRepo.createArtifact({
      name: 'pool-file.pdf',
      r2Key: 'uploads/pool-file.pdf',
      source: 'uploaded',
    })

    expect(artifact.topic_id).toBeNull()
  })

  it('should get an artifact by id', async () => {
    const created = await artifactRepo.createArtifact({
      topicId,
      name: 'get-test.txt',
      r2Key: 'uploads/get-test.txt',
      source: 'uploaded',
    })

    const found = await artifactRepo.getArtifact(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('get-test.txt')
  })

  it('should return undefined for non-existent artifact', async () => {
    const found = await artifactRepo.getArtifact('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should list artifacts by topic', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Artifact List Topic',
      kind: 'normal',
      agentType: 'general',
    })

    await artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'a1.txt',
      r2Key: 'uploads/a1.txt',
      source: 'uploaded',
    })
    await artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'a2.txt',
      r2Key: 'uploads/a2.txt',
      source: 'uploaded',
    })
    await artifactRepo.createArtifact({
      topicId,
      name: 'other.txt',
      r2Key: 'uploads/other.txt',
      source: 'uploaded',
    })

    const list = await artifactRepo.listArtifactsByTopic(topic.id)
    expect(list.length).toBe(2)
    expect(list.every((a) => a.topic_id === topic.id)).toBe(true)
  })

  it('should list pool artifacts (topicId is null)', async () => {
    await artifactRepo.createArtifact({
      name: 'pool1.txt',
      r2Key: 'uploads/pool1.txt',
      source: 'uploaded',
    })
    await artifactRepo.createArtifact({
      name: 'pool2.txt',
      r2Key: 'uploads/pool2.txt',
      source: 'uploaded',
    })
    await artifactRepo.createArtifact({
      topicId,
      name: 'not-pool.txt',
      r2Key: 'uploads/not-pool.txt',
      source: 'uploaded',
    })

    const pool = await artifactRepo.listPoolArtifacts()
    expect(pool.length).toBeGreaterThanOrEqual(2)
    expect(pool.every((a) => a.topic_id === null)).toBe(true)
  })

  it('should update artifact topic', async () => {
    const artifact = await artifactRepo.createArtifact({
      name: 'move-me.txt',
      r2Key: 'uploads/move-me.txt',
      source: 'uploaded',
    })
    expect(artifact.topic_id).toBeNull()

    const updated = await artifactRepo.updateArtifactTopic(artifact.id, topicId)
    expect(updated).toBeDefined()
    expect(updated!.topic_id).toBe(topicId)

    const backToPool = await artifactRepo.updateArtifactTopic(artifact.id, null)
    expect(backToPool!.topic_id).toBeNull()
  })

  it('should delete an artifact', async () => {
    const artifact = await artifactRepo.createArtifact({
      topicId,
      name: 'delete-me.txt',
      r2Key: 'uploads/delete-me.txt',
      source: 'uploaded',
    })

    const result = await artifactRepo.deleteArtifact(artifact.id)
    expect(result).toBe(true)

    const found = await artifactRepo.getArtifact(artifact.id)
    expect(found).toBeUndefined()
  })

  it('should return false when deleting non-existent artifact', async () => {
    const result = await artifactRepo.deleteArtifact('nonexistent')
    expect(result).toBe(false)
  })
})
