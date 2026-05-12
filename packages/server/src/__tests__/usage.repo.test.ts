import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as usageRepo from '../db/repos/usage.repo'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'

describe('UsageRepo', () => {
  let topicId: string
  let messageId: string

  beforeAll(async () => {
    setupTestDb()
    const topic = await topicRepo.createTopic({
      name: 'Usage Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
    const msg = await messageRepo.createMessage({
      topicId,
      role: 'user',
    })
    messageId = msg.id
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create a usage record', async () => {
    await usageRepo.createUsageRecord({
      topicId,
      messageId,
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 1500,
    })
  })

  it('should create a usage record without optional fields', async () => {
    await usageRepo.createUsageRecord({
      model: 'claude-3',
      inputTokens: 200,
      outputTokens: 100,
    })
  })

  it('should get usage by topic', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Usage By Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const msg = await messageRepo.createMessage({
      topicId: topic.id,
      role: 'user',
    })

    await usageRepo.createUsageRecord({
      topicId: topic.id,
      messageId: msg.id,
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 1000,
    })
    await usageRepo.createUsageRecord({
      topicId: topic.id,
      model: 'gpt-4',
      inputTokens: 200,
      outputTokens: 80,
      costMicroUsd: 2000,
    })

    const records = await usageRepo.getUsageByTopic(topic.id)
    expect(records.length).toBe(2)
    expect(records.every((r) => r.topic_id === topic.id)).toBe(true)
    expect(records[0].model).toBe('gpt-4')
    expect(records[0].input_tokens).toBe(100)
    expect(records[0].output_tokens).toBe(50)
    expect(records[0].cost_micro_usd).toBe(1000)
  })

  it('should filter usage by topic with from/to date range', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Usage Date Range',
      kind: 'normal',
      agentType: 'general',
    })

    await usageRepo.createUsageRecord({
      topicId: topic.id,
      model: 'gpt-4',
      inputTokens: 50,
      outputTokens: 25,
    })

    const recordsAll = await usageRepo.getUsageByTopic(topic.id)
    expect(recordsAll.length).toBe(1)

    const farFuture = Date.now() + 100000
    const recordsEmpty = await usageRepo.getUsageByTopic(topic.id, undefined, farFuture - 200000)
    expect(recordsEmpty.length).toBe(0)

    const recordsInRange = await usageRepo.getUsageByTopic(topic.id, 0, farFuture)
    expect(recordsInRange.length).toBe(1)
  })

  it('should get global usage', async () => {
    await usageRepo.createUsageRecord({
      model: 'claude-3',
      inputTokens: 300,
      outputTokens: 150,
    })

    const records = await usageRepo.getUsageGlobal()
    expect(records.length).toBeGreaterThanOrEqual(1)
  })
})
