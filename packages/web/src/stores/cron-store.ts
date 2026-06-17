import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { mergeCronRuns } from '@/lib/cron-runs'

interface CronJob {
  cronId: string
  localCronId?: string
  originTopicId: string | null
  originSessionId?: string
  runtime?: string
  providerGroup?: string
  cronExpr: string
  prompt: string
  timezone?: string
  tags?: string[]
  status: 'active' | 'paused' | 'error'
  lastRunAt?: number
  nextRunAt?: number
  createdAt?: number
  updatedAt?: number
}

interface CronRun {
  id: string
  cronId: string
  localCronId?: string
  triggeredAt: number
  firedAt: number
  status?: 'running' | 'success' | 'failed' | 'timeout'
  summary?: string | null
  duration?: number | null
  completedAt?: number
}

// AIT-264 — a single adapter-sourced run record for the history view.
interface CronRunDetail {
  runId: string
  cronId: string
  firedAt: number
  completedAt?: number
  status: 'running' | 'success' | 'failed'
  durationMs?: number | null
  error?: string | null
  providerGroup?: string
}

// Accumulated, paginated run history per cron.
interface CronRunHistory {
  runs: CronRunDetail[]
  nextCursor?: string
}

interface CronState {
  crons: CronJob[]
  runs: CronRun[]
  runHistory: Record<string, CronRunHistory>
  setCrons: (crons: CronJob[]) => void
  setRuns: (runs: CronRun[]) => void
  upsertCron: (cron: CronJob) => void
  removeCron: (cronId: string) => void
  addRun: (run: CronRun) => void
  completeRun: (runId: string, data: { cronId: string; localCronId?: string; triggeredAt?: number; firedAt?: number; status: string; summary: string | null; duration: number | null; completedAt: number }) => void
  mergeRunHistory: (cronId: string, runs: CronRunDetail[], nextCursor?: string) => void
}

export const useCronStore = create<CronState>()(
  immer((set) => ({
    crons: [],
    runs: [],
    runHistory: {},

    setCrons: (crons) => {
      set((s) => {
        s.crons = crons
      })
    },

    setRuns: (runs) => {
      set((s) => {
        s.runs = runs
      })
    },

    upsertCron: (cron) => {
      set((s) => {
        const idx = s.crons.findIndex((c) => c.cronId === cron.cronId)
        if (idx >= 0) {
          s.crons[idx] = cron
        } else {
          s.crons.push(cron)
        }
      })
    },

    removeCron: (cronId) => {
      set((s) => {
        s.crons = s.crons.filter((c) => c.cronId !== cronId)
      })
    },

    addRun: (run) => {
      set((s) => {
        const idx = s.runs.findIndex((r) => r.id === run.id)
        if (idx >= 0) {
          s.runs[idx] = { ...s.runs[idx], ...run }
        } else {
          s.runs.push(run)
        }
      })
    },

    completeRun: (runId, data) => {
      set((s) => {
        const run = s.runs.find((r) => r.id === runId)
        if (run) {
          run.status = data.status as CronRun['status']
          run.summary = data.summary
          run.duration = data.duration
          run.completedAt = data.completedAt
        } else {
          s.runs.push({
            id: runId,
            cronId: data.cronId,
            localCronId: data.localCronId,
            triggeredAt: data.triggeredAt ?? data.firedAt ?? data.completedAt,
            firedAt: data.firedAt ?? data.triggeredAt ?? data.completedAt,
            status: data.status as CronRun['status'],
            summary: data.summary,
            duration: data.duration,
            completedAt: data.completedAt,
          })
        }
      })
    },

    mergeRunHistory: (cronId, runs, nextCursor) => {
      set((s) => {
        const existing = s.runHistory[cronId]?.runs ?? []
        s.runHistory[cronId] = {
          runs: mergeCronRuns(existing, runs),
          nextCursor,
        }
      })
    },
  })),
)

export type { CronJob, CronRun, CronRunDetail, CronRunHistory }
