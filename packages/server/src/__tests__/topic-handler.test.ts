import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as topicRepo from '../db/repos/topic.repo'
import * as artifactRepo from '../db/repos/artifact.repo'

function createMockHub() {
  const broadcastEvents: any[] = []
  return {
    broadcast: vi.fn((type: string, data: unknown) => {
      broadcastEvents.push({ type, data })
    }),
    on: vi.fn(),
    sendToClient: vi.fn(),
    getBroadcastEvents: () => broadcastEvents,
  }
}

function createMockPiClient() {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'pi-sess-1' }),
    rpc: vi.fn().mockResolvedValue(undefined),
    disconnectSession: vi.fn(),
    reconnectSession: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockReturnValue(false),
  }
}

describe('Topic handler — topic.create', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerTopicHandlers } = await import('../ws/handlers/topic.handler')
    registerTopicHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  async function getHandler(event: string) {
    const call = mockHub.on.mock.calls.find((c: string[]) => c[0] === event)
    expect(call).toBeDefined()
    return call![1]
  }

  it('creates a general topic and calls PI createSession', async () => {
    const handler = await getHandler('client:topic.create')

    await handler({}, {
      d: {
        name: 'General Chat',
        agentType: 'general',
      },
    })

    const topics = await topicRepo.listTopics()
    expect(topics.length).toBe(1)
    expect(topics[0].name).toBe('General Chat')
    expect(topics[0].agent_type).toBe('general')
    expect(topics[0].kind).toBe('normal')

    expect(mockPi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'general' }),
    )

    expect(mockHub.broadcast).toHaveBeenCalledWith(
      'topic.created',
      expect.any(Object),
    )
  })

  it('creates a programming topic with spec', async () => {
    const handler = await getHandler('client:topic.create')

    await handler({}, {
      d: {
        name: 'Code Project',
        agentType: 'programming',
        programming: {
          extension: 'claude-code',
          yolo: false,
          cwd: '/home/user/repo',
          permissionMode: 'default',
        },
      },
    })

    const topics = await topicRepo.listTopics()
    expect(topics[0].agent_type).toBe('programming')

    const spec = JSON.parse(topics[0].programming_spec_json!)
    expect(spec.extension).toBe('claude-code')
    expect(spec.cwd).toBe('/home/user/repo')

    expect(mockPi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'programming',
        programming: {
          extension: 'claude-code',
          yolo: false,
          cwd: '/home/user/repo',
          permissionMode: 'default',
        },
      }),
    )
  })

  it('updates topic with pi_session_id after createSession', async () => {
    const handler = await getHandler('client:topic.create')

    await handler({}, {
      d: { name: 'Test', agentType: 'general' },
    })

    const topics = await topicRepo.listTopics()
    expect(topics[0].pi_session_id).toBe('pi-sess-1')

    const updatedEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'topic.updated',
    )
    expect(updatedEvent).toBeDefined()
    expect(updatedEvent.data.pi_session_id).toBe('pi-sess-1')
  })

  it('rejects duplicate topic names', async () => {
    const handler = await getHandler('client:topic.create')

    await topicRepo.createTopic({
      name: 'General Chat',
      kind: 'normal',
      agentType: 'general',
    })

    await handler({}, {
      d: { name: 'General Chat', agentType: 'general' },
    })

    const errorEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('DUPLICATE_NAME')
    expect(mockPi.createSession).not.toHaveBeenCalled()
  })

  it('rejects duplicate working directories for programming topics', async () => {
    const handler = await getHandler('client:topic.create')

    await topicRepo.createTopic({
      name: 'Existing Topic',
      kind: 'normal',
      agentType: 'programming',
      programmingSpecJson: JSON.stringify({
        extension: 'claude-code',
        yolo: false,
        cwd: '/repo/demo/',
        permissionMode: 'default',
      }),
    })

    await handler({}, {
      d: {
        name: 'New Topic',
        agentType: 'programming',
        programming: {
          extension: 'claude-code',
          yolo: false,
          cwd: '/repo/demo',
          permissionMode: 'default',
        },
      },
    })

    const errorEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('DUPLICATE_CWD')
    expect(errorEvent.data.details).toEqual({
      topicId: expect.any(String),
      topicName: 'Existing Topic',
      cwd: '/repo/demo',
    })
    expect(mockPi.createSession).not.toHaveBeenCalled()
  })

  it('broadcasts error when PI createSession fails', async () => {
    mockPi.createSession.mockRejectedValue(new Error('PI down'))
    const handler = await getHandler('client:topic.create')

    await handler({}, {
      d: { name: 'Fail Test', agentType: 'general' },
    })

    const topics = await topicRepo.listTopics()
    expect(topics.length).toBe(1)

    const errorEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'error',
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('PI_SESSION_FAILED')
  })
})

