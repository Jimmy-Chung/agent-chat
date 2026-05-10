import type { WebSocket } from 'ws'
import type { ScenarioRunner } from './scenario-runner'
import { encodeFrame, createFrame } from '@agent-chat/protocol'
import pino from 'pino'

const log = pino({ name: 'cron-simulator' })

export interface CronEntry {
  cronId: string
  originSessionId: string
  cronExpr: string
  prompt: string
  status: 'active' | 'paused' | 'error'
  lastRunAt?: number
  nextRunAt?: number
  timer?: ReturnType<typeof setTimeout>
}

export interface CronSimulator {
  createCron(
    originSessionId: string,
    cronExpr: string,
    prompt: string,
  ): { cronId: string; nextRunAt: number }
  listCrons(): CronEntry[]
  pauseCron(cronId: string): boolean
  resumeCron(cronId: string): boolean
  deleteCron(cronId: string): boolean
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
      const frame = createFrame('event', {
        seq: newSeq,
        sessionId: entry.originSessionId,
        ts: Date.now(),
        payload: completedPayload,
      }, undefined, newSeq)
      ws.send(encodeFrame(frame))
      setSeq(entry.originSessionId, newSeq + 1)
    }

    entry.lastRunAt = Date.now()
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
