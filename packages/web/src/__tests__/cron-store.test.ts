import { describe, it, expect, beforeEach } from 'vitest'
import { useCronStore } from '../stores/cron-store'
import type { CronJob, CronRun } from '../stores/cron-store'

function makeCron(overrides: Partial<CronJob> = {}): CronJob {
  return {
    cronId: 'c1',
    originTopicId: 't1',
    cronExpr: '0 9 * * *',
    prompt: 'Daily report',
    status: 'active',
    ...overrides,
  }
}

function makeRun(overrides: Partial<CronRun> = {}): CronRun {
  return {
    id: 'r1',
    cronId: 'c1',
    triggeredAt: Date.now(),
    firedAt: Date.now(),
    ...overrides,
  }
}

describe('CronStore', () => {
  beforeEach(() => {
    useCronStore.setState({ crons: [], runs: [] })
  })

  it('should have correct initial state', () => {
    const state = useCronStore.getState()
    expect(state.crons).toEqual([])
    expect(state.runs).toEqual([])
  })

  it('setCrons replaces all crons', () => {
    const crons = [makeCron({ cronId: 'c1' }), makeCron({ cronId: 'c2' })]
    useCronStore.getState().setCrons(crons)
    expect(useCronStore.getState().crons).toEqual(crons)
  })

  it('upsertCron adds new cron', () => {
    useCronStore.getState().upsertCron(makeCron({ cronId: 'c1' }))
    expect(useCronStore.getState().crons).toHaveLength(1)
  })

  it('upsertCron updates existing cron by cronId', () => {
    useCronStore
      .getState()
      .upsertCron(makeCron({ cronId: 'c1', status: 'active' }))
    useCronStore
      .getState()
      .upsertCron(makeCron({ cronId: 'c1', status: 'paused' }))
    const { crons } = useCronStore.getState()
    expect(crons).toHaveLength(1)
    expect(crons[0].status).toBe('paused')
  })

  it('removeCron removes by cronId', () => {
    useCronStore.getState().upsertCron(makeCron({ cronId: 'c1' }))
    useCronStore.getState().upsertCron(makeCron({ cronId: 'c2' }))
    useCronStore.getState().removeCron('c1')
    expect(useCronStore.getState().crons).toHaveLength(1)
    expect(useCronStore.getState().crons[0].cronId).toBe('c2')
  })

  it('removeCron is no-op for non-existent cronId', () => {
    useCronStore.getState().upsertCron(makeCron({ cronId: 'c1' }))
    useCronStore.getState().removeCron('nonexistent')
    expect(useCronStore.getState().crons).toHaveLength(1)
  })

  it('addRun appends a run', () => {
    useCronStore.getState().addRun(makeRun({ id: 'r1' }))
    useCronStore.getState().addRun(makeRun({ id: 'r2' }))
    expect(useCronStore.getState().runs).toHaveLength(2)
  })

  it('completeRun updates run status and fields', () => {
    useCronStore.getState().addRun(makeRun({ id: 'r1' }))
    useCronStore.getState().completeRun('r1', {
      status: 'success',
      summary: 'Completed',
      duration: 5000,
      completedAt: 1700000005000,
    })
    const run = useCronStore.getState().runs[0]
    expect(run.status).toBe('success')
    expect(run.summary).toBe('Completed')
    expect(run.duration).toBe(5000)
    expect(run.completedAt).toBe(1700000005000)
  })

  it('completeRun is no-op for non-existent runId', () => {
    useCronStore.getState().addRun(makeRun({ id: 'r1' }))
    useCronStore.getState().completeRun('nonexistent', {
      status: 'failed',
      summary: null,
      duration: null,
      completedAt: Date.now(),
    })
    const run = useCronStore.getState().runs[0]
    expect(run.status).toBeUndefined()
  })
})
