import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as cronRepo from '../db/repos/cron.repo'
import * as topicRepo from '../db/repos/topic.repo'
import { setDb, resetDb } from '../db/migrate'

describe('CronRepo', () => {
  let topicId: string

  beforeAll(() => {
    const { db, sqlite } = setupTestDb()
    setDb(db, sqlite)
    const topic = topicRepo.createTopic({
      name: 'Cron Test Topic',
      kind: 'normal',
      agentType: 'general',
    })
    topicId = topic.id
  })

  afterAll(() => {
    resetDb()
    teardownTestDb()
  })

  // ─── CronJob tests ────────────────────────────────────────────────
  it('should create a cron job', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-001',
      cronExpr: '0 * * * *',
      prompt: 'Run hourly task',
    })

    expect(job.id).toBeTruthy()
    expect(job.origin_topic_id).toBe(topicId)
    expect(job.pi_cron_id).toBe('pi-cron-001')
    expect(job.cron_expr).toBe('0 * * * *')
    expect(job.prompt).toBe('Run hourly task')
    expect(job.status).toBe('active')
    expect(job.created_at).toBeGreaterThan(0)
  })

  it('should create a cron job with custom status and nextRunAt', () => {
    const nextRun = Date.now() + 3600000
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-002',
      cronExpr: '0 0 * * *',
      prompt: 'Daily task',
      status: 'paused',
      nextRunAt: nextRun,
    })

    expect(job.status).toBe('paused')
    expect(job.next_run_at).toBe(nextRun)
  })

  it('should get a cron job by id', () => {
    const created = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-003',
      cronExpr: '*/5 * * * *',
      prompt: 'Every 5 min',
    })

    const found = cronRepo.getCronJob(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.prompt).toBe('Every 5 min')
  })

  it('should return undefined for non-existent cron job', () => {
    const found = cronRepo.getCronJob('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should update cron job status', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-004',
      cronExpr: '0 * * * *',
      prompt: 'Status test',
    })
    expect(job.status).toBe('active')

    const updated = cronRepo.updateCronJob(job.id, { status: 'paused' })
    expect(updated).toBeDefined()
    expect(updated!.status).toBe('paused')
  })

  it('should update cron job cron_expr and prompt', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-005',
      cronExpr: '0 * * * *',
      prompt: 'Original',
    })

    const updated = cronRepo.updateCronJob(job.id, {
      cron_expr: '0 0 * * *',
      prompt: 'Updated',
    })
    expect(updated!.cron_expr).toBe('0 0 * * *')
    expect(updated!.prompt).toBe('Updated')
  })

  it('should delete a cron job', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-006',
      cronExpr: '0 * * * *',
      prompt: 'Delete me',
    })

    const result = cronRepo.deleteCronJob(job.id)
    expect(result).toBe(true)

    const found = cronRepo.getCronJob(job.id)
    expect(found).toBeUndefined()
  })

  it('should return false when deleting non-existent cron job', () => {
    const result = cronRepo.deleteCronJob('nonexistent')
    expect(result).toBe(false)
  })

  it('should get cron job by piCronId', () => {
    const piCronId = 'pi-cron-007'
    cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId,
      cronExpr: '0 * * * *',
      prompt: 'Find by pi id',
    })

    const found = cronRepo.getCronJobByPiCronId(piCronId)
    expect(found).toBeDefined()
    expect(found!.pi_cron_id).toBe(piCronId)
  })

  // ─── CronRun tests ────────────────────────────────────────────────
  it('should create a cron run', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-001',
      cronExpr: '0 * * * *',
      prompt: 'Run test',
    })

    const run = cronRepo.createCronRun({ cronId: job.id })

    expect(run.id).toBeTruthy()
    expect(run.cron_id).toBe(job.id)
    expect(run.status).toBe('running')
    expect(run.triggered_at).toBeGreaterThan(0)
    expect(run.finished_at).toBeNull()
    expect(run.result_message_id).toBeNull()
  })

  it('should create a cron run with custom triggeredAt', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-002',
      cronExpr: '0 * * * *',
      prompt: 'Custom trigger',
    })

    const ts = 1700000000000
    const run = cronRepo.createCronRun({ cronId: job.id, triggeredAt: ts })
    expect(run.triggered_at).toBe(ts)
  })

  it('should update a cron run', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-003',
      cronExpr: '0 * * * *',
      prompt: 'Update run',
    })

    const run = cronRepo.createCronRun({ cronId: job.id })
    const finishedAt = Date.now()

    cronRepo.updateCronRun(run.id, {
      status: 'success',
      finished_at: finishedAt,
      result_message_id: 'msg-123',
    })

    const runs = cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].finished_at).toBe(finishedAt)
    expect(runs[0].result_message_id).toBe('msg-123')
  })

  it('should list cron runs by cron id', () => {
    const job = cronRepo.createCronJob({
      originTopicId: topicId,
      piCronId: 'pi-cron-run-004',
      cronExpr: '0 * * * *',
      prompt: 'List runs',
    })

    cronRepo.createCronRun({ cronId: job.id })
    cronRepo.createCronRun({ cronId: job.id })

    const runs = cronRepo.listCronRuns(job.id)
    expect(runs.length).toBe(2)
  })
})
