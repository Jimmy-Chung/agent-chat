import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as pushRepo from '../db/repos/push-subscription.repo'
import type { AppConfig } from '../config'
import { EventEmitter } from 'node:events'
import type { PIEvent, ServerEvent } from '@agent-chat/protocol'
import { routePiEvents, mapAgentState } from '../pi/event-router'

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
        cronId: job.id,
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

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).cronId).toBe(job.id)
    expect((broadcast.data as Record<string, unknown>).originTopicId).toBe(topic.id)
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
        cronId: job.id,
        runId: 'run-timeout',
        status: 'timeout',
        summary: 'Exceeded time limit',
        duration: 60000,
        completedAt: 1700000060000,
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).status).toBe('timeout')
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
