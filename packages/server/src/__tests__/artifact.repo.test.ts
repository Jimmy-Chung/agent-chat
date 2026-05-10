import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as topicRepo from '../db/repos/topic.repo'
import { setDb, resetDb } from '../db/migrate'

describe('ArtifactRepo', () => {
  let topicId: string

  beforeAll(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    const topic = topicRepo.createTopic({
      name: 'Artifact Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    resetDb()
    teardownTestDb()
  })

  it('should create an artifact with a topic', () => {
    const artifact = artifactRepo.createArtifact({
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

  it('should create a pool artifact (no topicId)', () => {
    const artifact = artifactRepo.createArtifact({
      name: 'pool-file.pdf',
      r2Key: 'uploads/pool-file.pdf',
      source: 'uploaded',
    })

    expect(artifact.topic_id).toBeNull()
  })

  it('should get an artifact by id', () => {
    const created = artifactRepo.createArtifact({
      topicId,
      name: 'get-test.txt',
      r2Key: 'uploads/get-test.txt',
      source: 'uploaded',
    })

    const found = artifactRepo.getArtifact(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('get-test.txt')
  })

  it('should return undefined for non-existent artifact', () => {
    const found = artifactRepo.getArtifact('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should list artifacts by topic', () => {
    const topic = topicRepo.createTopic({
      name: 'Artifact List Topic',
      kind: 'normal',
      agentType: 'general',
    })

    artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'a1.txt',
      r2Key: 'uploads/a1.txt',
      source: 'uploaded',
    })
    artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'a2.txt',
      r2Key: 'uploads/a2.txt',
      source: 'uploaded',
    })
    // Artifact for a different topic (should not appear)
    artifactRepo.createArtifact({
      topicId,
      name: 'other.txt',
      r2Key: 'uploads/other.txt',
      source: 'uploaded',
    })

    const list = artifactRepo.listArtifactsByTopic(topic.id)
    expect(list.length).toBe(2)
    expect(list.every((a) => a.topic_id === topic.id)).toBe(true)
  })

  it('should list pool artifacts (topicId is null)', () => {
    artifactRepo.createArtifact({
      name: 'pool1.txt',
      r2Key: 'uploads/pool1.txt',
      source: 'uploaded',
    })
    artifactRepo.createArtifact({
      name: 'pool2.txt',
      r2Key: 'uploads/pool2.txt',
      source: 'uploaded',
    })
    // Artifact with topic (should not appear in pool)
    artifactRepo.createArtifact({
      topicId,
      name: 'not-pool.txt',
      r2Key: 'uploads/not-pool.txt',
      source: 'uploaded',
    })

    const pool = artifactRepo.listPoolArtifacts()
    expect(pool.length).toBeGreaterThanOrEqual(2)
    expect(pool.every((a) => a.topic_id === null)).toBe(true)
  })

  it('should update artifact topic', () => {
    const artifact = artifactRepo.createArtifact({
      name: 'move-me.txt',
      r2Key: 'uploads/move-me.txt',
      source: 'uploaded',
    })
    expect(artifact.topic_id).toBeNull()

    const updated = artifactRepo.updateArtifactTopic(artifact.id, topicId)
    expect(updated).toBeDefined()
    expect(updated!.topic_id).toBe(topicId)

    // Move back to pool
    const backToPool = artifactRepo.updateArtifactTopic(artifact.id, null)
    expect(backToPool!.topic_id).toBeNull()
  })

  it('should delete an artifact', () => {
    const artifact = artifactRepo.createArtifact({
      topicId,
      name: 'delete-me.txt',
      r2Key: 'uploads/delete-me.txt',
      source: 'uploaded',
    })

    const result = artifactRepo.deleteArtifact(artifact.id)
    expect(result).toBe(true)

    const found = artifactRepo.getArtifact(artifact.id)
    expect(found).toBeUndefined()
  })

  it('should return false when deleting non-existent artifact', () => {
    const result = artifactRepo.deleteArtifact('nonexistent')
    expect(result).toBe(false)
  })
})
