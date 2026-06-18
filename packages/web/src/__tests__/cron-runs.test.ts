import { describe, expect, it } from 'vitest'
import { buildCronEditPayload } from '../lib/cron-edit'
import {
  RUNNING_ORPHAN_MS,
  cronRunDisplayStatus,
  mergeCronRuns,
} from '../lib/cron-runs'
import type { CronRunDetail } from '../stores/cron-store'

function makeRun(overrides: Partial<CronRunDetail> = {}): CronRunDetail {
  return {
    runId: 'run-1',
    cronId: 'c1',
    firedAt: 1_000,
    status: 'success',
    ...overrides,
  }
}

describe('cronRunDisplayStatus (AIT-264 TC-04)', () => {
  const now = 10 * RUNNING_ORPHAN_MS

  it('passes through finished statuses', () => {
    expect(cronRunDisplayStatus({ status: 'success', firedAt: now }, now)).toBe(
      'success',
    )
    expect(cronRunDisplayStatus({ status: 'failed', firedAt: now }, now)).toBe(
      'failed',
    )
  })

  it('keeps a fresh running run as running', () => {
    expect(
      cronRunDisplayStatus({ status: 'running', firedAt: now - 1000 }, now),
    ).toBe('running')
  })

  it('marks a long-running orphan as interrupted, not running', () => {
    const firedAt = now - (RUNNING_ORPHAN_MS + 1)
    expect(cronRunDisplayStatus({ status: 'running', firedAt }, now)).toBe(
      'interrupted',
    )
  })
})

describe('mergeCronRuns (AIT-264 TC-02 / TC-03)', () => {
  it('appends a next page without duplicates, newest first', () => {
    const page1 = [
      makeRun({ runId: 'a', firedAt: 300 }),
      makeRun({ runId: 'b', firedAt: 200 }),
    ]
    const page2 = [makeRun({ runId: 'c', firedAt: 100 })]
    const merged = mergeCronRuns(page1, page2)
    expect(merged.map((r) => r.runId)).toEqual(['a', 'b', 'c'])
  })

  it('de-duplicates by runId when a page overlaps, taking the newer record', () => {
    const existing = [makeRun({ runId: 'a', firedAt: 300, status: 'running' })]
    const incoming = [makeRun({ runId: 'a', firedAt: 300, status: 'success' })]
    const merged = mergeCronRuns(existing, incoming)
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('success')
  })

  it('preserves error and durationMs on failed records', () => {
    const merged = mergeCronRuns(
      [],
      [
        makeRun({
          runId: 'x',
          status: 'failed',
          error: 'boom',
          durationMs: 1234,
        }),
      ],
    )
    expect(merged[0].error).toBe('boom')
    expect(merged[0].durationMs).toBe(1234)
  })
})

describe('buildCronEditPayload (AIT-263 TC-02)', () => {
  const cron = {
    cronId: 'c1',
    prompt: 'old',
    cronExpr: '0 9 * * *',
    tags: ['a'],
  }

  it('sends only the changed prompt, leaving expr/tags out', () => {
    const payload = buildCronEditPayload(cron, {
      prompt: 'new',
      cronExpr: '0 9 * * *',
      tagsText: 'a',
    })
    expect(payload).toEqual({ cronId: 'c1', prompt: 'new' })
  })

  it('returns null when nothing changed', () => {
    expect(
      buildCronEditPayload(cron, {
        prompt: 'old',
        cronExpr: '0 9 * * *',
        tagsText: 'a',
      }),
    ).toBeNull()
  })

  it('parses comma-separated tags only when they differ', () => {
    const payload = buildCronEditPayload(cron, {
      prompt: 'old',
      cronExpr: '0 9 * * *',
      tagsText: 'a, b',
    })
    expect(payload).toEqual({ cronId: 'c1', tags: ['a', 'b'] })
  })
})
