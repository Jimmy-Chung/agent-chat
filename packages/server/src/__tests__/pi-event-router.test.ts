import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import { setDb, resetDb } from '../db/migrate'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import { EventEmitter } from 'node:events'
import type { PIEvent, ServerEvent } from '@agent-chat/protocol'
import { routePiEvents } from '../pi/event-router'

function createMockHub() {
  const broadcastEvents: ServerEvent[] = []
  return {
    broadcast: vi.fn((event: ServerEvent) => {
      broadcastEvents.push(event)
    }),
    getBroadcastEvents: () => broadcastEvents,
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

describe('Event router — session.health', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any)
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  it('broadcasts session.health connected', () => {
    topicRepo.createTopic({ name: 'Health Topic', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(
      topicRepo.listTopics().find((t) => t.name === 'Health Topic')!.id,
      { pi_session_id: 'sess-health-1' },
    )

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-health-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-health-1' },
    }

    mockPi.emit('event', event)

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('session.health')
    expect((broadcast.data as Record<string, unknown>).state).toBe('connected')
    expect((broadcast.data as Record<string, unknown>).piSessionId).toBe('sess-health-1')
  })

  it('broadcasts session.health disconnected with lastError', () => {
    const topic = topicRepo.createTopic({ name: 'Disconnect Topic', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-disc-1' })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-disc-1',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'disconnected', piSessionId: 'sess-disc-1', lastError: 'connection reset' },
    }

    mockPi.emit('event', event)

    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('session.health')
    expect((broadcast.data as Record<string, unknown>).state).toBe('disconnected')
    expect((broadcast.data as Record<string, unknown>).lastError).toBe('connection reset')
  })

  it('ignores session.health for unknown session', () => {
    const event: PIEvent = {
      seq: 1,
      sessionId: 'unknown-session',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'unknown-session' },
    }

    mockPi.emit('event', event)
    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('deduplicates session.health by seq', () => {
    const topic = topicRepo.createTopic({ name: 'Dedup Health', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-dedup-h' })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-dedup-h',
      ts: Date.now(),
      payload: { kind: 'session.health', state: 'connected', piSessionId: 'sess-dedup-h' },
    }

    mockPi.emit('event', event)
    mockPi.emit('event', event)

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
  })
})

describe('Event router — cron.run.completed', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    routePiEvents(mockPi as any, mockHub as any)
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  it('updates cron run and broadcasts cron.run.completed', () => {
    const topic = topicRepo.createTopic({ name: 'Cron Complete Topic', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-cron-comp' })

    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-cron-comp',
      cronExpr: '0 * * * *',
      prompt: 'Hourly',
    })

    // Create a running cron run
    const run = cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })
    expect(cronRepo.listCronRuns(job.id)[0].status).toBe('running')

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

    // Cron run updated in DB
    const updatedRun = cronRepo.listCronRuns(job.id)[0]
    expect(updatedRun.status).toBe('success')

    // Broadcast sent
    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).cronId).toBe(job.id)
    expect((broadcast.data as Record<string, unknown>).originTopicId).toBe(topic.id)
    expect((broadcast.data as Record<string, unknown>).status).toBe('success')
    expect((broadcast.data as Record<string, unknown>).duration).toBe(5000)
  })

  it('ignores cron.run.completed for unknown cronId', () => {
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
    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('handles cron.run.completed with timeout status', () => {
    const topic = topicRepo.createTopic({ name: 'Cron Timeout', kind: 'normal', agentType: 'general' })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-timeout' })

    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-timeout',
      cronExpr: '0 * * * *',
      prompt: 'May timeout',
    })

    cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })

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

    const broadcast = mockHub.getBroadcastEvents()[0]
    expect(broadcast.type).toBe('cron.run.completed')
    expect((broadcast.data as Record<string, unknown>).status).toBe('timeout')
  })
})
