import { createFrame, encodeFrame } from '@agent-chat/protocol'
import pino from 'pino'
import type { WebSocket } from 'ws'
import type { ScenarioRunner } from './scenario-runner'

const log = pino({ name: 'cron-simulator' })

export interface CronEntry {
  cronId: string
  originSessionId: string
  cronExpr: string
  prompt: string
  tags?: string[]
  status: 'active' | 'paused' | 'error'
  lastRunAt?: number
  nextRunAt?: number
  timer?: ReturnType<typeof setTimeout>
}

export interface CronRunRecord {
  runId: string
  cronId: string
  originSessionId: string
  firedAt: number
  completedAt?: number
  status: 'running' | 'completed' | 'failed'
  success?: boolean
  durationMs?: number
  error?: string
}

// A cron expression must have 5 or 6 space-separated fields.
function isValidCronExpr(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  return fields.length === 5 || fields.length === 6
}

export interface CronSimulator {
  createCron(
    originSessionId: string,
    cronExpr: string,
    prompt: string,
  ): { cronId: string; nextRunAt: number }
  listCrons(): CronEntry[]
  listCronRuns(params: { cronId?: string; limit?: number; cursor?: string }): {
    runs: CronRunRecord[]
    nextCursor?: string
  }
  updateCron(
    cronId: string,
    patch: {
      cronExpr?: string
      prompt?: string
      tags?: string[]
      status?: CronEntry['status']
    },
  ): CronEntry
  pauseCron(cronId: string): boolean
  resumeCron(cronId: string): boolean
  deleteCron(cronId: string): boolean
  // Test affordance: seed run history deterministically without needing a live
  // session/timer (used by e2e for AIT-264).
  seedRuns(cronId: string, runs: Array<Partial<CronRunRecord>>): void
  getRunner(): ScenarioRunner
  setSessionWs(sessionId: string, ws: WebSocket | null): void
  getSessionSeq(sessionId: string): number
  setSessionSeq(sessionId: string, seq: number): void
  _simulateCronFire(cronId: string): Promise<void>
  stopAll(): void
}

