import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import { EventEmitter } from 'node:events'
import type { PIEvent, ServerEvent } from '@agent-chat/protocol'
import { routePiEvents } from '../pi/event-router'

function createMockHub() {
  const broadcastEvents: ServerEvent[] = []
  return {
    broadcast: vi.fn((type: string, data: unknown) => {
      broadcastEvents.push({ type, data } as ServerEvent)
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
    rpcGlobal: vi.fn(),
    markSeqRouted: vi.fn(),
    getLastSeq: vi.fn(() => 0),
  }
}

async function getRegisteredCronHandler(
  hub: { on: ReturnType<typeof vi.fn> },
  event: string,
): Promise<(...args: unknown[]) => Promise<void>> {
  const call = hub.on.mock.calls.find((c: unknown[]) => c[0] === event)
  expect(call).toBeDefined()
  return call?.[1] as (...args: unknown[]) => Promise<void>
}

describe('Cron handler — event-router cron.triggered', () => {
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

  it('should create a cronRun and broadcast cron.triggered', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Cron Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-cron-1' })

    const job = await cronRepo.createCronJob({
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
        cronId: job.pi_cron_id,
        originSessionId: 'sess-cron-1',
        runId: 'run-001',
        firedAt: 1700000000000,
        prompt: 'Hourly',
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    const runs = await cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(1)
    expect(runs[0].status).toBe('running')
    expect(runs[0].triggered_at).toBe(1700000000000)

    expect(mockHub.broadcast).toHaveBeenCalled()
    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.triggered')
    expect((broadcastEvent.data as Record<string, unknown>).cronId).toBe('pi-cron-001')
    expect((broadcastEvent.data as Record<string, unknown>).localCronId).toBe(job.id)
    expect((broadcastEvent.data as Record<string, unknown>).originTopicId).toBe(topic.id)
    expect((broadcastEvent.data as Record<string, unknown>).firedAt).toBe(1700000000000)
  })

  it('should not broadcast cron.triggered if cron job not found in DB', async () => {
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
        prompt: 'test',
      },
    }

    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('should deduplicate events by seq', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Cron Dedup Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-dedup' })

    const job = await cronRepo.createCronJob({
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
        cronId: job.pi_cron_id,
        originSessionId: 'sess-dedup',
        runId: 'run-dup',
        firedAt: Date.now(),
        prompt: 'Dedup test',
      },
    }

    mockPi.emit('event', event)
    mockPi.emit('event', event)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockHub.broadcast).toHaveBeenCalledTimes(1)
  })
})

describe('Cron handler — WS cron.pause/delete/edit', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('cron.sync: syncs crons from PI and sends cron.list to requester', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const syncHandler = await getRegisteredCronHandler(hub, 'client:cron.sync')

    const topic = await topicRepo.createTopic({
      name: 'Sync Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-sync-1' })

    mockPi.rpcGlobal.mockResolvedValue([
      {
        cronId: 'pi-sync-1',
        originSessionId: 'sess-sync-1',
        cronExpr: '0 * * * *',
        prompt: 'Hourly sync',
        tags: ['ops'],
        status: 'active',
        nextRunAt: 1700000000000,
      },
    ])

    await syncHandler('socket-sync', { d: {} })

    expect(mockPi.rpcGlobal).toHaveBeenCalledWith('listCrons', {})

    await syncHandler('socket-sync', { d: {} })

    const synced = await cronRepo.getCronJobByPiCronId('pi-sync-1')
    expect(synced).toBeDefined()
    expect(synced?.origin_topic_id).toBe(topic.id)

    expect(hub.sendToClient).toHaveBeenCalledWith('socket-sync', expect.objectContaining({
      type: 'cron.list',
    }))
  })

  it('cron.sync: maps crons by originTopicId when origin session changed', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const syncHandler = await getRegisteredCronHandler(hub, 'client:cron.sync')

    const topic = await topicRepo.createTopic({
      name: 'Sync Topic By Id',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'current-session' })

    mockPi.rpcGlobal.mockResolvedValue([
      {
        cronId: 'pi-sync-origin-topic',
        originTopicId: topic.id,
        originSessionId: 'old-session',
        cronExpr: '0 * * * *',
        prompt: 'Hourly sync',
        tags: ['report'],
        status: 'active',
        nextRunAt: 1700000000000,
      },
    ])

    await syncHandler('socket-sync', { d: {} })

    const synced = await cronRepo.getCronJobByPiCronId('pi-sync-origin-topic')
    expect(synced).toBeDefined()
    expect(synced?.origin_topic_id).toBe(topic.id)
  })

  it('cron.sync: keeps crons whose origin topic is missing', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const syncHandler = await getRegisteredCronHandler(hub, 'client:cron.sync')

    mockPi.rpcGlobal.mockResolvedValue([
      {
        cronId: 'pi-orphan-sync',
        originSessionId: 'missing-session',
        cronExpr: '0 * * * *',
        prompt: 'Orphan sync',
        status: 'active',
        nextRunAt: 1700000000000,
      },
    ])

    await syncHandler('socket-sync', { d: {} })

    const synced = await cronRepo.getCronJobByPiCronId('pi-orphan-sync')
    expect(synced).toBeDefined()
    expect(synced?.origin_topic_id).toBeNull()

    expect(hub.sendToClient).toHaveBeenCalledWith('socket-sync', expect.objectContaining({
      type: 'cron.list',
      data: expect.objectContaining({
        crons: expect.arrayContaining([
          expect.objectContaining({
            cronId: 'pi-orphan-sync',
            originTopicId: null,
          }),
        ]),
      }),
    }))
  })

  it('cron.pause: updates DB status and broadcasts cron.upserted', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const pauseCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.pause')
    expect(pauseCall).toBeDefined()
    const pauseHandler = pauseCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Pause Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-pause-1',
      cronExpr: '0 * * * *',
      prompt: 'Pause me',
    })

    mockPi.rpc.mockResolvedValue(undefined)

    await pauseHandler({}, { d: { cronId: job.pi_cron_id } })

    const updated = await cronRepo.getCronJob(job.id)
    expect(updated!.status).toBe('paused')
    expect(mockPi.rpcGlobal).toHaveBeenCalledWith('pauseCron', { cronId: job.pi_cron_id })

    expect(mockHub.broadcast).toHaveBeenCalled()
    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.upserted')
    expect((broadcastEvent.data as Record<string, unknown>).cronId).toBe(job.pi_cron_id)
    expect((broadcastEvent.data as Record<string, unknown>).localCronId).toBe(job.id)
    expect((broadcastEvent.data as Record<string, unknown>).status).toBe('paused')
  })

  it('cron.delete: deletes from DB and broadcasts cron.list', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const deleteCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.delete')
    const deleteHandler = deleteCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Delete Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-delete-1',
      cronExpr: '0 * * * *',
      prompt: 'Delete me',
    })

    mockPi.rpc.mockResolvedValue(undefined)

    await deleteHandler({}, { d: { cronId: job.pi_cron_id } })

    expect(await cronRepo.getCronJob(job.id)).toBeUndefined()
    expect(mockPi.rpcGlobal).toHaveBeenCalledWith('deleteCron', { cronId: job.pi_cron_id })

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.list')
  })

  it('cron.edit: updates cron_expr and prompt', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Edit Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-edit-1',
      cronExpr: '0 * * * *',
      prompt: 'Original',
      tags: ['alpha'],
    })

    await editHandler({}, { d: { cronId: job.pi_cron_id, cronExpr: '0 0 * * *', prompt: 'Updated', tags: ['beta'] } })

    const updated = await cronRepo.getCronJob(job.id)
    expect(updated!.cron_expr).toBe('0 0 * * *')
    expect(updated!.prompt).toBe('Updated')
    expect(updated!.tags).toEqual(['beta'])

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.upserted')
  })

  it('cron.pause: no-op for non-existent cronId', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const pauseCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.pause')
    const pauseHandler = pauseCall![1]

    await pauseHandler({}, { d: { cronId: 'nonexistent' } })

    expect(mockHub.broadcast).not.toHaveBeenCalled()
  })

  it('cron.edit: syncs to PI via updateCron', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Edit Sync Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-edit-sync' })

    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-edit-sync',
      cronExpr: '0 * * * *',
      prompt: 'Before',
    })

    mockPi.rpc.mockResolvedValue({ ok: true })

    await editHandler({}, { d: { cronId: job.pi_cron_id, cronExpr: '0 0 * * *', prompt: 'After' } })

    expect(mockPi.rpcGlobal).toHaveBeenCalledWith('updateCron', expect.objectContaining({
      cronId: 'pi-edit-sync',
      cronExpr: '0 0 * * *',
      prompt: 'After',
    }))
  })

  it('cron.edit broadcasts cron.upserted', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const topic = await topicRepo.createTopic({
      name: 'LastRun Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-lastrun',
      cronExpr: '0 * * * *',
      prompt: 'Test',
    })

    await cronRepo.createCronRun({ cronId: job.id, triggeredAt: 1700000000000 })

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    mockPi.rpc.mockResolvedValue({ ok: true })
    await editHandler({}, { d: { cronId: job.pi_cron_id, cronExpr: '0 0 * * *' } })

    const broadcastEvent = mockHub.getBroadcastEvents()[0]
    expect(broadcastEvent.type).toBe('cron.upserted')
    expect((broadcastEvent.data as Record<string, unknown>).cronId).toBe(job.pi_cron_id)
    expect((broadcastEvent.data as Record<string, unknown>).localCronId).toBe(job.id)
  })

  it('cron.edit: syncs tags to PI', async () => {
    const { registerCronHandlers } = await import('../ws/handlers/cron.handler')
    const hub = {
      on: vi.fn(),
      sendToClient: vi.fn(),
      broadcast: mockHub.broadcast,
    }
    registerCronHandlers(hub as any, mockPi as any, mockHub as any)

    const editCall = hub.on.mock.calls.find((c: string[]) => c[0] === 'client:cron.edit')
    const editHandler = editCall![1]

    const topic = await topicRepo.createTopic({
      name: 'Edit Tags Sync Topic',
      kind: 'normal',
      agentType: 'general',
    })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-edit-tags-sync' })

    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-edit-tags-sync',
      cronExpr: '0 * * * *',
      prompt: 'Before',
      tags: ['old'],
    })

    mockPi.rpc.mockResolvedValue({ ok: true })

    await editHandler({}, { d: { cronId: job.pi_cron_id, tags: ['new'] } })

    expect(mockPi.rpcGlobal).toHaveBeenCalledWith('updateCron', expect.objectContaining({
      cronId: 'pi-edit-tags-sync',
      tags: ['new'],
    }))
  })
})
