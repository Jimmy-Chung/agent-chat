import type { CronRunDetail } from '@/stores/cron-store'

// AIT-264 — a run stuck in `running` past this threshold is treated as an
// orphan (the adapter process crashed mid-run; the record never transitions).
// We surface it as "interrupted" rather than pretending it is still running.
export const RUNNING_ORPHAN_MS = 30 * 60 * 1000 // 30 minutes

export type CronRunDisplayStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'interrupted'

/**
 * Map a stored run to its display status, applying orphan tolerance for runs
 * that have been `running` for an implausibly long time.
 */
export function cronRunDisplayStatus(
  run: Pick<CronRunDetail, 'status' | 'firedAt'>,
  now: number = Date.now(),
): CronRunDisplayStatus {
  if (run.status === 'success') return 'success'
  if (run.status === 'failed') return 'failed'
  if (now - run.firedAt > RUNNING_ORPHAN_MS) return 'interrupted'
  return 'running'
}

/**
 * Merge a freshly fetched page of runs into the existing accumulated list,
 * de-duplicating by `runId` (so re-fetching a page never produces duplicates)
 * and keeping newest-first order by `firedAt`.
 */
export function mergeCronRuns(
  existing: CronRunDetail[],
  incoming: CronRunDetail[],
): CronRunDetail[] {
  const byId = new Map(existing.map((r) => [r.runId, r]))
  for (const r of incoming) byId.set(r.runId, r)
  return [...byId.values()].sort((a, b) => b.firedAt - a.firedAt)
}
