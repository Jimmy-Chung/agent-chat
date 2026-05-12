import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as topicRepo from '../db/repos/topic.repo'

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

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Message handler', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerMessageHandlers } = await import('../ws/handlers/message.handler')
    registerMessageHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  async function getHandler(event: string) {
    const call = mockHub.on.mock.calls.find((c: string[]) => c[0] === event)
    expect(call).toBeDefined()
    return call![1]
  }

  it('returns empty history for a topic with no messages', async () => {
    const handler = await getHandler('client:messages.load')
    const topic = await topicRepo.createTopic({ name: 'Empty Topic', kind: 'normal', agentType: 'general' })

    await handler('socket-1', {
      d: { topicId: topic.id },
    })

    expect(mockHub.sendToClient).toHaveBeenCalledWith('socket-1', {
      type: 'messages.history',
      data: {
        topicId: topic.id,
        messages: [],
        partsByMessage: {},
      },
    })
  })

  it('loads persisted history for a topic', async () => {
    const userMessage = await getHandler('client:user.message')
    const loadHistory = await getHandler('client:messages.load')
    const topic = await topicRepo.createTopic({ name: 'History Topic', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-history' })
    mockPi.reconnectSession.mockResolvedValue(undefined)
    mockPi.hasSession.mockReturnValue(false)

    await userMessage({}, {
      d: {
        topicId: topic.id,
        content: 'Hello history',
        mentions: [],
      },
    })

    await loadHistory('socket-2', {
      d: { topicId: topic.id },
    })

    expect(mockHub.sendToClient).toHaveBeenCalledWith('socket-2', expect.objectContaining({
      type: 'messages.history',
      data: expect.objectContaining({ topicId: topic.id }),
    }))

    const payload = mockHub.sendToClient.mock.calls.at(-1)?.[1]
    expect(payload.data.messages).toHaveLength(1)
    expect(payload.data.partsByMessage[payload.data.messages[0].id]).toHaveLength(1)
  })

  it('creates user message in DB and broadcasts start/delta/end', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'Chat', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-msg' })
    mockPi.reconnectSession.mockResolvedValue(undefined)
    mockPi.hasSession.mockReturnValue(false)

    await handler({}, {
      d: {
        topicId: topic.id,
        content: 'Hello agent',
        mentions: [],
      },
    })

    expect(mockHub.broadcast).toHaveBeenCalledTimes(3)
    const events = mockHub.getBroadcastEvents()
    expect(events[0].type).toBe('message.start')
    expect(events[1].type).toBe('message.delta')
    expect(events[1].data.part.content).toBe('Hello agent')
    expect(events[2].type).toBe('message.end')
  })

  it('forwards to PI via sendUserMessage RPC', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'PI Chat', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-msg' })
    mockPi.reconnectSession.mockResolvedValue(undefined)
    mockPi.hasSession.mockReturnValue(false)

    await handler({}, {
      d: {
        topicId: topic.id,
        content: 'List files',
        mentions: [],
      },
    })

    expect(mockPi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({
      sessionId: 'pi-sess-msg',
      content: 'List files',
    }))
  })

  it('broadcasts NO_PI_SESSION error when topic has no session', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'No Session', kind: 'normal', agentType: 'general' })

    await handler({}, {
      d: { topicId: topic.id, content: 'Hi', mentions: [] },
    })

    const errorEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('NO_PI_SESSION')
  }, 7000)

  it('broadcasts PI_UNAVAILABLE error when PI RPC fails', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'PI Down', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-down' })
    mockPi.hasSession.mockReturnValue(true)
    mockPi.rpc.mockRejectedValue(new Error('PI down'))

    await handler({}, {
      d: { topicId: topic.id, content: 'Hi', mentions: [] },
    })
    await flushMicrotasks()

    const errorEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('PI_UNAVAILABLE')
  })

  it('no-ops for non-existent topic', async () => {
    const handler = await getHandler('client:user.message')

    await handler({}, {
      d: { topicId: 'nonexistent', content: 'Hi', mentions: [] },
    })

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })
})
