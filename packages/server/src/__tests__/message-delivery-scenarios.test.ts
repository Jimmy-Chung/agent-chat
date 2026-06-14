/**
 * Delivery chain integration tests — the two core scenarios that must pass
 * before any message-delivery change can be shipped:
 *
 *   Scenario A: brand-new topic, first message
 *   Scenario B: topic with existing history, message after DO hibernation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Repo mocks ────────────────────────────────────────────────────────────

const { getTopic, updateTopic } = vi.hoisted(() => ({
  getTopic: vi.fn(),
  updateTopic: vi.fn(),
}))
vi.mock('../db/repos/topic.repo', () => ({ getTopic, updateTopic }))

const { getMessage, updateMessage, createMessagePart, getMessageParts } = vi.hoisted(() => ({
  getMessage: vi.fn(),
  updateMessage: vi.fn(),
  createMessagePart: vi.fn(),
  getMessageParts: vi.fn(),
}))
vi.mock('../db/repos/message.repo', () => ({
  getMessage,
  updateMessage,
  createMessagePart,
  getMessageParts,
  bufferPartDelta: vi.fn(),
  flushParts: vi.fn(),
  indexMessageForSearch: vi.fn(),
  createMessage: vi.fn(),
}))

vi.mock('../db/repos/artifact.repo', () => ({ getArtifact: vi.fn() }))

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: 'topic-1',
    name: 'Test Topic',
    agent_type: 'general',
    pi_session_id: null,
    programming_spec_json: null,
    general_spec_json: null,
    current_model: null,
    ...overrides,
  }
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    topic_id: 'topic-1',
    role: 'user',
    status: 'pending',
    started_at: Date.now(),
    finished_at: null,
    stop_reason: null,
    client_message_id: 'cm-1',
    retry_count: 0,
    max_retries: 2,
    ...overrides,
  }
}

function makePi(overrides: Partial<{
  hasSession: ReturnType<typeof vi.fn>
  createSession: ReturnType<typeof vi.fn>
  reconnectSession: ReturnType<typeof vi.fn>
  recreateSession: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}> = {}) {
  return {
    hasSession: vi.fn().mockReturnValue(false),
    createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-new' }),
    reconnectSession: vi.fn().mockResolvedValue(undefined),
    recreateSession: vi.fn().mockResolvedValue(undefined),
    rpc: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    ...overrides,
  }
}

function makeBroadcaster() {
  const events: { type: string; data: unknown }[] = []
  return {
    broadcast: vi.fn((type: string, data: unknown) => events.push({ type, data })),
    events,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Scenario A — new topic, first message', () => {
  // The PI session is created by topic.create handler (not by delivery).
  // By the time the user types and sends the first message, the session is
  // already established in the DB (pi_session_id is set).

  beforeEach(() => {
    vi.resetAllMocks()
    updateTopic.mockImplementation(async (_id: string, patch: Record<string, unknown>) =>
      makeTopic(patch),
    )
    updateMessage.mockResolvedValue(undefined)
    createMessagePart.mockResolvedValue(undefined)
  })

  it('delivers successfully when session was pre-created by topic.create', { timeout: 15_000 }, async () => {
    // Session already in DB (created by topic.create handler)
    const topic = makeTopic({ pi_session_id: 'sess-pre' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true), // piClient remembers the session
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello, PI!',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.createSession).not.toHaveBeenCalled()
    expect(pi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({ sessionId: 'sess-pre' }), expect.anything())
    expect(updateMessage).toHaveBeenCalledWith('msg-1', expect.objectContaining({ status: 'done' }))
  })

  it('shows needs_retry immediately on auto delivery when session not yet in DB (topic.create still in flight)', async () => {
    // pi_session_id still null — topic.create's createSession hasn't completed yet
    const topic = makeTopic({ pi_session_id: null })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi()
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello, PI!',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('retryable')
    // Auto delivery must NOT call createSession — session creation belongs to topic.create
    expect(pi.createSession).not.toHaveBeenCalled()
    expect(pi.rpc).not.toHaveBeenCalled()
    const deliveryEvent = broadcaster.events.find((e) => e.type === 'message.delivery')
    expect((deliveryEvent?.data as Record<string, unknown>)?.status).toBe('needs_retry')
  })

  it('manual retry returns retryable when pi_session_id is null (session is gateway responsibility)', async () => {
    const topic = makeTopic({ pi_session_id: null })
    const msg = makeMessage({ retry_count: 0 })

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-created' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello, PI!',
      pi: pi as never,
      broadcaster,
      manual: true,
    })

    // Session creation is the gateway's job, not delivery's.
    // When gateway fails to establish session, delivery returns retryable.
    expect(result).toBe('retryable')
    expect(pi.createSession).not.toHaveBeenCalled()
  })

  it('shows needs_retry when sendUserMessage RPC times out on both attempts', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-pre' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true),
      reconnectSession: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage, RPC_TIMEOUT_MS } = await import('../ws/message-delivery')

    // Auto delivery: 1st attempt times out → reconnect → 2nd attempt also times out
    vi.useFakeTimers()
    const promise = deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello',
      pi: pi as never,
      broadcaster,
      manual: false,
    })
    await vi.advanceTimersByTimeAsync((RPC_TIMEOUT_MS + 100) * 2)
    const result = await promise
    vi.useRealTimers()

    expect(result).toBe('retryable')
    const deliveryEvent = broadcaster.events.find((e) => e.type === 'message.delivery')
    expect((deliveryEvent?.data as Record<string, unknown>)?.status).toBe('needs_retry')
  }, 30000)
})

describe('Scenario B — existing topic, message after DO hibernation (reconnect path)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateTopic.mockResolvedValue(makeTopic({ pi_session_id: 'sess-existing' }))
    updateMessage.mockResolvedValue(undefined)
    createMessagePart.mockResolvedValue(undefined)
  })

  it('reconnects the session and delivers successfully', async () => {
    // After DO hibernation, piClient has no sessions in memory
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false), // hibernation: session not in memory
      reconnectSession: vi.fn().mockResolvedValue(undefined), // reconnect succeeds
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Follow-up message',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.createSession).not.toHaveBeenCalled()
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-existing')
    expect(pi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({ sessionId: 'sess-existing' }), expect.anything())
    expect(updateMessage).toHaveBeenCalledWith('msg-1', expect.objectContaining({ status: 'done' }))
  })

  it('recovers from a short disconnected session without needs_retry or duplicate clientMessageId (TC-AIT-258-01)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage({ client_message_id: 'cm-stable' })

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Follow-up after a short disconnect',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.reconnectSession).toHaveBeenCalledTimes(1)
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-existing')
    expect(pi.rpc).toHaveBeenCalledTimes(1)
    expect(pi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({
      sessionId: 'sess-existing',
      clientMessageId: 'cm-stable',
    }), expect.anything())
    expect(broadcaster.events.some((event) =>
      event.type === 'message.delivery' &&
      (event.data as Record<string, unknown>)?.status === 'needs_retry',
    )).toBe(false)
    expect(broadcaster.events).toContainEqual(expect.objectContaining({
      type: 'message.delivery',
      data: expect.objectContaining({ status: 'done', retryCount: 0 }),
    }))
  })

  it('retries send once after reconnect using the same clientMessageId (TC-AIT-258-01)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage({ client_message_id: 'cm-same-on-retry' })

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    let rpcCalls = 0
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true),
      reconnectSession: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockImplementation(() => {
        rpcCalls++
        if (rpcCalls === 1) return Promise.reject(new Error('transient ws close'))
        return Promise.resolve({})
      }),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Retry once after reconnect',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.reconnectSession).toHaveBeenCalledTimes(1)
    const sentClientMessageIds = pi.rpc.mock.calls.map((call) =>
      ((call[1] as Record<string, unknown>)?.clientMessageId),
    )
    expect(sentClientMessageIds).toEqual(['cm-same-on-retry', 'cm-same-on-retry'])
    expect(broadcaster.events.some((event) =>
      event.type === 'message.delivery' &&
      (event.data as Record<string, unknown>)?.status === 'needs_retry',
    )).toBe(false)
  })

  it('uses session directly if still alive in piClient (no reconnect needed)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true), // session still alive
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Follow-up message',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.reconnectSession).not.toHaveBeenCalled()
    expect(pi.createSession).not.toHaveBeenCalled()
    expect(pi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({ sessionId: 'sess-existing' }), expect.anything())
  })

  it('auto delivery recreates session when reconnect fails, then delivers', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new Error('session_gone')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'sess-new' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Follow-up message',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.recreateSession).toHaveBeenCalled()
    const deliveryEvent = broadcaster.events.find((e) => e.type === 'message.delivery' && (e.data as Record<string, unknown>)?.status === 'done')
    expect(deliveryEvent).toBeDefined()
  })

  it('manual retry recreates session when reconnect fails, then delivers', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-existing' })
    const msg = makeMessage({ retry_count: 0 })

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new Error('session_gone')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'sess-new' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Retry content',
      pi: pi as never,
      broadcaster,
      manual: true,
    })

    expect(result).toBe('delivered')
    expect(pi.reconnectSession).toHaveBeenCalled()
    expect(pi.recreateSession).toHaveBeenCalled()
  })
})

describe('Error code handling — session_not_found', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateTopic.mockResolvedValue(makeTopic({ pi_session_id: 'sess-stale' }))
    updateMessage.mockResolvedValue(undefined)
    createMessagePart.mockResolvedValue(undefined)
  })

  it('ensureDeliverableSession recreates session on session_not_found (TC-10)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-stale' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new PiRpcError('session_not_found', 'Session gone')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'sess-new' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-stale')
    expect(pi.recreateSession).toHaveBeenCalled()
  })

  it('updates the topic session id when stale Codex thread is recreated', async () => {
    const topic = makeTopic({
      pi_session_id: 'old-thread',
      agent_type: 'programming',
      programming_spec_json: JSON.stringify({
        extension: 'codex',
        cwd: '/tmp/project',
        yolo: false,
        permissionMode: 'default',
      }),
    })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new PiRpcError('session_not_found', 'thread not found: old-thread')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'new-thread' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Continue this topic',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('delivered')
    expect(updateTopic).toHaveBeenCalledWith('topic-1', { pi_session_id: 'new-thread' })
    expect(pi.rpc).toHaveBeenCalledWith('sendUserMessage', expect.objectContaining({
      sessionId: 'new-thread',
      content: 'Continue this topic',
    }), expect.anything())
  })

  it('ensureDeliverableSession tries recreate on unknown error code', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-stale' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new PiRpcError('internal', 'Something broke')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'sess-new' }),
      rpc: vi.fn().mockResolvedValue({}),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    // internal error → still tries recreate → succeeds → delivered
    expect(result).toBe('delivered')
    expect(pi.recreateSession).toHaveBeenCalled()
  })
})

describe('Error code handling — session_busy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateTopic.mockResolvedValue(makeTopic({ pi_session_id: 'sess-busy' }))
    updateMessage.mockResolvedValue(undefined)
    createMessagePart.mockResolvedValue(undefined)
  })

  it('retries sendUserMessage with backoff on session_busy (TC-11)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-busy' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    let rpcAttempts = 0
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true),
      rpc: vi.fn().mockImplementation(() => {
        rpcAttempts++
        if (rpcAttempts <= 2) {
          return Promise.reject(new PiRpcError('session_busy', 'try later'))
        }
        return Promise.resolve({})
      }),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage, _setMinRetryWaitForTest } = await import('../ws/message-delivery')
    _setMinRetryWaitForTest(0)

    vi.useFakeTimers()
    const promise = deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello',
      pi: pi as never,
      broadcaster,
      manual: false,
    })
    // Advance through backoff delays: 1s + 2s + buffer
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    vi.useRealTimers()

    expect(result).toBe('delivered')
    expect(rpcAttempts).toBe(3) // 2 busy + 1 success
  })

  it('fails after exhausting session_busy retries', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-busy' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true),
      reconnectSession: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockRejectedValue(new PiRpcError('session_busy', 'always busy')),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage, _setMinRetryWaitForTest } = await import('../ws/message-delivery')
    _setMinRetryWaitForTest(0)

    vi.useFakeTimers()
    const promise = deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Hello',
      pi: pi as never,
      broadcaster,
      manual: false,
    })
    await vi.advanceTimersByTimeAsync(10000)
    const result = await promise
    vi.useRealTimers()

    expect(result).toBe('retryable')
  })
})

describe('AIT-258 auth retry boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateTopic.mockResolvedValue(makeTopic({ pi_session_id: 'sess-auth' }))
    updateMessage.mockResolvedValue(undefined)
    createMessagePart.mockResolvedValue(undefined)
  })

  it('does not auth retry beyond the initial reconnect path for invalid credentials (TC-AIT-258-03)', async () => {
    const topic = makeTopic({ pi_session_id: 'sess-auth' })
    const msg = makeMessage()

    getTopic.mockResolvedValue(topic)
    getMessage.mockResolvedValue(msg)

    const { PiRpcError } = await import('../pi/client')
    const pi = makePi({
      hasSession: vi.fn().mockReturnValue(true),
      reconnectSession: vi.fn().mockRejectedValue(new PiRpcError('auth_invalid', 'invalid credential')),
      rpc: vi.fn().mockRejectedValue(new PiRpcError('auth_invalid', 'invalid credential')),
    })
    const broadcaster = makeBroadcaster()

    const { deliverUserMessage } = await import('../ws/message-delivery')

    const result = await deliverUserMessage({
      topicId: 'topic-1',
      messageId: 'msg-1',
      content: 'Auth failure should not storm',
      pi: pi as never,
      broadcaster,
      manual: false,
    })

    expect(result).toBe('retryable')
    expect(pi.rpc).toHaveBeenCalledTimes(2)
    expect(pi.reconnectSession).toHaveBeenCalledTimes(1)
    expect(broadcaster.events).toContainEqual(expect.objectContaining({
      type: 'message.delivery',
      data: expect.objectContaining({ status: 'needs_retry' }),
    }))
  })
})
