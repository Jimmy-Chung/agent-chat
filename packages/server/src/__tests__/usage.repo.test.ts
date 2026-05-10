import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as usageRepo from '../db/repos/usage.repo'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import { setDb, resetDb } from '../db/migrate'

describe('UsageRepo', () => {
  let topicId: string
  let messageId: string

  beforeAll(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    const topic = topicRepo.createTopic({
      name: 'Usage Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
    const msg = messageRepo.createMessage({
      topicId,
      role: 'user',
    })
    messageId = msg.id
  })

  afterAll(() => {
    resetDb()
    teardownTestDb()
  })

  it('should create a usage record', () => {
    usageRepo.createUsageRecord({
      topicId,
      messageId,
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 1500,
    })
    // No return value, but should not throw
  })

  it('should create a usage record without optional fields', () => {
    usageRepo.createUsageRecord({
      model: 'claude-3',
      inputTokens: 200,
      outputTokens: 100,
    })
  })

  it('should get usage by topic', () => {
    const topic = topicRepo.createTopic({
      name: 'Usage By Topic',
      kind: 'normal',
      agentType: 'general',
    })
    const msg = messageRepo.createMessage({
      topicId: topic.id,
      role: 'user',
    })

    usageRepo.createUsageRecord({
      topicId: topic.id,
      messageId: msg.id,
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 1000,
    })
    usageRepo.createUsageRecord({
      topicId: topic.id,
      model: 'gpt-4',
      inputTokens: 200,
      outputTokens: 80,
      costMicroUsd: 2000,
    })

    const records = usageRepo.getUsageByTopic(topic.id)
    expect(records.length).toBe(2)
    expect(records.every((r) => r.topic_id === topic.id)).toBe(true)
    expect(records[0].model).toBe('gpt-4')
    expect(records[0].input_tokens).toBe(100)
    expect(records[0].output_tokens).toBe(50)
    expect(records[0].cost_micro_usd).toBe(1000)
  })

  it('should filter usage by topic with from/to date range', () => {
    const topic = topicRepo.createTopic({
      name: 'Usage Date Range',
      kind: 'normal',
      agentType: 'general',
    })

    usageRepo.createUsageRecord({
      topicId: topic.id,
      model: 'gpt-4',
      inputTokens: 50,
      outputTokens: 25,
    })

    const recordsAll = usageRepo.getUsageByTopic(topic.id)
    expect(recordsAll.length).toBe(1)

    // Filter with a range that excludes everything (future cutoff)
    const farFuture = Date.now() + 100000
    const recordsEmpty = usageRepo.getUsageByTopic(topic.id, undefined, farFuture - 200000)
    expect(recordsEmpty.length).toBe(0)

    // Filter with a range that includes everything
    const recordsInRange = usageRepo.getUsageByTopic(topic.id, 0, farFuture)
    expect(recordsInRange.length).toBe(1)
  })

  it('should get global usage', () => {
    usageRepo.createUsageRecord({
      model: 'claude-3',
      inputTokens: 300,
      outputTokens: 150,
    })

    const records = usageRepo.getUsageGlobal()
    expect(records.length).toBeGreaterThanOrEqual(1)
  })
})
