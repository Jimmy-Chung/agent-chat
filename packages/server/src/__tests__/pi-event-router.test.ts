import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as pushRepo from '../db/repos/push-subscription.repo'
import type { AppConfig } from '../config'
import { EventEmitter } from 'node:events'
import type { PIEvent, ServerEvent } from '@agent-chat/protocol'
import {
  clearStreamDisconnectFinalizer,
  finalizeStreamingMessagesAfterDisconnectForTests,
  setStreamDisconnectFinalizeTimeoutForTests,
  setPiEventReorderWindowForTests,
  routePiEvents,
  mapAgentState,
  toUserFacingAgentErrorMessage,
} from '../pi/event-router'

function createMockHub() {
  const broadcastEvents: ServerEvent[] = []
  return {
    broadcast: vi.fn((type: string, data: unknown) => {
      broadcastEvents.push({ type, data } as ServerEvent)
    }),
    getBroadcastEvents: () => broadcastEvents,
    clearBroadcastEvents: () => {
      broadcastEvents.length = 0
    },
  }
}

function createMockPiClient() {
  const emitter = new EventEmitter()
  return {
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    rpc: vi.fn(),
    markSeqRouted: vi.fn(),
  }
}

describe('mapAgentState — adapter state → WS {state, phase}', () => {
  it('passes terminal states through unchanged with no phase', () => {
    expect(mapAgentState('idle')).toEqual({ state: 'idle' })
    expect(mapAgentState('aborting')).toEqual({ state: 'aborting' })
  })

  it('collapses waiting_for_user into processing with no phase', () => {
    expect(mapAgentState('waiting_for_user')).toEqual({ state: 'processing' })
  })

  it('maps work states into processing + phase', () => {
    expect(mapAgentState('thinking')).toEqual({ state: 'processing', phase: 'thinking' })
    expect(mapAgentState('streaming')).toEqual({ state: 'processing', phase: 'streaming' })
    expect(mapAgentState('tool')).toEqual({ state: 'processing', phase: 'tool_use' })
  })

  it('falls back to processing + thinking for unknown states', () => {
    expect(mapAgentState('something-new')).toEqual({ state: 'processing', phase: 'thinking' })
  })
})

describe('toUserFacingAgentErrorMessage', () => {
  it('maps provider auth errors to actionable copy', () => {
    expect(toUserFacingAgentErrorMessage(
      '[internal] No API key found for undefined. Use /login to log into a provider via OAuth or API key.',
    )).toBe('模型 Provider 未完成认证或当前账号不可用。请在运行 Adapter 的机器上执行 /login，或配置对应 API key，并确认账号未欠费、额度未耗尽。')
  })

  it('maps billing and quota errors to actionable copy', () => {
    expect(toUserFacingAgentErrorMessage('Payment required: insufficient_quota')).toBe(
      '模型服务额度或账单不可用。请检查当前 Provider 的余额、套餐、额度或账单状态后重试。',
    )
  })
})

