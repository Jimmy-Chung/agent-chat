import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import { setDb, resetDb } from '../db/migrate'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import { EventEmitter } from 'node:events'
import type { PIEvent, ServerEvent } from '@agent-chat/protocol'
import { routePiEvents } from '../pi/event-router'

// Minimal mocks
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

describe('Cron handler — event-router cron.triggered', () => {
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

  it('should create a cronRun and broadcast cron.triggered', () => {
    const topic = topicRepo.createTopic({
      name: 'Cron Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-cron-1' })

    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-cron-001',
      cronExpr: '0 * * * *',
      prompt: 'Hourly',
    })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-cron-1',
      ts: Date.now(),
      payload: {
        kind: 'cron.triggered',
        cronId: job.id,
        originSessionId: 'sess-cron-1',
        runId: 'run-001',
        firedAt: 1700000000000,
      },
    }

    mockPi.emit('event', event)

    // Should have created a cron run
    const runs = cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(1)
    expect(runs[0].status).toBe('running')
    expect(runs[0].triggered_at).toBe(1700000000000)

    // Should have broadcast cron.triggered
    expect(mockHub.broadcast).toHaveBeenCalled()
    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.triggered')
    expect((broadcastEvent.data as Record<string, unknown>).originTopicId).toBe(topic.id)
    expect((broadcastEvent.data as Record<string, unknown>).firedAt).toBe(1700000000000)
  })

  it('should ignore cron.triggered if origin session not found', () => {
    const event: PIEvent = {
      seq: 1,
      sessionId: 'unknown-session',
      ts: Date.now(),
      payload: {
        kind: 'cron.triggered',
        cronId: 'cron-1',
        originSessionId: 'unknown-session',
        runId: 'run-001',
        firedAt: Date.now(),
      },
    }

    mockPi.emit('event', event)

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('should deduplicate events by seq', () => {
    const topic = topicRepo.createTopic({
      name: 'Cron Dedup Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-dedup' })

    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-dedup',
      cronExpr: '0 * * * *',
      prompt: 'Dedup test',
    })

    const event: PIEvent = {
      seq: 1,
      sessionId: 'sess-dedup',
      ts: Date.now(),
      payload: {
        kind: 'cron.triggered',
        cronId: job.id,
        originSessionId: 'sess-dedup',
        runId: 'run-dup',
        firedAt: Date.now(),
      },
    }

    mockPi.emit('event', event)
    mockPi.emit('event', event) // same seq, should be ignored

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
  })
})

describe('Cron handler — WS cron.pause/delete/edit', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    mockHub = createMockHub()
    mockPi = createMockPiClient()
  })

  afterEach(() => {
    resetDb()
    teardownTestDb()
  })

  it('cron.pause: updates DB status and broadcasts cron.upserted', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    // Find the registered handler for client:cron.pause
    const pauseCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.pause')
    expect(pauseCall).toBeDefined()
    const pauseHandler = pauseCall![1]

    const topic = topicRepo.createTopic({
      name: 'Pause Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-pause-1',
      cronExpr: '0 * * * *',
      prompt: 'Pause me',
    })

    mockPi.rpc.mockResolvedValue(undefined)

    await pauseHandler({}, { d: { cronId: job.id } })

    // DB updated
    const updated = cronRepo.getCronJob(job.id)
    expect(updated!.status).toBe('paused')

    // Broadcast sent
    expect(mockHub.broadcast).toHaveBeenCalled()
    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.upserted')
    expect((broadcastEvent.data as Record<string, unknown>).status).toBe('paused')
  })

  it('cron.delete: deletes from DB and broadcasts cron.list', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    const deleteCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.delete')
    const deleteHandler = deleteCall![1]

    const topic = topicRepo.createTopic({
      name: 'Delete Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-delete-1',
      cronExpr: '0 * * * *',
      prompt: 'Delete me',
    })

    mockPi.rpc.mockResolvedValue(undefined)

    await deleteHandler({}, { d: { cronId: job.id } })

    // DB deleted
    expect(cronRepo.getCronJob(job.id)).toBeUndefined()

    // Broadcast sent
    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.list')
  })

  it('cron.edit: updates cron_expr and prompt', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    const topic = topicRepo.createTopic({
      name: 'Edit Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-edit-1',
      cronExpr: '0 * * * *',
      prompt: 'Original',
    })

    await editHandler({}, { d: { cronId: job.id, cronExpr: '0 0 * * *', prompt: 'Updated' } })

    const updated = cronRepo.getCronJob(job.id)
    expect(updated!.cron_expr).toBe('0 0 * * *')
    expect(updated!.prompt).toBe('Updated')

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.upserted')
  })

  it('cron.pause: no-op for non-existent cronId', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    const pauseCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.pause')
    const pauseHandler = pauseCall![1]

    await pauseHandler({}, { d: { cronId: 'nonexistent' } })

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('cron.edit: syncs to PI via deleteCron + createCron', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    const topic = topicRepo.createTopic({
      name: 'Edit Sync Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-edit-sync' })

    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-edit-sync',
      cronExpr: '0 * * * *',
      prompt: 'Before',
    })

    mockPi.rpc.mockResolvedValue({ cronId: 'pi-edit-sync' })

    await editHandler({}, { d: { cronId: job.id, cronExpr: '0 0 * * *', prompt: 'After' } })

    expect(mockPi.rpc).toHaveBeenCalledWith('deleteCron', expect.objectContaining({ cronId: 'pi-edit-sync' }))
    expect(mockPi.rpc).toHaveBeenCalledWith('createCron', expect.objectContaining({ cronExpr: '0 0 * * *', prompt: 'After' }))
  })

  it('cronJobToPayload: lastRunAt comes from latest cron run', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = Object.assign(mockHub, { on: vi.fn(), sendToClient: vi.fn() })
    registerCronHandlers(hub as any, mockPi as any)

    const topic = topicRepo.createTopic({
      name: 'LastRun Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-lastrun',
      cronExpr: '0 * * * *',
      prompt: 'Test',
    })

    // Create a cron run
    cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    mockPi.rpc.mockResolvedValue({ cronId: 'pi-lastrun' })
    await editHandler({}, { d: { cronId: job.id, cronExpr: '0 0 * * *' } })

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect((broadcastEvent.data as Record<string, unknown>).lastRunAt).toBe(1700000000000)
  })
})
