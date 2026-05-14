import { EventEmitter } from 'node:events'
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
  const emitter = new EventEmitter()
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'pi-sess-1' }),
    rpc: vi.fn().mockResolvedValue(undefined),
    disconnectSession: vi.fn(),
    reconnectSession: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockReturnValue(false),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
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
    vi.useFakeTimers()
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerMessageHandlers } = await import('../ws/handlers/message.handler')
    registerMessageHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    vi.useRealTimers()
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
    mockPi.rpc.mockImplementation(async () => {
      Promise.resolve().then(() => {
        mockPi.emit('event', {
          seq: 1,
          sessionId: 'pi-sess-history',
          ts: Date.now(),
          payload: { kind: 'message.start', messageId: 'assistant-history', role: 'assistant' },
        })
      })
      return undefined
    })

    const pending = userMessage({}, {
      d: {
        topicId: topic.id,
        content: 'Hello history',
        mentions: [],
      },
    })
    await pending
    await flushMicrotasks()

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
    mockPi.rpc.mockImplementation(async () => {
      Promise.resolve().then(() => {
        mockPi.emit('event', {
          seq: 1,
          sessionId: 'pi-sess-msg',
          ts: Date.now(),
          payload: { kind: 'message.start', messageId: 'assistant-msg', role: 'assistant' },
        })
      })
      return undefined
    })

    const pending = handler({}, {
      d: {
        topicId: topic.id,
        content: 'Hello agent',
        mentions: [],
      },
    })
    await pending
    await flushMicrotasks()

    const events = mockHub.getBroadcastEvents()
    expect(events[0].type).toBe('message.start')
    expect(events[0].data.status).toBe('pending')
    expect(events[1].type).toBe('message.delta')
    expect(events[1].data.part.content).toBe('Hello agent')
    expect(events[2].type).toBe('message.delivery')
    expect(events[2].data.status).toBe('pending')
    expect(events.some((event: any) => event.type === 'message.delivery' && event.data.status === 'retrying')).toBe(false)
    expect(events.some((event: any) => event.type === 'message.delivery' && event.data.status === 'done')).toBe(true)
  })

  it('forwards to PI via sendUserMessage RPC after auto retry timer starts', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'PI Chat', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-msg' })
    mockPi.reconnectSession.mockResolvedValue(undefined)
    mockPi.hasSession.mockReturnValue(false)
    mockPi.rpc.mockImplementation(async () => {
      Promise.resolve().then(() => {
        mockPi.emit('event', {
          seq: 1,
          sessionId: 'pi-sess-msg',
          ts: Date.now(),
          payload: { kind: 'message.start', messageId: 'assistant-list', role: 'assistant' },
        })
      })
      return undefined
    })

    const pending = handler({}, {
      d: {
        topicId: topic.id,
        content: 'List files',
        mentions: [],
      },
    })
    await pending
    await flushMicrotasks()

    expect(mockPi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({
      sessionId: 'pi-sess-msg',
      content: 'List files',
      clientMessageId: expect.any(String),
    }))
  })

  it('keeps waiting when PI emits already-processing followUp notice before normal events', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'Busy FollowUp', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-busy' })
    mockPi.hasSession.mockReturnValue(true)
    mockPi.rpc.mockImplementation(async () => {
      Promise.resolve().then(() => {
        mockPi.emit('event', {
          seq: 1,
          sessionId: 'pi-sess-busy',
          ts: Date.now(),
          payload: {
            kind: 'error',
            code: 'ALREADY_PROCESSING',
            message: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
            recoverable: true,
          },
        })
        mockPi.emit('event', {
          seq: 2,
          sessionId: 'pi-sess-busy',
          ts: Date.now(),
          payload: { kind: 'message.start', messageId: 'assistant-busy', role: 'assistant' },
        })
      })
      return undefined
    })

    await handler({}, {
      d: {
        topicId: topic.id,
        content: 'Queue this',
        mentions: [],
      },
    })
    await flushMicrotasks()

    const events = mockHub.getBroadcastEvents()
    expect(events.some((event: any) => event.type === 'message.delivery' && event.data.status === 'done')).toBe(true)
    expect(events.some((event: any) => event.type === 'message.delivery' && event.data.status === 'needs_retry')).toBe(false)
  })

  it('creates session for topic without session and still delivers', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'No Session', kind: 'normal', agentType: 'general' })

    const pending = handler({}, {
      d: { topicId: topic.id, content: 'Hi', mentions: [] },
    })
    mockPi.rpc.mockImplementation(async () => {
      Promise.resolve().then(() => {
        mockPi.emit('event', {
          seq: 1,
          sessionId: 'pi-sess-1',
          ts: Date.now(),
          payload: { kind: 'message.start', messageId: 'assistant-nosess', role: 'assistant' },
        })
      })
      return undefined
    })
    await vi.advanceTimersByTimeAsync(5100)
    await pending
    await flushMicrotasks()

    expect(mockPi.createSession).toHaveBeenCalled()
    expect(mockHub.getBroadcastEvents().some((e: any) => e.type === 'error')).toBe(false)
  }, 7000)

  it('marks message retryable when auto delivery fails', async () => {
    const handler = await getHandler('client:user.message')
    const topic = await topicRepo.createTopic({ name: 'PI Down', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-down' })
    mockPi.hasSession.mockReturnValue(true)
    mockPi.rpc.mockRejectedValue(new Error('PI down'))

    await handler({}, {
      d: { topicId: topic.id, content: 'Hi', mentions: [] },
    })
    mockPi.emit('event', {
      seq: 1,
      sessionId: 'pi-sess-down',
      ts: Date.now(),
      payload: { kind: 'error', code: 'internal', message: 'PI down', recoverable: true },
    })
    await flushMicrotasks()

    const retryEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'message.delivery' && e.data.status === 'needs_retry')
    expect(retryEvent).toBeDefined()
    expect(retryEvent.data.retryCount).toBe(0)
  })

  it('reverts pending message after two failed manual retries', async () => {
    const send = await getHandler('client:user.message')
    const retry = await getHandler('client:user.message.retry')
    const topic = await topicRepo.createTopic({ name: 'Retry Down', kind: 'normal', agentType: 'general' })

    await topicRepo.updateTopic(topic.id, { pi_session_id: 'pi-sess-down' })
    mockPi.hasSession.mockReturnValue(true)
    mockPi.rpc.mockRejectedValue(new Error('PI down'))

    await send({}, {
      d: { topicId: topic.id, content: 'Retry me', mentions: [] },
    })
    mockPi.emit('event', {
      seq: 1,
      sessionId: 'pi-sess-down',
      ts: Date.now(),
      payload: { kind: 'error', code: 'internal', message: 'PI down', recoverable: true },
    })
    await flushMicrotasks()

    const start = mockHub.getBroadcastEvents().find((e: any) => e.type === 'message.start')
    const messageId = start.data.messageId

    await retry({}, { d: { topicId: topic.id, messageId } })
    await retry({}, { d: { topicId: topic.id, messageId } })

    const revertEvent = mockHub.getBroadcastEvents().find((e: any) => e.type === 'message.delivery' && e.data.status === 'error')
    expect(revertEvent).toBeDefined()
    expect(revertEvent.data.retryCount).toBe(2)
  })

  it('no-ops for non-existent topic', async () => {
    const handler = await getHandler('client:user.message')

    await handler({}, {
      d: { topicId: 'nonexistent', content: 'Hi', mentions: [] },
    })

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })
})
