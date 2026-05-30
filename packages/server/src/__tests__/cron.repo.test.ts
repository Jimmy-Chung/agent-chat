import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'

describe('CronRepo', () => {
  let topicId: string

  beforeAll(async () => {
    await setupTestDb()
    const topic = await topicRepo.createTopic({
      name: 'Cron Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    teardownTestDb()
  })

  it('should create a cron job', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-001',
      cronExpr: '0 * * * *',
      prompt: 'Run hourly task',
      tags: ['ops', 'hourly'],
    })

    expect(job.id).toBeTruthy()
    expect(job.origin_topic_id).toBe(topicId)
    expect(job.pi_cron_id).toBe('pi-cron-001')
    expect(job.cron_expr).toBe('0 * * * *')
    expect(job.prompt).toBe('Run hourly task')
    expect(job.tags).toEqual(['ops', 'hourly'])
    expect(job.status).toBe('active')
    expect(job.created_at).toBeGreaterThan(0)
  })

  it('should create a cron job with custom status and nextRunAt', async () => {
    const nextRun = Date.now() + 3600000
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-002',
      cronExpr: '0 0 * * *',
      prompt: 'Daily task',
      tags: ['daily'],
      status: 'paused',
      nextRunAt: nextRun,
    })

    expect(job.status).toBe('paused')
    expect(job.next_run_at).toBe(nextRun)
    expect(job.tags).toEqual(['daily'])
  })

  it('should get a cron job by id', async () => {
    const created = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-003',
      cronExpr: '*/5 * * * *',
      prompt: 'Every 5 min',
    })

    const found = await cronRepo.getCronJob(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.prompt).toBe('Every 5 min')
  })

  it('should return undefined for non-existent cron job', async () => {
    const found = await cronRepo.getCronJob('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should update cron job status', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-004',
      cronExpr: '0 * * * *',
      prompt: 'Status test',
    })
    expect(job.status).toBe('active')

    const updated = await cronRepo.updateCronJob(job.id, { status: 'paused' })
    expect(updated).toBeDefined()
    expect(updated!.status).toBe('paused')
  })

  it('should update cron job cron_expr and prompt', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-005',
      cronExpr: '0 * * * *',
      prompt: 'Original',
    })

    const updated = await cronRepo.updateCronJob(job.id, {
      cron_expr: '0 0 * * *',
      prompt: 'Updated',
      tags: ['updated'],
    })
    expect(updated!.cron_expr).toBe('0 0 * * *')
    expect(updated!.prompt).toBe('Updated')
    expect(updated!.tags).toEqual(['updated'])
  })

  it('should delete a cron job', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-006',
      cronExpr: '0 * * * *',
      prompt: 'Delete me',
    })

    const result = await cronRepo.deleteCronJob(job.id)
    expect(result).toBe(true)

    const found = await cronRepo.getCronJob(job.id)
    expect(found).toBeUndefined()
  })

  it('keeps cron jobs when the origin topic is archived', async () => {
    const topic = await topicRepo.createTopic({
      name: 'Cron Origin Archive',
      kind: 'normal',
      agentType: 'general',
    })
    const job = await cronRepo.createCronJob({
      originTopicId: topic.id,
      piCronId: 'pi-cron-archive-origin',
      cronExpr: '0 * * * *',
      prompt: 'Survive topic archive',
    })

    await topicRepo.deleteTopic(topic.id)

    const found = await cronRepo.getCronJob(job.id)
    expect(found).toBeDefined()
    expect(found!.origin_topic_id).toBe(topic.id)
  })

  it('should return false when deleting non-existent cron job', async () => {
    const result = await cronRepo.deleteCronJob('nonexistent')
    expect(result).toBe(false)
  })

  it('should get cron job by piCronId', async () => {
    const piCronId = 'pi-cron-007'
    await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId,
      cronExpr: '0 * * * *',
      prompt: 'Find by pi id',
    })

    const found = await cronRepo.getCronJobByPiCronId(piCronId)
    expect(found).toBeDefined()
    expect(found!.pi_cron_id).toBe(piCronId)
  })

  it('should create a cron run', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-001',
      cronExpr: '0 * * * *',
      prompt: 'Run test',
    })

    const run = await cronRepo.createCronRun({ cronId: job.id })

    expect(run.id).toBeTruthy()
    expect(run.cron_id).toBe(job.id)
    expect(run.status).toBe('running')
    expect(run.triggered_at).toBeGreaterThan(0)
    expect(run.finished_at).toBeNull()
    expect(run.result_message_id).toBeNull()
  })

  it('should create a cron run with custom triggeredAt', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-002',
      cronExpr: '0 * * * *',
      prompt: 'Custom trigger',
    })

    const ts = 1700000000000
    const run = await cronRepo.createCronRun({ cronId: job.id, triggeredAt: ts })
    expect(run.triggered_at).toBe(ts)
  })

  it('should update a cron run', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-003',
      cronExpr: '0 * * * *',
      prompt: 'Update run',
    })

    const run = await cronRepo.createCronRun({ cronId: job.id })
    const finishedAt = Date.now()

    await cronRepo.updateCronRun(run.id, {
      status: 'success',
      finished_at: finishedAt,
      result_message_id: 'msg-123',
    })

    const runs = await cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].finished_at).toBe(finishedAt)
    expect(runs[0].result_message_id).toBe('msg-123')
  })

  it('should list cron runs by cron id', async () => {
    const job = await cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-004',
      cronExpr: '0 * * * *',
      prompt: 'List runs',
    })

    await cronRepo.createCronRun({ cronId: job.id })
    await cronRepo.createCronRun({ cronId: job.id })

    const runs = await cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(2)
  })
})