describe('Event router — session.health', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('broadcasts session.health connected', async () => {
    await topicRepo.createTopic({ name: 'Health Topic', kind: 'normal', agentType: 'general' })
    const topics = await topicRepo.listTopics()
    await topicRepo.updateTopic(
      topics.find((t) => t.name === 'Health Topic')!.id,
      { pi_session_id: 'sess-health-1' },
    )

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-health-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-health-1' },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('session.health')
    expect((broadcast.data as Record<string, unknown>).state).toBe('connected')
    expect((broadcast.data as Record<string, unknown>).piSessionId).toBe('sess-health-1')
  })

  it('broadcasts session.health disconnected with lastError', async () => {
    const topic = await topicRepo.createTopic({ name: 'Disconnect Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-disc-1' })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-disc-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'disconnected', piSessionId: 'sess-disc-1', lastError: 'connection reset' },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('session.health')
    expect((broadcast.data as Record<string, unknown>).state).toBe('disconnected')
    expect((broadcast.data as Record<string, unknown>).lastError).toBe('connection reset')
  })

  it('does not synthesize message.end(error) for streaming messages on transient disconnect', async () => {
    const topic = await topicRepo.createTopic({ name: 'Streaming Disconnect Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-stream-disc' })

    mockPi.emit('event', {
      seq: 1,
      sessionId: 'sess-stream-disc',
      ts: Date.now(),
      payload: { kind: 'message.start', messageId: 'msg-stream-disc', role: 'assistant' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))
    mockHub.clearBroadcastEvents()

    mockPi.emit('event', {
      seq: 0,
      sessionId: 'sess-stream-disc',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'disconnected', piSessionId: 'sess-stream-disc' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    const events = mockHub.getBroadcastEvents()
    expect(events.map((e) => e.type)).toEqual(['session.health'])
    const msg = await messageRepo.getMessage('msg-stream-disc')
    expect(msg?.status).toBe('streaming')
    expect(msg?.stop_reason).toBeNull()
    clearStreamDisconnectFinalizer(topic.id)
  })

  it('finalizes streaming messages after session.health disconnected timeout', async () => {
    setStreamDisconnectFinalizeTimeoutForTests(1)
    try {
      const topic = await topicRepo.createTopic({ name: 'Streaming Disconnect Timeout Topic', kind: 'normal', agentType: 'general' })
      await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-stream-timeout' })

      mockPi.emit('event', {
        seq: 1,
        sessionId: 'sess-stream-timeout',
        ts: Date.now(),
        payload: { kind: 'message.start', messageId: 'msg-stream-timeout', role: 'assistant' },
      } satisfies PIEvent)
      await new Promise((r) => setTimeout(r, 20))
      mockHub.clearBroadcastEvents()

      await finalizeStreamingMessagesAfterDisconnectForTests(topic.id, 'sess-stream-timeout', mockHub as any)

      const events = mockHub.getBroadcastEvents()
      expect(events.map((e) => e.type)).toEqual(['message.end', 'agent.status'])
      const end = events.find((e) => e.type === 'message.end')!
      expect((end.data as Record<string, unknown>).messageId).toBe('msg-stream-timeout')
      expect((end.data as Record<string, unknown>).stopReason).toBe('aborted')
      const idle = events.find((e) => e.type === 'agent.status')!
      expect((idle.data as Record<string, unknown>).state).toBe('idle')
      const msg = await messageRepo.getMessage('msg-stream-timeout')
      expect(msg?.status).toBe('aborted')
      expect(msg?.stop_reason).toBe('aborted')
    } finally {
      setStreamDisconnectFinalizeTimeoutForTests(null)
    }
  })

  it('cancels disconnected finalize when session reconnects before timeout', async () => {
    let topicId: string | null = null
    setStreamDisconnectFinalizeTimeoutForTests(50)
    try {
      const topic = await topicRepo.createTopic({ name: 'Streaming Reconnect Topic', kind: 'normal', agentType: 'general' })
      topicId = topic.id
      await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-stream-reconnect' })

      mockPi.emit('event', {
        seq: 1,
        sessionId: 'sess-stream-reconnect',
        ts: Date.now(),
        payload: { kind: 'message.start', messageId: 'msg-stream-reconnect', role: 'assistant' },
      } satisfies PIEvent)
      await new Promise((r) => setTimeout(r, 20))
      mockHub.clearBroadcastEvents()

      mockPi.emit('event', {
        seq: 0,
        sessionId: 'sess-stream-reconnect',
        ts: Date.now(),
        payload: { kind: 'session.health', state: 'disconnected', piSessionId: 'sess-stream-reconnect' },
      } satisfies PIEvent)
      await new Promise((r) => setTimeout(r, 20))
      mockPi.emit('event', {
        seq: 0,
        sessionId: 'sess-stream-reconnect',
        ts: Date.now(),
        payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-stream-reconnect' },
      } satisfies PIEvent)

      await new Promise((r) => setTimeout(r, 80))

      expect(mockHub.getBroadcastEvents().map((e) => e.type)).toEqual(['session.health', 'session.health'])
      expect((await messageRepo.getMessage('msg-stream-reconnect'))?.status).toBe('streaming')
    } finally {
      if (topicId) clearStreamDisconnectFinalizer(topicId)
      setStreamDisconnectFinalizeTimeoutForTests(null)
    }
  })

  it('ignores session.health for unknown session', async () => {
    const event: PIEvent = {
      seq: 1,
      sessionId: 'unknown-session',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'unknown-session' },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))
    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('does not deduplicate session.health by seq (bypasses seq filter)', async () => {
    const topic = await topicRepo.createTopic({ name: 'Dedup Health', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-dedup-h' })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-dedup-h',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-dedup-h' },
    }

    mockPi.emit('event', event)
    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    // session.health bypasses seq dedup — both events pass through
    expect(mockHub.broadcast).toHaveBeenCalledTimes(2)
  })

  it('finalizes leftover streaming messages when agent.status idle arrives', async () => {
    const topic = await topicRepo.createTopic({ name: 'Idle Finalize Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-idle-finalize' })
    await messageRepo.createMessage({
      id: 'msg-idle-leftover',
      topicId: topic.id,
      role: 'assistant',
    })

    mockPi.emit('event', {
      seq: 1,
      sessionId: 'sess-idle-finalize',
      ts: Date.now(),
      payload: { kind: 'agent.status', state: 'idle' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    const msg = await messageRepo.getMessage('msg-idle-leftover')
    expect(msg?.status).toBe('aborted')
    expect(msg?.stop_reason).toBe('aborted')
    const events = mockHub.getBroadcastEvents()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.end',
      data: expect.objectContaining({ messageId: 'msg-idle-leftover', stopReason: 'aborted' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent.status',
      data: expect.objectContaining({ topicId: topic.id, state: 'idle' }),
    }))
  })

  it('accepts low seq events again after session recreate reset', async () => {
    const topic = await topicRepo.createTopic({ name: 'Recreate Reset', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-reset-1' })

    mockPi.emit('event', {
      seq: 5,
      sessionId: 'sess-reset-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-reset-1' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 20))

    mockPi.emit('session.recreated', { sessionId: 'sess-reset-1' })
    mockPi.emit('event', {
      seq: 1,
      sessionId: 'sess-reset-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-reset-1' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockHub.broadcast).toHaveBeenCalledTimes(2)
  })

  it('reorders out-of-order non-health events by seq while still deduplicating repeated seq', async () => {
    const topic = await topicRepo.createTopic({ name: 'Out Of Order Delta', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-ooo-delta' })

    mockPi.emit('event', {
      seq: 1,
      sessionId: 'sess-ooo-delta',
      ts: Date.now(),
      payload: { kind: 'message.start', messageId: 'msg-ooo-delta', role: 'assistant' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 20))

    mockPi.emit('event', {
      seq: 3,
      sessionId: 'sess-ooo-delta',
      ts: Date.now(),
      payload: { kind: 'message.end', messageId: 'msg-ooo-delta', stopReason: 'end_turn' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 20))

    const lateDelta = {
      seq: 2,
      sessionId: 'sess-ooo-delta',
      ts: Date.now(),
      payload: { kind: 'message.delta', messageId: 'msg-ooo-delta', part: { kind: 'text', content: 'tail' } },
    } satisfies PIEvent
    mockPi.emit('event', lateDelta)
    mockPi.emit('event', lateDelta)
    await new Promise((r) => setTimeout(r, 50))
    await messageRepo.flushParts()

    const events = mockHub.getBroadcastEvents()
    expect(events.map((e) => e.type)).toEqual([
      'message.start',
      'agent.status',
      'message.delta',
      'agent.status',
      'message.end',
      'agent.status',
    ])
    const deltas = events.filter((e) => e.type === 'message.delta')
    expect(deltas).toHaveLength(1)
    expect((deltas[0].data as { messageId: string }).messageId).toBe('msg-ooo-delta')

    const parts = await messageRepo.getMessageParts('msg-ooo-delta')
    expect(parts).toHaveLength(1)
    expect(parts[0].content_json).toBe(JSON.stringify({ kind: 'text', content: 'tail' }))
  })

  it('marks lastSeq only after routed events are persisted and exposes the route promise to waitUntil', async () => {
    const topic = await topicRepo.createTopic({ name: 'Routed Seq Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-routed-seq' })
    const waitUntil = vi.fn()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any, undefined, { waitUntil })

    mockPi.emit('event', {
      seq: 1,
      sessionId: 'sess-routed-seq',
      ts: Date.now(),
      payload: { kind: 'message.start', messageId: 'msg-routed-seq', role: 'assistant' },
    } satisfies PIEvent)
    mockPi.emit('event', {
      seq: 2,
      sessionId: 'sess-routed-seq',
      ts: Date.now(),
      payload: { kind: 'message.end', messageId: 'msg-routed-seq', stopReason: 'end_turn' },
    } satisfies PIEvent)

    expect(waitUntil).toHaveBeenCalled()
    const promises = waitUntil.mock.calls.map((call) => call[0] as Promise<unknown>)
    await Promise.all(promises)

    const msg = await messageRepo.getMessage('msg-routed-seq')
    expect(msg?.status).toBe('done')
    expect(msg?.stop_reason).toBe('end_turn')
    expect(mockPi.markSeqRouted).toHaveBeenCalledWith('sess-routed-seq', 1)
    expect(mockPi.markSeqRouted).toHaveBeenCalledWith('sess-routed-seq', 2)
  })

  it('persists streaming text in seq order when adapter delivery is interleaved', async () => {
    const topic = await topicRepo.createTopic({ name: 'Das Delta Order', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-das-delta' })

    const event = (seq: number, content: string): PIEvent => ({
      seq,
      sessionId: 'sess-das-delta',
      ts: Date.now(),
      payload: { kind: 'message.delta', messageId: 'msg-das-delta', part: { kind: 'text', content } },
    })

    mockPi.emit('event', {
      seq: 191,
      sessionId: 'sess-das-delta',
      ts: Date.now(),
      payload: { kind: 'message.start', messageId: 'msg-das-delta', role: 'assistant' },
    } satisfies PIEvent)
    mockPi.emit('event', event(194, '先放'))
    mockPi.emit('event', event(192, '好的，'))
    mockPi.emit('event', event(195, '一'))
    mockPi.emit('event', event(198, '放，需要'))
    mockPi.emit('event', event(200, '的时候再'))
    mockPi.emit('event', event(202, '继续。'))
    mockPi.emit('event', {
      seq: 203,
      sessionId: 'sess-das-delta',
      ts: Date.now(),
      payload: { kind: 'message.end', messageId: 'msg-das-delta', stopReason: 'end_turn' },
    } satisfies PIEvent)

    await new Promise((r) => setTimeout(r, 900))
    await messageRepo.flushParts()

    const parts = await messageRepo.getMessageParts('msg-das-delta')
    expect(parts).toHaveLength(1)
    expect(parts[0].content_json).toBe(JSON.stringify({
      kind: 'text',
      content: '好的，先放一放，需要的时候再继续。',
    }))

    const textDeltas = mockHub.getBroadcastEvents()
      .filter((e) => e.type === 'message.delta')
      .map((e) => (e.data as { part: { content?: string } }).part.content)
    expect(textDeltas).toEqual([
      '好的，',
      '先放',
      '一',
      '放，需要',
      '的时候再',
      '继续。',
    ])
  })

  it('drains late-arriving low-seq event that missed the initial drain window', async () => {
    const topic = await topicRepo.createTopic({ name: 'Late Seq Topic', kind: 'normal', agentType: 'programming' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-late-seq' })

    setPiEventReorderWindowForTests(20)

    // Simulate: interaction.request (high seq) arrives first, alone
    mockPi.emit('event', {
      seq: 103,
      sessionId: 'sess-late-seq',
      ts: Date.now(),
      payload: {
        kind: 'interaction.request',
        interactionId: 'int-late-1',
        messageId: 'msg-late',
        interactionKind: 'approval',
        prompt: 'Allow running rm -rf /?',
      },
    } satisfies PIEvent)

    // Wait for the gap flush to fire (20ms window + buffer)
    await new Promise((r) => setTimeout(r, 50))

    // message.start (low seq) arrives LATE — after the buffer already processed seq 103
    mockPi.emit('event', {
      seq: 100,
      sessionId: 'sess-late-seq',
      ts: Date.now(),
      payload: { kind: 'message.start', messageId: 'msg-late', role: 'assistant' },
    } satisfies PIEvent)
    mockPi.emit('event', {
      seq: 101,
      sessionId: 'sess-late-seq',
      ts: Date.now(),
      payload: { kind: 'message.delta', messageId: 'msg-late', part: { kind: 'text', content: 'I need approval.' } },
    } satisfies PIEvent)

    // Wait for the next gap flush to process the late events
    await new Promise((r) => setTimeout(r, 50))

    setPiEventReorderWindowForTests(150)

    const events = mockHub.getBroadcastEvents()
    const broadcastKinds = events.map((e) => e.type)
    // message.start must arrive (the late event) AND interaction.request must arrive
    expect(broadcastKinds).toContain('message.start')
    expect(broadcastKinds).toContain('interaction.request')
    expect(broadcastKinds).toContain('message.delta')

    // Verify interaction.request carries correct data
    const irEvent = events.find((e) => e.type === 'interaction.request')
    expect(irEvent).toBeDefined()
    expect((irEvent!.data as Record<string, unknown>).interactionKind).toBe('approval')
  })
})

describe('Event router — cron.run.completed', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('updates cron run and broadcasts cron.run.completed', async () => {
    const topic = await topicRepo.createTopic({ name: 'Cron Complete Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-cron-comp' })

    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-cron-comp',
      cronExpr: '0 * * * *',
      prompt: 'Hourly',
    })

    const run = await cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })
    expect((await cronRepo.listCronRuns(job.id))[0].status).toBe('running')

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-cron-comp',
      ts: Date.now(),
      payload: {
        kind: 'cron.run.completed',
        cronId: job.pi_cron_id,
        runId: run.id,
        status: 'success',
        summary: 'Completed',
        duration: 5000,
        completedAt: 1700000005000,
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    const updatedRun = (await cronRepo.listCronRuns(job.id))[0]
    expect(updatedRun.status).toBe('success')

    const messageStart = mockHub.getBroadcastEvents().find((e) => e.type === 'message.start')
    expect(messageStart).toBeDefined()
    expect((messageStart!.data as Record<string, unknown>).topicId).toBe(topic.id)
    expect((messageStart!.data as Record<string, unknown>).role).toBe('cron')

    const messages = await messageRepo.listMessagesByTopic(topic.id)
    const cronMessage = messages.find((m) => m.role === 'cron')
    expect(cronMessage).toBeDefined()
    expect(cronMessage!.cron_run_id).toBe(run.id)
    const parts = await messageRepo.getMessageParts(cronMessage!.id)
    expect(JSON.parse(parts[0].content_json)).toEqual({ content: '定时任务完成：Completed' })

    const broadcast = mockHub.getBroadcastEvents().find((e) => e.type === 'cron.run.completed')!
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).cronId).toBe(job.pi_cron_id)
    expect((broadcast.data as Record<string, unknown>).localCronId).toBe(job.id)
    expect((broadcast.data as Record<string, unknown>).originTopicId).toBe(topic.id)
    expect((broadcast.data as Record<string, unknown>).originTopicAvailable).toBe(true)
    expect((broadcast.data as Record<string, unknown>).status).toBe('success')
    expect((broadcast.data as Record<string, unknown>).duration).toBe(5000)
  })

  it('ignores cron.run.completed for unknown cronId', async () => {
    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-unknown',
      ts: Date.now(),
      payload: {
        kind: 'cron.run.completed',
        cronId: 'nonexistent',
        runId: 'run-x',
        status: 'failed',
        summary: null,
        duration: null,
        completedAt: Date.now(),
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))
    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('handles cron.run.completed with timeout status', async () => {
    const topic = await topicRepo.createTopic({ name: 'Cron Timeout', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-timeout' })

    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-timeout',
      cronExpr: '0 * * * *',
      prompt: 'May timeout',
    })

    await cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-timeout',
      ts: Date.now(),
      payload: {
        kind: 'cron.run.completed',
        cronId: job.pi_cron_id,
        runId: 'run-timeout',
        status: 'timeout',
        summary: 'Exceeded time limit',
        duration: 60000,
        completedAt: 1700000060000,
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    const broadcast = mockHub.getBroadcastEvents().find((e) => e.type === 'cron.run.completed')!
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).status).toBe('timeout')
  })

  it('broadcasts global-only completion when origin topic is archived', async () => {
    const topic = await topicRepo.createTopic({ name: 'Archived Cron Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-archived-cron' })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-archived',
      cronExpr: '0 * * * *',
      prompt: 'Archived topic task',
    })
    const run = await cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })
    await topicRepo.deleteTopic(topic.id)

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-archived-cron',
      ts: Date.now(),
      payload: {
        kind: 'cron.run.completed',
        cronId: job.pi_cron_id,
        runId: run.id,
        status: 'success',
        summary: 'Done after archive',
        duration: 1000,
        completedAt: 1700000001000,
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockHub.getBroadcastEvents().some((e) => e.type === 'message.start')).toBe(false)
    const broadcast = mockHub.getBroadcastEvents().find((e) => e.type === 'cron.run.completed')!
    expect((broadcast.data as Record<string, unknown>).originTopicId).toBe(topic.id)
    expect((broadcast.data as Record<string, unknown>).originTopicAvailable).toBe(false)
    expect((await cronRepo.listCronRuns(job.id))[0].status).toBe('success')
  })
})

describe('Event router — message.end derives agent.status idle (AIT-137)', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  async function setupTopicAndStartMessage(sessionId: string, messageId: string): Promise<string> {
    const topic = await topicRepo.createTopic({ name: 'Idle Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: sessionId })
    mockPi.emit('event', {
      seq: 1,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'message.start', messageId, role: 'assistant' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))
    return topic.id
  }

  for (const stopReason of ['end_turn', 'max_tokens', 'aborted', 'error'] as const) {
    it(`broadcasts agent.status idle after message.end (stopReason=${stopReason})`, async () => {
      const sessionId = `sess-end-${stopReason}`
      const messageId = `msg-${stopReason}`
      await setupTopicAndStartMessage(sessionId, messageId)
      mockHub.broadcast.mockClear()
      mockHub.clearBroadcastEvents()

      mockPi.emit('event', {
        seq: 2,
        sessionId,
        ts: Date.now(),
        payload: { kind: 'message.end', messageId, stopReason },
      } satisfies PIEvent)
      await new Promise((r) => setTimeout(r, 50))

      const events = mockHub.getBroadcastEvents()
      const types = events.map((e) => e.type)
      expect(types).toContain('message.end')
      expect(types).toContain('agent.status')
      const idle = events.find((e) => e.type === 'agent.status')!
      expect((idle.data as Record<string, unknown>).state).toBe('idle')
    })
  }

  it('does NOT broadcast agent.status idle when stopReason is tool_use', async () => {
    const sessionId = 'sess-end-tool-use'
    const messageId = 'msg-tool-use'
    await setupTopicAndStartMessage(sessionId, messageId)
    mockHub.broadcast.mockClear()
    mockHub.clearBroadcastEvents()

    mockPi.emit('event', {
      seq: 2,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'message.end', messageId, stopReason: 'tool_use' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    const events = mockHub.getBroadcastEvents()
    const types = events.map((e) => e.type)
    expect(types).toContain('message.end')
    expect(types).not.toContain('agent.status')
  })
})

// 体验微调 — Web Push must NOT fire on a 'tool_use' stop (the agent is just
// pausing to call a tool). Pushing "有新回复" on every tool call spams the user.
// Only real turn endings (end_turn / error / aborted / ...) and interaction
// requests should push.
describe('message.end Web Push gating — skip tool_use', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>
  let listSubsSpy: ReturnType<typeof vi.spyOn>

  const pushConfig = {
    vapidPublicKey: 'BTestPublicKey',
    vapidPrivateKey: 'testPrivateKey',
    vapidSubject: 'mailto:test@example.com',
  } as unknown as AppConfig

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    // listSubscriptions is the first thing sendPushToAll touches after the vapid
    // key check, so spying on it tells us whether the push path was entered.
    listSubsSpy = vi.spyOn(pushRepo, 'listSubscriptions').mockResolvedValue([])
    routePiEvents(mockPi as any, mockHub as any, pushConfig)
  })

  afterEach(() => {
    teardownTestDb()
    vi.restoreAllMocks()
  })

  async function startMessage(sessionId: string, messageId: string): Promise<void> {
    const topic = await topicRepo.createTopic({ name: 'Push Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: sessionId })
    mockPi.emit('event', {
      seq: 1,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'message.start', messageId, role: 'assistant' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))
  }

  it('does NOT enter the push path when stopReason is tool_use', async () => {
    const sessionId = 'sess-push-tool-use'
    const messageId = 'msg-push-tool-use'
    await startMessage(sessionId, messageId)
    listSubsSpy.mockClear()

    mockPi.emit('event', {
      seq: 2,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'message.end', messageId, stopReason: 'tool_use' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    expect(listSubsSpy).not.toHaveBeenCalled()
  })

  it('enters the push path on a real turn ending (stopReason=end_turn)', async () => {
    const sessionId = 'sess-push-end-turn'
    const messageId = 'msg-push-end-turn'
    await startMessage(sessionId, messageId)
    listSubsSpy.mockClear()

    mockPi.emit('event', {
      seq: 2,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'message.end', messageId, stopReason: 'end_turn' },
    } satisfies PIEvent)
    await new Promise((r) => setTimeout(r, 50))

    expect(listSubsSpy).toHaveBeenCalled()
  })
})
