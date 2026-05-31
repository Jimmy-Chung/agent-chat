#!/usr/bin/env -S npx tsx
//
// Link Stress Test — 通过本地 wrangler server 中转的端到端链路压力测试
//
// 用法: pnpm -F server test:link-stress [-- --scenarios 3] [-- --seed 42]

import WebSocket from 'ws'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encodeFrame, decodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'
import { pickRandomScenarios } from './link-stress/scenarios.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}
function parseEnvInt(key: string, fallback: number): number {
  const v = process.env[key]; if (v == null || v === '') return fallback
  const n = parseInt(v, 10); return Number.isNaN(n) ? fallback : n
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const TURN_TIMEOUT_MS = parseEnvInt('TURN_TIMEOUT_MS', 120_000)
const SCENARIO_TIMEOUT_MS = parseEnvInt('SCENARIO_TIMEOUT_MS', 600_000)
const CONNECT_TIMEOUT_MS = parseEnvInt('CONNECT_TIMEOUT_MS', 10_000)
const SERVER_WS = process.env.SERVER_WS_URL || 'ws://127.0.0.1:8787/ws'
const AUTH_TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
// Optional: route the server at an explicit PI adapter (else server uses its default).
const PI_WSS = process.env.PI_ADAPTER_URL || ''
const PI_TOKEN = process.env.PI_ADAPTER_TOKEN || ''

function buildServerWsUrl(): string {
  const url = new URL(SERVER_WS)
  url.searchParams.set('token', AUTH_TOKEN)
  if (PI_WSS) url.searchParams.set('piWssUrl', PI_WSS)
  if (PI_TOKEN) url.searchParams.set('piToken', PI_TOKEN)
  return url.toString()
}

// ─── Types ───────────────────────────────────────────────────────────

interface TurnResult {
  turn: number; prompt: string
  status: 'ok' | 'timeout' | 'error' | 'ws_close'
  durationMs: number; messageId?: string; stopReason?: string; errorMessage?: string
  eventCount: number; toolCallCount: number
}
interface ScenarioResult {
  scenarioId: string; scenarioTitle: string; turns: TurnResult[]
  wsDisconnects: number; phase?: string; totalDurationMs: number
}

// ─── Frame-based communication ───────────────────────────────────────

function ssend(ws: WebSocket, t: string, d: unknown, id?: string): void {
  ws.send(encodeFrame(createFrame(t, d, id)))
}

// ─── Scenario runner ─────────────────────────────────────────────────

async function runScenario(scenario: { id: string; title: string; prompts: string[] }, si: number): Promise<ScenarioResult> {
  const turns: TurnResult[] = []
  let wsDisconnects = 0; let phase = 'connect'
  const scenarioStart = Date.now()
  const wsUrl = buildServerWsUrl()

  console.log(`\n━━━ ${scenario.title} (${scenario.id}) ━━━`)

  // ── Connect ────────────────────────────────────────────────────
  const ws = new WebSocket(wsUrl)
  let topicId: string | null = null
  let wsClosed = false; let wsCloseCode = 0; let wsCloseReason = ''
  ws.on('close', (c, r) => { wsClosed = true; wsCloseCode = c; wsCloseReason = r.toString(); wsDisconnects++ })

  const ce = await new Promise<Error | null>(r => {
    ws.on('open', () => r(null)); ws.on('error', (e: Error) => r(e))
    setTimeout(() => r(new Error('connect timeout')), CONNECT_TIMEOUT_MS)
  })
  if (ce) {
    console.error(`  ❌ Connect: ${fmtErr(ce)}`)
    for (let i = 0; i < scenario.prompts.length; i++)
      turns.push({ turn: i+1, prompt: scenario.prompts[i]!, status: 'error', durationMs: 0, errorMessage: fmtErr(ce), eventCount: 0, toolCallCount: 0 })
    return { scenarioId: scenario.id, scenarioTitle: scenario.title, turns, wsDisconnects, phase, totalDurationMs: Date.now() - scenarioStart }
  }

  // ── Create topic ───────────────────────────────────────────────
  phase = 'topic.create'
  const topicName = `stress-${scenario.id}-${Date.now()}`

  const ready = await new Promise<{ ok: boolean; id?: string; err?: string }>(resolve => {
    const t = setTimeout(() => resolve({ ok: false, err: 'timeout' }), 30_000)
    ws.on('message', function onMsg(data: WebSocket.Data) {
      const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : new TextDecoder().decode(data as ArrayBuffer)
      let f: { t?: string; d?: unknown }
      try { f = JSON.parse(raw) as { t?: string; d?: unknown } }
      catch { return }
      const d = f.d as Record<string, unknown> | undefined
      if (f.t === 'topic.created') { topicId = (d?.id ?? d?.topic_id ?? d?.topicId ?? null) as string | null }
      if (f.t === 'session.status' && d?.ready && topicId) { clearTimeout(t); ws.removeListener('message', onMsg); resolve({ ok: true, id: topicId! }) }
      if (f.t === 'error') { clearTimeout(t); ws.removeListener('message', onMsg); resolve({ ok: false, err: (d?.message as string) ?? 'Unknown error' }) }
    })
    ssend(ws, 'topic.create', {
      name: topicName, agentType: 'programming',
      programming: { extension: 'claude-code', yolo: true, cwd: `/tmp/stress-${scenario.id}-${Date.now()}`, permissionMode: 'bypassPermissions' },
    })
  })

  if (!ready.ok) {
    console.error(`  ❌ Topic: ${ready.err}`)
    for (let i = 0; i < scenario.prompts.length; i++)
      turns.push({ turn: i+1, prompt: scenario.prompts[i]!, status: 'error', durationMs: 0, errorMessage: `Topic: ${ready.err}`, eventCount: 0, toolCallCount: 0 })
    ws.close(); return { scenarioId: scenario.id, scenarioTitle: scenario.title, turns, wsDisconnects, phase, totalDurationMs: Date.now() - scenarioStart }
  }
  topicId = ready.id!
  console.log(`  ✓ Topic: ${topicId}`)
  phase = 'turns'

  // ── Per-turn tracking state ────────────────────────────────────
  let pendingResolve: ((r: { sr: string; ec: number; tc: number; err?: string }) => void) | null = null
  let pendingMsgId: string | null = null
  let eventCount = 0; let toolCallCount = 0
  let turnTimer: ReturnType<typeof setTimeout> | null = null

  ws.on('message', (data: WebSocket.Data) => {
    let f: WSFrame
    try { f = decodeFrame(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : new TextDecoder().decode(data as ArrayBuffer)) }
    catch { return }
    if (pendingMsgId) eventCount++

    const d = f.d as Record<string, unknown> | undefined
    switch (f.t) {
      case 'message.end': {
        if (d?.messageId === pendingMsgId && pendingResolve) {
          if (turnTimer) { clearTimeout(turnTimer); turnTimer = null }
          pendingResolve({ sr: (d.stopReason as string) ?? 'end_turn', ec: eventCount, tc: toolCallCount })
          pendingResolve = null; pendingMsgId = null
        }
        break
      }
      case 'tool.call': if (pendingMsgId) toolCallCount++; break
      case 'interaction.request': {
        const iid = d?.interactionId as string | undefined
        const ik = d?.interactionKind as string | undefined
        if (topicId && iid) ssend(ws, 'user.action', { topicId, interactionId: iid, decision: ik === 'choice' ? 'choose' : 'approve' })
        break
      }
      case 'error': if (pendingResolve) { if (turnTimer) { clearTimeout(turnTimer); turnTimer = null } pendingResolve({ sr: 'error', ec: eventCount, tc: toolCallCount, err: (d?.message as string) ?? 'server error' }); pendingResolve = null; pendingMsgId = null }; break
      case 'session.health': if (d?.state === 'disconnected' && pendingResolve) { if (turnTimer) { clearTimeout(turnTimer); turnTimer = null } pendingResolve({ sr: 'error', ec: eventCount, tc: toolCallCount, err: 'PI disconnected' }); pendingResolve = null; pendingMsgId = null }; break
    }
  })

  // ── Run turns ──────────────────────────────────────────────────
  const MSG_START_TIMEOUT_MS = 120_000 // adapter serialises turns; if previous turn is still running this may take a while
  for (let i = 0; i < scenario.prompts.length; i++) {
    const prompt = scenario.prompts[i]!; const tn = i + 1; const t0 = Date.now()
    if (wsClosed) { turns.push({ turn: tn, prompt, status: 'ws_close', durationMs: 0, errorMessage: `WS closed (${wsCloseCode})`, eventCount: 0, toolCallCount: 0 }); continue }

    process.stdout.write(`  [${tn}/${scenario.prompts.length}] ${prompt.slice(0, 60)}... `)
    try {
      const cmid = `stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ssend(ws, 'user.message', { topicId: topicId!, content: prompt, clientMessageId: cmid })

      // Wait for assistant message.id
      const msgId = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('No msg.start')), MSG_START_TIMEOUT_MS)
        function onS(data: WebSocket.Data) {
          let f: WSFrame
          try { f = decodeFrame(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : new TextDecoder().decode(data as ArrayBuffer)) } catch { return }
          if (f.t === 'message.start' && (f.d as { role?: string })?.role === 'assistant') { clearTimeout(t); ws.removeListener('message', onS); resolve((f.d as { messageId: string }).messageId) }
          if (f.t === 'error') { clearTimeout(t); ws.removeListener('message', onS); reject(new Error((f.d as { message?: string }).message ?? '?')) }
        }
        ws.on('message', onS)
      })

      pendingMsgId = msgId; eventCount = 0; toolCallCount = 0
      if (turnTimer) { clearTimeout(turnTimer); turnTimer = null }
      const result = await new Promise<{ sr: string; ec: number; tc: number; err?: string }>(resolve => {
        pendingResolve = resolve
        turnTimer = setTimeout(() => { if (pendingResolve) { pendingResolve({ sr: 'timeout', ec: eventCount, tc: toolCallCount }); pendingResolve = null; pendingMsgId = null; turnTimer = null } }, TURN_TIMEOUT_MS)
      })

      const dur = Date.now() - t0
      const status: TurnResult['status'] = result.sr === 'error' ? 'error' : result.sr === 'timeout' ? 'timeout' : 'ok'
      turns.push({ turn: tn, prompt, status, durationMs: dur, messageId: msgId, stopReason: result.sr, errorMessage: result.err, eventCount: result.ec, toolCallCount: result.tc })
      console.log(`${status === 'ok' ? '✓' : '✗'} ${(dur/1000).toFixed(1)}s stop=${result.sr} ev=${result.ec} tools=${result.tc}${result.err ? ' '+result.err : ''}`)
      // Small inter-turn delay to let adapter settle after message.end
      if (status === 'ok') await new Promise(r => setTimeout(r, 3000))
      // After a failed turn the session is in an unknown state — stop sending more prompts
      if (status !== 'ok') {
        for (let j = i + 1; j < scenario.prompts.length; j++)
          turns.push({ turn: j+1, prompt: scenario.prompts[j]!, status: 'error', durationMs: 0, errorMessage: 'Skipped (previous turn failed)', eventCount: 0, toolCallCount: 0 })
        break
      }
    } catch (err) {
      turns.push({ turn: tn, prompt, status: 'error', durationMs: Date.now()-t0, errorMessage: fmtErr(err), eventCount: 0, toolCallCount: 0 })
      console.log(`✗ ${fmtErr(err).slice(0, 80)}`)
      for (let j = i + 1; j < scenario.prompts.length; j++)
        turns.push({ turn: j+1, prompt: scenario.prompts[j]!, status: 'error', durationMs: 0, errorMessage: 'Skipped (previous turn failed)', eventCount: 0, toolCallCount: 0 })
      break
    }
  }

  // Cleanup
  if (topicId && !wsClosed) ssend(ws, 'topic.delete', { id: topicId, artifactStrategy: 'delete' })
  await new Promise(r => setTimeout(r, 300)); ws.close()
  return { scenarioId: scenario.id, scenarioTitle: scenario.title, turns, wsDisconnects, phase, totalDurationMs: Date.now() - scenarioStart }
}

// ─── Report ──────────────────────────────────────────────────────────

function report(results: ScenarioResult[], seed: number): void {
  console.log('\n═══════════════════════════════════════════════════════')
  let total = 0, ok = 0, to = 0, err = 0, wsc = 0, tDur = 0, tEv = 0, tTl = 0
  for (const r of results) {
    const _ok = r.turns.filter(t => t.status === 'ok').length, _to = r.turns.filter(t => t.status === 'timeout').length
    const _err = r.turns.filter(t => t.status === 'error').length, _wsc = r.turns.filter(t => t.status === 'ws_close').length
    const ev = r.turns.reduce((s, t) => s + t.eventCount, 0), tl = r.turns.reduce((s, t) => s + t.toolCallCount, 0)
    total += r.turns.length; ok += _ok; to += _to; err += _err; wsc += _wsc; tDur += r.totalDurationMs; tEv += ev; tTl += tl
    console.log(`\n  ${r.scenarioTitle} (${r.scenarioId})  phase=${r.phase ?? '?'}  disc=${r.wsDisconnects}  ${(r.totalDurationMs/1000).toFixed(1)}s`)
    for (const t of r.turns) {
      const dur = `${(t.durationMs/1000).toFixed(1)}s`.padEnd(8), sr = (t.stopReason||'').padEnd(14)
      console.log(`  ${String(t.turn).padEnd(5)} ${t.status.padEnd(10)} ${dur} ${sr} ${String(t.eventCount).padEnd(7)} ${String(t.toolCallCount).padEnd(6)} ${t.prompt.slice(0,48)}`)
      if (t.errorMessage) console.log(`         └─ ${t.errorMessage.slice(0,120)}`)
    }
  }
  const rate = total>0 ? ((ok/total)*100).toFixed(1) : '0.0'
  console.log(`\n  SUMMARY seed=${seed} | ${total} turns | ${ok} ok (${rate}%) | ${to} timeout | ${err} error | ${wsc} ws_close | ${(tDur/1000).toFixed(1)}s total`)
  console.log(`  events=${tEv} tools=${tTl}`)
  console.log('═══════════════════════════════════════════════════════')
  if (to + err + wsc > 0) { console.log(`\n  ${to+err+wsc} turn(s) failed. FAILED.\n`); process.exitCode = 1 }
  else console.log(`\n  All ${total} turns passed. PASSED.\n`)
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let n = parseEnvInt('SCENARIO_COUNT', 3), seed = parseEnvInt('SEED', Date.now())
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--scenarios' && process.argv[i+1]) n = parseInt(process.argv[i+1]!, 10)
    if (process.argv[i] === '--seed' && process.argv[i+1]) seed = parseInt(process.argv[i+1]!, 10)
  }
  console.log('╔═══════════════════════════════════════════════════════╗')
  console.log('║  LINK STRESS TEST (via local server)                 ║')
  console.log('╚═══════════════════════════════════════════════════════╝')
  console.log(`  Server: ${SERVER_WS}  |  Scenarios: ${n}  |  Seed: ${seed}`)

  const scenarios = pickRandomScenarios(n, seed)
  console.log(`  Selected: ${scenarios.map(s => s.id).join(', ')}`)

  try {
    const resp = await fetch(`http://127.0.0.1:8787/ws`, { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } })
    if (resp.status !== 426) { console.error(`  ❌ Server returned ${resp.status}`); process.exit(1) }
    console.log('  ✓ Server reachable')
  } catch { console.error('  ❌ Cannot reach server'); process.exit(1) }

  const results: ScenarioResult[] = []
  for (let si = 0; si < scenarios.length; si++) {
    try { results.push(await runScenario(scenarios[si]!, si)) }
    catch (err) {
      const s = scenarios[si]!
      results.push({ scenarioId: s.id, scenarioTitle: s.title,
        turns: s.prompts.map((p, i) => ({ turn: i+1, prompt: p, status: 'error' as const, durationMs: 0, errorMessage: fmtErr(err), eventCount: 0, toolCallCount: 0 })),
        wsDisconnects: 0, totalDurationMs: 0 })
    }
  }

  const logDir = path.resolve(SCRIPT_DIR, 'logs'); fs.mkdirSync(logDir, { recursive: true })
  const lp = path.join(logDir, `stress-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(lp, JSON.stringify({ ts: new Date().toISOString(), server: SERVER_WS, seed, n, results }, null, 2))
  console.log(`  Log: ${lp}`)
  report(results, seed)
}

main().catch(err => { console.error('Fatal:', fmtErr(err)); process.exit(2) })
