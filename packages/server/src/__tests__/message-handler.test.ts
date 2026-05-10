import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import { setDb, resetDb } from '../db/migrate'
import * as topicRepo from '../db/repos/topic.repo'

function createMockHub() {
  const broadcastEvents: any[] = []
  return {
    broadcast: vi.fn((event: any) => {
      broadcastEvents.push(event)
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

describe('Message handler — user.message', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerMessageHandlers } = await import('../ws/handlers/message.handler')
    registerMessageHandlers(mockHub as any, mockPi as any)
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  async function getHandler(event: string) {
    const call = mockHub.on.mock.calls.find((c: string[]) => c[0] === event)
    expect(call).toBeDefined()
    return call![1]
  }

  it('creates user message in DB and broadcasts start/delta/end', async () => {
    const handler = await getHandler('client:user.message')
    const topic = topicRepo.createTopic({ name: 'Chat', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-msg' })

    await handler({}, {
      d: {
        topicId: topic.id,
        content: 'Hello agent',
        mentions: [],
      },
    })

    // Three broadcasts: start, delta, end
    expect(mockHub.broadcast).toHaveBeenCalledTimes(3)
    const events = mockHub.getBroadcastEvents()
    expect(events[0].type).toBe('message.start')
    expect(events[1].type).toBe('message.delta')
    expect(events[1].data.part.content).toBe('Hello agent')
    expect(events[2].type).toBe('message.end')
  })

  it('forwards to PI via sendUserMessage RPC', async () => {
    const handler = await getHandler('client:user.message')
    const topic = topicRepo.createTopic({ name: 'PI Chat', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-msg' })

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
    const topic = topicRepo.createTopic({ name: 'No Session', kind: 'normal', agentType: 'general' })

    await handler({}, {
      d: { topicId: topic.id, content: 'Hi' },
    })

    const errorEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'error',
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('NO_PI_SESSION')
  })

  it('broadcasts PI_UNAVAILABLE error when PI RPC fails', async () => {
    mockPi.rpc.mockRejectedValue(new Error('PI down'))
    const handler = await getHandler('client:user.message')
    const topic = topicRepo.createTopic({ name: 'PI Down', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-down' })

    await handler({}, {
      d: { topicId: topic.id, content: 'Hi' },
    })

    const errorEvent = mockHub.getBroadcastEvents().find(
      (e: any) => e.type === 'error',
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent.data.code).toBe('PI_UNAVAILABLE')
  })

  it('no-ops for non-existent topic', async () => {
    const handler = await getHandler('client:user.message')

    await handler({}, {
      d: { topicId: 'nonexistent', content: 'Hi' },
    })

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })
})
