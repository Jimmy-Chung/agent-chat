import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

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

interface CronState {
  crons: CronJob[]
  runs: CronRun[]
  setCrons: (crons: CronJob[]) => void
  upsertCron: (cron: CronJob) => void
  removeCron: (cronId: string) => void
  addRun: (run: CronRun) => void
  completeRun: (runId: string, data: { status: string; summary: string | null; duration: number | null; completedAt: number }) => void
}

export const useCronStore = create<CronState>()(
  immer((set) => ({
    crons: [],
    runs: [],

    setCrons: (crons) => {
      set((s) => {
        s.crons = crons
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
        s.runs.push(run)
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
        }
      })
    },
  })),
)

export type { CronJob, CronRun }
