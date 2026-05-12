import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as topicRepo from '../db/repos/topic.repo'

describe('TopicRepo', () => {
  beforeAll(() => {
    setupTestDb()
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create a topic', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Test Topic',
      kind: 'normal',
      agentType: 'general',
    })

    expect(topic.id).toBeTruthy()
    expect(topic.name).toBe('Test Topic')
    expect(topic.kind).toBe('normal')
    expect(topic.agent_type).toBe('general')
    expect(topic.archived).toBe(false)
  })

  it('should get a topic by id', async () => {
    const created = await topicRepo.createTopic({
      name: 'Get Test',
      kind: 'normal',
      agentType: 'programming',
    })

    const found = await topicRepo.getTopic(created.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Get Test')
    expect(found!.agent_type).toBe('programming')
  })

  it('should list topics', async () => {
    await topicRepo.createTopic({ name: 'List 1', kind: 'normal', agentType: 'general' })
    await topicRepo.createTopic({ name: 'List 2', kind: 'normal', agentType: 'general' })

    const all = await topicRepo.listTopics()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('should update a topic', async () => {
    const created = await topicRepo.createTopic({
      name: 'Update Me',
      kind: 'normal',
      agentType: 'general',
    })

    const updated = await topicRepo.updateTopic(created.id, { name: 'Updated!' })
    expect(updated).toBeDefined()
    expect(updated!.name).toBe('Updated!')
  })

  it('should soft-delete a normal topic', async () => {
    const created = await topicRepo.createTopic({
      name: 'Delete Me',
      kind: 'normal',
      agentType: 'general',
    })

    const result = await topicRepo.deleteTopic(created.id)
    expect(result).toBe(true)

    const found = await topicRepo.getTopic(created.id)
    expect(found).toBeDefined()
    expect(found!.archived).toBe(true)
  })

  it('should refuse to delete system topics', async () => {
    const created = await topicRepo.createTopic({
      name: 'System',
      kind: 'system_cron_admin',
      agentType: 'general',
    })

    const result = await topicRepo.deleteTopic(created.id)
    expect(result).toBe(false)

    const found = await topicRepo.getTopic(created.id)
    expect(found).toBeDefined()
    expect(found!.archived).toBe(false)
  })

  it('should upsert system topics', async () => {
    const t1 = await topicRepo.upsertSystemTopic(
      'sys_test',
      'Test System',
      'system_artifact_pool',
    )
    expect(t1.name).toBe('Test System')

    const t2 = await topicRepo.upsertSystemTopic(
      'sys_test',
      'Test System Changed',
      'system_artifact_pool',
    )
    expect(t2.name).toBe('Test System')
  })
})
