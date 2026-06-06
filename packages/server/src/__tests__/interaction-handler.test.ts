import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as topicRepo from '../db/repos/topic.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as messageRepo from '../db/repos/message.repo'

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

describe('Interaction handler — user.action abort', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerInteractionHandlers } = await import('../ws/handlers/interaction.handler')
    registerInteractionHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('calls PI abortSession for abort action', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Abort Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-abort-1' })

    await actionHandler({}, { d: { topicId: topic.id, action: 'abort' } })

    expect(mockPi.rpc).toHaveBeenCalledWith('abortSession', { sessionId: 'sess-abort-1' })
  })

  it('finalizes local streaming messages and returns agent status to idle after abort', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Abort Finalize', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-abort-finalize' })
    const message = await messageRepo.createMessage({
      topicId: topic.id,
      role: 'assistant',
      status: 'streaming',
    })

    await actionHandler({}, { d: { topicId: topic.id, action: 'abort' } })

    const updated = await messageRepo.getMessage(message.id)
    expect(updated?.status).toBe('aborted')
    expect(updated?.stop_reason).toBe('aborted')

    const events = mockHub.getBroadcastEvents()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent.status', data: { topicId: topic.id, state: 'aborting' } }),
      expect.objectContaining({ type: 'message.end', data: { topicId: topic.id, messageId: message.id, stopReason: 'aborted' } }),
      expect.objectContaining({ type: 'agent.status', data: { topicId: topic.id, state: 'idle' } }),
    ]))
  })

  it('no-ops abort for topic without PI session', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'No PI', kind: 'normal', agentType: 'general' })

    await actionHandler({}, { d: { topicId: topic.id, action: 'abort' } })

    expect(mockPi.rpc).not.toHaveBeenCalled()
  })
})

describe('Interaction handler — user.action approve/reject', () => {
  let mockHub: ReturnType<typeof createMockHub>
  let mockPi: ReturnType<typeof createMockPiClient>

  beforeEach(async () => {
    await setupTestDb()
    mockHub = createMockHub()
    mockPi = createMockPiClient()
    const { registerInteractionHandlers } = await import('../ws/handlers/interaction.handler')
    registerInteractionHandlers(mockHub as any, mockPi as any, mockHub as any)
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('resolves interaction with approve and forwards to PI', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Approve Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-approve' })

    const interaction = await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Allow file edit?',
    })

    await actionHandler({}, {
      d: { topicId: topic.id, action: 'approve', interactionId: interaction.id },
    })

    const updated = await interactionRepo.getInteraction(interaction.id)
    expect(updated!.status).toBe('resolved')

    expect(mockPi.rpc).toHaveBeenCalledWith('resolveInteraction', expect.objectContaining({
      sessionId: 'sess-approve',
      interactionId: interaction.id,
      decision: 'approve',
    }))
  })

  it('resolves interaction with reject', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Reject Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-reject' })

    const interaction = await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Allow delete?',
    })

    await actionHandler({}, {
      d: { topicId: topic.id, action: 'reject', interactionId: interaction.id },
    })

    const updated = await interactionRepo.getInteraction(interaction.id)
    expect(updated!.status).toBe('resolved')

    expect(mockPi.rpc).toHaveBeenCalledWith('resolveInteraction', expect.objectContaining({
      decision: 'reject',
    }))
  })

  it('resolves choice with the original adapter interaction id and raw choice', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Choice Topic', kind: 'normal', agentType: 'programming' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'sess-choice' })
    const rawChoice = 'Next.js (全栈) (前后端一体，React 页面 + API Routes，部署简单)'

    const interaction = await interactionRepo.createInteraction({
      id: 'toolu_choice_1',
      topicId: topic.id,
      kind: 'choice',
      prompt: '技术栈用哪套？',
      optionsJson: JSON.stringify([rawChoice]),
    })

    await actionHandler({}, {
      d: { topicId: topic.id, action: 'choose', interactionId: interaction.id, choice: rawChoice },
    })

    const updated = await interactionRepo.getInteraction(interaction.id)
    expect(updated!.status).toBe('resolved')
    expect(updated!.response_json).toBe(JSON.stringify({ decision: 'choose', choice: rawChoice }))

    expect(mockPi.rpc).toHaveBeenCalledWith('resolveInteraction', {
      sessionId: 'sess-choice',
      interactionId: 'toolu_choice_1',
      decision: 'choose',
      choice: rawChoice,
    })
  })

  it('no-ops for already resolved interaction', async () => {
    const actionCall = mockHub.on.mock.calls.find((c: string[]) => c[0] === 'client:user.action')
    const actionHandler = actionCall![1]

    const topic = await topicRepo.createTopic({ name: 'Resolved', kind: 'normal', agentType: 'general' })
    const interaction = await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Already done?',
    })
    await interactionRepo.updateInteraction(interaction.id, { status: 'resolved', resolved_at: Date.now() })

    await actionHandler({}, {
      d: { topicId: topic.id, action: 'approve', interactionId: interaction.id },
    })

    expect(mockPi.rpc).not.toHaveBeenCalled()
  })
})
