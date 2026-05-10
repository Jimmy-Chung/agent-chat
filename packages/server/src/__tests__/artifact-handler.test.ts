import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import { setDb, resetDb } from '../db/migrate'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as topicRepo from '../db/repos/topic.repo'

function createMockHub() {
  const sentToClient: any[] = []
  const broadcastEvents: any[] = []
  return {
    broadcast: vi.fn((event: any) => {
      broadcastEvents.push(event)
    }),
    on: vi.fn(),
    sendToClient: vi.fn((_ws: any, event: any) => {
      sentToClient.push(event)
    }),
    getSentToClient: () => sentToClient,
    getBroadcastEvents: () => broadcastEvents,
  }
}

describe('Artifact handler — upload.init', () => {
  let mockHub: ReturnType<typeof createMockHub>

  beforeEach(async () => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    const { registerArtifactHandlers } = await import('../ws/handlers/artifact.handler')
    registerArtifactHandlers(mockHub as any)
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  it('returns ARTIFACT_UPLOAD_UNAVAILABLE error', async () => {
    const uploadCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:artifact.upload.init')
    const uploadHandler = uploadCall![1]

    await uploadHandler({ ws: 'mock-ws' }, { d: {} })

    const sent = mockHub.getSentToClient()
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('error')
    expect(sent[0].data.code).toBe('ARTIFACT_UPLOAD_UNAVAILABLE')
  })
})

describe('Artifact handler — topic.select artifact list', () => {
  let mockHub: ReturnType<typeof createMockHub>

  beforeEach(async () => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    const { registerArtifactHandlers } = await import('../ws/handlers/artifact.handler')
    registerArtifactHandlers(mockHub as any)
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  it('returns pool artifacts for system_artifact_pool', async () => {
    // Create a pool artifact (no topic_id)
    artifactRepo.createArtifact({
      name: 'pool-file.txt',
      r2Key: 'uploads/pool-file.txt',
      source: 'uploaded',
    })

    const selectCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.select')
    const selectHandler = selectCall![1]

    await selectHandler({ ws: 'mock-ws' }, { d: { topicId: 'system_artifact_pool' } })

    const sent = mockHub.getSentToClient()
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('artifact.list')
    expect(sent[0].data.artifacts).toHaveLength(1)
    expect(sent[0].data.artifacts[0].name).toBe('pool-file.txt')
  })

  it('returns topic artifacts for specific topic', async () => {
    const topic = topicRepo.createTopic({ name: 'With Artifacts', kind: 'normal', agentType: 'general' })
    artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'topic-file.txt',
      r2Key: 'uploads/topic-file.txt',
      source: 'generated',
    })

    const selectCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.select')
    const selectHandler = selectCall![1]

    await selectHandler({ ws: 'mock-ws' }, { d: { topicId: topic.id } })

    const sent = mockHub.getSentToClient()
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('artifact.list')
    expect(sent[0].data.artifacts).toHaveLength(1)
    expect(sent[0].data.artifacts[0].name).toBe('topic-file.txt')
  })

  it('returns nothing for topic with no artifacts', async () => {
    const topic = topicRepo.createTopic({ name: 'Empty', kind: 'normal', agentType: 'general' })

    const selectCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.select')
    const selectHandler = selectCall![1]

    await selectHandler({ ws: 'mock-ws' }, { d: { topicId: topic.id } })

    expect(mockHub.getSentToClient()).toHaveLength(0)
  })
})