export function createCronSimulator(
  runner: ScenarioRunner,
  getWs: (sessionId: string) => WebSocket | null,
  getSeq: (sessionId: string) => number,
  setSeq: (sessionId: string, seq: number) => void,
): CronSimulator {
  const crons = new Map<string, CronEntry>()
  const runRecords: CronRunRecord[] = []
  let idCounter = 0

  function scheduleNext(entry: CronEntry) {
    if (entry.timer) clearTimeout(entry.timer)
    // Simplified: 5s interval for testing
    entry.nextRunAt = Date.now() + 5000
    entry.timer = setTimeout(() => {
      fireCron(entry.cronId).catch((err) => {
        log.error({ cronId: entry.cronId, err }, 'cron fire failed')
      })
    }, 5000)
  }

  async function fireCron(cronId: string): Promise<void> {
    const entry = crons.get(cronId)
    if (!entry || entry.status !== 'active') return

    const ws = getWs(entry.originSessionId)
    if (!ws || ws.readyState !== 1) {
      log.warn({ cronId }, 'no active WS for cron session')
      return
    }

    const seq = getSeq(entry.originSessionId)
    const runId = `run-${Date.now()}`
    const startTime = Date.now()
    const newSeq = await runner.runCron(
      entry.originSessionId,
      ws,
      cronId,
      runId,
      seq,
    )
    setSeq(entry.originSessionId, newSeq)

    // Emit cron.run.completed
    const completedPayload = {
      kind: 'cron.run.completed' as const,
      cronId,
      runId,
      status: 'success' as const,
      summary: `Cron job completed: ${entry.prompt}`,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    }
    if (ws.readyState === 1) {
      const frame = createFrame(
        'event',
        {
          seq: newSeq,
          sessionId: entry.originSessionId,
          ts: Date.now(),
          payload: completedPayload,
        },
        undefined,
        newSeq,
      )
      ws.send(encodeFrame(frame))
      setSeq(entry.originSessionId, newSeq + 1)
    }

    entry.lastRunAt = Date.now()
    runRecords.push({
      runId,
      cronId,
      originSessionId: entry.originSessionId,
      firedAt: startTime,
      completedAt: Date.now(),
      status: 'completed',
      success: true,
      durationMs: Date.now() - startTime,
    })
    scheduleNext(entry)
  }

  function createCron(
    originSessionId: string,
    cronExpr: string,
    prompt: string,
  ): { cronId: string; nextRunAt: number } {
    const cronId = `cron-${++idCounter}`
    const entry: CronEntry = {
      cronId,
      originSessionId,
      cronExpr,
      prompt,
      status: 'active',
    }
    crons.set(cronId, entry)
    scheduleNext(entry)
    return { cronId, nextRunAt: entry.nextRunAt! }
  }

  function listCrons(): CronEntry[] {
    return Array.from(crons.values()).map((e) => ({
      cronId: e.cronId,
      originSessionId: e.originSessionId,
      cronExpr: e.cronExpr,
      prompt: e.prompt,
      status: e.status,
      lastRunAt: e.lastRunAt,
      nextRunAt: e.nextRunAt,
    }))
  }

  function listCronRuns(params: {
    cronId?: string
    limit?: number
    cursor?: string
  }): {
    runs: CronRunRecord[]
    nextCursor?: string
  } {
    let list = runRecords.slice().sort((a, b) => b.firedAt - a.firedAt)
    if (params.cronId) list = list.filter((r) => r.cronId === params.cronId)
    const limit = Math.min(params.limit ?? 50, 200)
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0
    const page = list.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    return {
      runs: page,
      ...(nextOffset < list.length ? { nextCursor: String(nextOffset) } : {}),
    }
  }

  function updateCron(
    cronId: string,
    patch: {
      cronExpr?: string
      prompt?: string
      tags?: string[]
      status?: CronEntry['status']
    },
  ): CronEntry {
    const entry = crons.get(cronId)
    if (!entry) {
      throw Object.assign(new Error('cron not found'), { code: 'cron_invalid' })
    }
    if (patch.cronExpr !== undefined && !isValidCronExpr(patch.cronExpr)) {
      throw Object.assign(new Error('invalid cron expression'), {
        code: 'cron_invalid',
      })
    }
    if (patch.cronExpr !== undefined) entry.cronExpr = patch.cronExpr
    if (patch.prompt !== undefined) entry.prompt = patch.prompt
    if (patch.tags !== undefined) entry.tags = patch.tags
    if (patch.status !== undefined) entry.status = patch.status
    // Any update resets the timer and recomputes nextRunAt.
    if (entry.status === 'active') scheduleNext(entry)
    return { ...entry, timer: undefined }
  }

  function seedRuns(cronId: string, runs: Array<Partial<CronRunRecord>>): void {
    runs.forEach((r, i) => {
      runRecords.push({
        runId: r.runId ?? `seed-${cronId}-${i}`,
        cronId,
        originSessionId: r.originSessionId ?? 'seed-session',
        firedAt: r.firedAt ?? Date.now() - i * 1000,
        completedAt: r.completedAt,
        status: r.status ?? 'completed',
        success: r.success,
        durationMs: r.durationMs,
        error: r.error,
      })
    })
  }

  function pauseCron(cronId: string): boolean {
    const entry = crons.get(cronId)
    if (!entry) return false
    entry.status = 'paused'
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    return true
  }

  function resumeCron(cronId: string): boolean {
    const entry = crons.get(cronId)
    if (!entry) return false
    entry.status = 'active'
    scheduleNext(entry)
    return true
  }

  function deleteCron(cronId: string): boolean {
    const entry = crons.get(cronId)
    if (!entry) return false
    if (entry.timer) clearTimeout(entry.timer)
    crons.delete(cronId)
    return true
  }

  function stopAll() {
    for (const entry of crons.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    crons.clear()
  }

  return {
    createCron,
    listCrons,
    listCronRuns,
    updateCron,
    seedRuns,
    pauseCron,
    resumeCron,
    deleteCron,
    getRunner: () => runner,
    setSessionWs: () => {},
    getSessionSeq: () => 0,
    setSessionSeq: () => {},
    _simulateCronFire: fireCron,
    stopAll,
  }
}
