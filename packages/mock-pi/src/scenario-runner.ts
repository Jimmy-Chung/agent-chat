import type { PIEvent, PIPayload } from '@agent-chat/protocol'
import type { WebSocket } from 'ws'
import { encodeFrame, createFrame } from '@agent-chat/protocol'

type FixtureEntry = { payload: PIPayload }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixtures: Record<string, FixtureEntry[]> = {} as any

async function loadFixture(name: string): Promise<FixtureEntry[]> {
  if (fixtures[name]) return fixtures[name]
  const mod = await import(`./fixtures/${name}.json`)
  fixtures[name] = mod.default as FixtureEntry[]
  return fixtures[name]
}

function injectDynamicIds(entries: FixtureEntry[]): FixtureEntry[] {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const msgId = `msg-art-${suffix}`
  const tu1 = `tu-art1-${suffix}`
  const tu2 = `tu-art2-${suffix}`
  const art1 = `art-csv-${suffix}`
  const art2 = `art-png-${suffix}`
  const json = JSON.stringify(entries)
    .replace(/\{\{MSG_ID\}\}/g, msgId)
    .replace(/\{\{TU1_ID\}\}/g, tu1)
    .replace(/\{\{TU2_ID\}\}/g, tu2)
    .replace(/\{\{ART1_ID\}\}/g, art1)
    .replace(/\{\{ART2_ID\}\}/g, art2)
  return JSON.parse(json)
}

export type ScenarioRunner = {
  run(
    sessionId: string,
    ws: WebSocket,
    content: string,
    seqStart: number,
    onEvent?: (payload: PIPayload) => void,
  ): Promise<number>
  runCron(
    sessionId: string,
    ws: WebSocket,
    cronId: string,
    runId: string,
    seqStart: number,
  ): Promise<number>
}

export function createScenarioRunner(): ScenarioRunner {
  function matchFixture(content: string): string {
    const lower = content.toLowerCase()
    if (/\b(hi|hello|你好)\b/.test(lower)) return 'simple-text'
    if (/\b(list|glob|文件)\b/.test(lower)) return 'tool-use'
    if (/\b(edit|modify|修改)\b/.test(lower)) return 'file-edit'
    if (/\b(approval|权限|允许)\b/.test(lower)) return 'approval'
    if (/\b(cron|定时|schedule)\b/.test(lower)) return 'cron-trigger'
    if (/(artifact|生成|报告|report|generate|产物)/.test(lower)) return 'artifact-gen'
    return 'simple-text'
  }

  function delay(): Promise<void> {
    const ms = 50 + Math.random() * 150
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function isInteractionRequest(payload: PIPayload): boolean {
    return payload.kind === 'interaction.request'
  }

  async function run(
    sessionId: string,
    ws: WebSocket,
    content: string,
    seqStart: number,
    onEvent?: (payload: PIPayload) => void,
  ): Promise<number> {
    const fixtureName = matchFixture(content)
    const rawEntries = await loadFixture(fixtureName)
    const entries = fixtureName === 'artifact-gen' ? injectDynamicIds(rawEntries) : rawEntries
    let seq = seqStart

    for (const entry of entries) {
      const event: PIEvent = {
        seq,
        sessionId,
        ts: Date.now(),
        payload: entry.payload,
      }

      const frame = createFrame('event', event, undefined, seq)
      ws.send(encodeFrame(frame))
      onEvent?.(entry.payload)
      seq++

      // Pause at interaction.request — caller handles resolution
      if (isInteractionRequest(entry.payload)) break

      await delay()
    }

    return seq
  }

  async function runCron(
    sessionId: string,
    ws: WebSocket,
    cronId: string,
    runId: string,
    seqStart: number,
  ): Promise<number> {
    const entries = await loadFixture('cron-trigger')
    let seq = seqStart

    // First emit cron.triggered
    const triggeredEvent: PIEvent = {
      seq,
      sessionId,
      ts: Date.now(),
      payload: {
        kind: 'cron.triggered',
        cronId,
        originSessionId: sessionId,
        runId,
        firedAt: Date.now(),
      },
    }
    const triggeredFrame = createFrame('event', triggeredEvent, undefined, seq)
    ws.send(encodeFrame(triggeredFrame))
    seq++
    await delay()

    for (const entry of entries) {
      const event: PIEvent = {
        seq,
        sessionId,
        ts: Date.now(),
        payload: entry.payload,
      }
      const frame = createFrame('event', event, undefined, seq)
      ws.send(encodeFrame(frame))
      seq++
      await delay()
    }

    return seq
  }

  return { run, runCron }
}
