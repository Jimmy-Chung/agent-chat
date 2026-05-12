import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as topicRepo from '../db/repos/topic.repo'

describe('InteractionRepo', () => {
  let topicId: string

  beforeAll(async () => {
    setupTestDb()
    const topic = await topicRepo.createTopic({
      name: 'Interaction Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create an interaction', async () => {
    const interaction = await interactionRepo.createInteraction({
      topicId,
      kind: 'approval',
      prompt: 'Do you want to proceed?',
    })

    expect(interaction.id).toBeTruthy()
    expect(interaction.topic_id).toBe(topicId)
    expect(interaction.kind).toBe('approval')
    expect(interaction.prompt).toBe('Do you want to proceed?')
    expect(interaction.status).toBe('pending')
    expect(interaction.response_json).toBeNull()
    expect(interaction.resolved_at).toBeNull()
    expect(interaction.created_at).toBeGreaterThan(0)
  })

  it('should create an interaction with optionsJson and messageId', async () => {
    const interaction = await interactionRepo.createInteraction({
      topicId,
      messageId: 'msg-123',
      kind: 'choice',
      prompt: 'Pick an option',
      optionsJson: JSON.stringify(['a', 'b', 'c']),
    })

    expect(interaction.message_id).toBe('msg-123')
    expect(interaction.options_json).toBe(JSON.stringify(['a', 'b', 'c']))
  })

  it('should get an interaction by id', async () => {
    const created = await interactionRepo.createInteraction({
      topicId,
      kind: 'approval',
      prompt: 'Get test',
    })

    const found = await interactionRepo.getInteraction(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.prompt).toBe('Get test')
  })

  it('should return undefined for non-existent interaction', async () => {
    const found = await interactionRepo.getInteraction('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should update interaction status to resolved', async () => {
    const interaction = await interactionRepo.createInteraction({
      topicId,
      kind: 'approval',
      prompt: 'Approve this?',
    })
    expect(interaction.status).toBe('pending')

    const resolvedAt = Date.now()
    const updated = await interactionRepo.updateInteraction(interaction.id, {
      status: 'resolved',
      resolved_at: resolvedAt,
    })

    expect(updated).toBeDefined()
    expect(updated!.status).toBe('resolved')
    expect(updated!.resolved_at).toBe(resolvedAt)
  })

  it('should update interaction status to timeout with response', async () => {
    const interaction = await interactionRepo.createInteraction({
      topicId,
      kind: 'approval',
      prompt: 'Reject this?',
    })

    const updated = await interactionRepo.updateInteraction(interaction.id, {
      status: 'timeout',
      response_json: JSON.stringify({ reason: 'not needed' }),
      resolved_at: Date.now(),
    })

    expect(updated!.status).toBe('timeout')
    expect(updated!.response_json).toBe(JSON.stringify({ reason: 'not needed' }))
    expect(updated!.resolved_at).toBeGreaterThan(0)
  })

  it('should list pending interactions by topic', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Pending Interactions Topic',
      kind: 'normal',
      agentType: 'general',
    })

    await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Pending 1',
    })
    await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Pending 2',
    })
    const toResolve = await interactionRepo.createInteraction({
      topicId: topic.id,
      kind: 'approval',
      prompt: 'Will be resolved',
    })
    await interactionRepo.updateInteraction(toResolve.id, {
      status: 'resolved',
      resolved_at: Date.now(),
    })

    const pending = await interactionRepo.listPendingInteractions(topic.id)
    expect(pending.length).toBe(2)
    expect(pending.every((i) => i.status === 'pending')).toBe(true)
  })

  it('should not mix pending interactions across topics', async () => {
    const topicA = await topicRepo.createTopic({
      name: 'Topic A',
      kind: 'normal',
      agentType: 'general',
    })
    const topicB = await topicRepo.createTopic({
      name: 'Topic B',
      kind: 'normal',
      agentType: 'general',
    })

    await interactionRepo.createInteraction({
      topicId: topicA.id,
      kind: 'approval',
      prompt: 'For A',
    })
    await interactionRepo.createInteraction({
      topicId: topicB.id,
      kind: 'approval',
      prompt: 'For B',
    })

    const pendingA = await interactionRepo.listPendingInteractions(topicA.id)
    expect(pendingA.length).toBe(1)
    expect(pendingA[0].prompt).toBe('For A')
  })
})