describe('Topic handler — topic.rename', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerTopicHandlers } = await import('../ws/handlers/topic.handler')
    registerTopicHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('renames a topic and broadcasts topic.updated', async () => {
    const renameCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.rename')
    const renameHandler = renameCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Old Name',
      kind: 'normal',
      agentType: 'general',
    })

    await renameHandler({}, { d: { id: topic.id, name: 'New Name' } })

    const updated = await topicRepo.getTopic(topic.id)
    expect(updated!.name).toBe('New Name')

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('topic.updated')
    expect(broadcastEvent.data.name).toBe('New Name')
    expect(broadcastEvent.data.id).toBe(topic.id)
  })
})

describe('Topic handler — topic.delete', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerTopicHandlers } = await import('../ws/handlers/topic.handler')
    registerTopicHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('deletes a normal topic', async () => {
    const deleteCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Delete Me',
      kind: 'normal',
      agentType: 'general',
    })

    await deleteHandler({}, { d: { id: topic.id, artifactStrategy: 'delete' } })

    const found = await topicRepo.getTopic(topic.id)
    expect(found!.archived).toBe(true)

    const broadcastEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'topic.deleted',
    )
    expect(broadcastEvent).toBeDefined()
    expect(broadcastEvent.data.id).toBe(topic.id)
  })

  it('refuses to delete system topics', async () => {
    const deleteCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'System',
      kind: 'system_cron_admin',
      agentType: 'general',
    })

    await deleteHandler({}, { d: { id: topic.id, artifactStrategy: 'delete' } })

    const found = await topicRepo.getTopic(topic.id)
    expect(found!.archived).toBe(false)

    const errorEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'error',
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('LOCKED')
  })

  it('deletes topic with artifactStrategy=pool moves artifacts to pool', async () => {
    const deleteCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'With Artifacts',
      kind: 'normal',
      agentType: 'general',
    })
    const artifact = await artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'file.txt',
      r2Key: 'uploads/file.txt',
      source: 'generated',
    })

    await deleteHandler({}, { d: { id: topic.id, artifactStrategy: 'pool' } })

    const moved = await artifactRepo.getArtifact(artifact.id)
    expect(moved!.topic_id).toBeNull()

    const movedEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'artifact.moved',
    )
    expect(movedEvent).toBeDefined()
  })

  it('deletes topic with artifactStrategy=delete removes artifacts', async () => {
    const deleteCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'With Artifacts 2',
      kind: 'normal',
      agentType: 'general',
    })
    const artifact = await artifactRepo.createArtifact({
      topicId: topic.id,
      name: 'file2.txt',
      r2Key: 'uploads/file2.txt',
      source: 'generated',
    })

    await deleteHandler({}, { d: { id: topic.id, artifactStrategy: 'delete' } })

    expect(await artifactRepo.getArtifact(artifact.id)).toBeUndefined()

    const deletedEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'artifact.deleted',
    )
    expect(deletedEvent).toBeDefined()
  })

  it('keeps PI session available when deleting topic with pi_session_id', async () => {
    const deleteCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'With Session',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-to-disconnect' })

    await deleteHandler({}, { d: { id: topic.id, artifactStrategy: 'delete' } })

    expect(mockPi.disconnectSession).not.toHaveBeenCalled()
  })
})

describe('Topic handler — topic.resume', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerTopicHandlers } = await import('../ws/handlers/topic.handler')
    registerTopicHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('reconnects PI session on topic.resume', async () => {
    const resumeCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.resume')
    const resumeHandler = resumeCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Resume Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-resume-1' })

    mockPi.hasSession.mockReturnValue(false)

    await resumeHandler({}, { d: { topicId: topic.id } })

    expect(mockPi.reconnectSession).toHaveBeenCalledWith('sess-resume-1')
  })

  it('re-attaches when session already connected', async () => {
    const resumeCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.resume')
    const resumeHandler = resumeCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Already Connected',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-already' })

    mockPi.hasSession.mockReturnValue(true)

    await resumeHandler({}, { d: { topicId: topic.id } })

    expect(mockPi.reconnectSession).toHaveBeenCalledWith('sess-already')
  })

  it('broadcasts error when resume fails', async () => {
    const resumeCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.resume')
    const resumeHandler = resumeCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Resume Fail',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-fail' })

    mockPi.hasSession.mockReturnValue(false)
    mockPi.reconnectSession.mockRejectedValue(new Error('PI unreachable'))

    await resumeHandler({}, { d: { topicId: topic.id } })

    const errorEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'error',
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('PI_RESUME_FAILED')
  })

  it('no-ops for topic without pi_session_id', async () => {
    const resumeCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:topic.resume')
    const resumeHandler = resumeCall![1]

    const topic = await topicRepo.createTopic({
      name: 'No Session',
      kind: 'normal',
      agentType: 'general',
    })

    await resumeHandler({}, { d: { topicId: topic.id } })

    expect(mockPi.reconnectSession).not.toHaveBeenCalled()
  })
})
