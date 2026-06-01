import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as topicRepo from '../db/repos/topic.repo'

function createMockHub() {
  const sentToClient: any[] = []
  const broadcastEvents: any[] = []
  return {
    broadcast: vi.fn((type: string, data: unknown) => {
      broadcastEvents.push({ type, data })
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
    await setupTestDb()
    mockHub = createMockHub()
    const { registerArtifactHandlers } = await import('../ws/handlers/artifact.handler')
    registerArtifactHandlers(mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('returns ARTIFACT_UPLOAD_UNAVAILABLE error without R2 options', async () => {
    const uploadCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:artifact.upload.init')
    const uploadHandler = uploadCall![1]

    await uploadHandler({ ws: 'mock-ws' }, { d: { name: 'notes.md', mime: 'text/markdown', sizeBytes: 128 } })

    const sent = mockHub.getSentToClient()
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('error')
    expect(sent[0].data.code).toBe('ARTIFACT_UPLOAD_UNAVAILABLE')
  })

  it('returns upload ready and creates artifact on complete', async () => {
    mockHub = createMockHub()
    const { registerArtifactHandlers } = await import('../ws/handlers/artifact.handler')
    registerArtifactHandlers(mockHub as any, {
      env: { R2: {} } as any,
      config: {
        token: 'test-token',
        piAdapterUrl: '',
        originalPiAdapterUrl: '',
        piAdapterToken: '',
        artifactTokenSecret: 'secret',
        logLevel: 'info',
        r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', publicUrl: '' },
        vapidPublicKey: '',
        vapidPrivateKey: '',
        vapidSubject: '',
        webBaseUrl: '',
      },
      baseUrl: 'https://agent-chat.test',
    })

    const uploadHandler = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:artifact.upload.init')![1]
    await uploadHandler({ ws: 'mock-ws' }, { d: { name: 'notes.md', mime: 'text/markdown', sizeBytes: 128, topicId: 'topic-1' } })

    const ready = mockHub.getSentToClient()[0]
    expect(ready.type).toBe('artifact.upload.ready')
    expect(ready.data.uploadUrl).toContain('/api/artifacts/upload/')

    const completeHandler = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:artifact.upload.complete')![1]
    await completeHandler({ ws: 'mock-ws' }, { d: { uploadId: ready.data.uploadId, topicId: 'topic-1' } })

    const added = mockHub.getBroadcastEvents().find((e: any) => e.type === 'artifact.added')
    expect(added).toBeDefined()
    expect(added.data.name).toBe('notes.md')
    expect(added.data.topic_id).toBe('topic-1')
    expect(added.data.upload_status).toBe('uploaded')
  })
})

describe('Artifact handler — topic.select artifact list', () => {
  let mockHub: ReturnType<typeof createMockHub>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    const { registerArtifactHandlers } = await import('../ws/handlers/artifact.handler')
    registerArtifactHandlers(mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('returns pool artifacts for system_artifact_pool', async () => {
    await artifactRepo.createArtifact({
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
    expect(sent[0].data.artifacts[0].upload_status).toBe('uploaded')
    expect(sent[0].data.artifacts[0].download_url).toBeUndefined()
  })

  it('returns topic artifacts for specific topic', async () => {
    const topic = await topicRepo.createTopic({ name: 'With Artifacts', kind: 'normal', agentType: 'general' })
    await artifactRepo.createArtifact({
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
    expect(sent[0].data.artifacts[0].upload_status).toBe('uploaded')
    expect(sent[0].data.artifacts[0].download_url).toBeUndefined()
  })

  it('returns nothing for topic with no artifacts', async () => {
    const topic = await topicRepo.createTopic({ name: 'Empty', kind: 'normal', agentType: 'general' })

    const selectCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.select')
    const selectHandler = selectCall![1]

    await selectHandler({ ws: 'mock-ws' }, { d: { topicId: topic.id } })

    expect(mockHub.getSentToClient()).toHaveLength(0)
  })
})
