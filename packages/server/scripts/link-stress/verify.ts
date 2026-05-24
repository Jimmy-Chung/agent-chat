#!/usr/bin/env -S npx tsx
/**
 * 分层链路验证 — 从简单到复杂逐层确认
 *
 * L1: 单 topic + 单消息
 * L2: 单 topic + 5 条消息（多轮简单对话）
 * L3: 压测场景（3 topic × 10 turn，来自 scenarios.ts）
 *
 * 用法: npx tsx scripts/link-stress/verify.ts [l1|l2|l3]
 */

import WebSocket from 'ws'
import { encodeFrame, decodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'

const SERVER_WS = process.env.SERVER_WS_URL || 'ws://127.0.0.1:8787/ws'
const AUTH_TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || '120000', 10)

function ssend(ws: WebSocket, t: string, d: unknown, id?: string) {
  ws.send(encodeFrame(createFrame(t, d, id)))
}

function fmtErr(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function parseMsg(raw: WebSocket.Data): string {
  return typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : new TextDecoder().decode(raw as ArrayBuffer)
}

// ─── Helpers ────────────────────────────────────────────────────────

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const t = setTimeout(() => { reject(new Error('connect timeout')); ws.close() }, 10000)
    ws.on('open', () => { clearTimeout(t); resolve(ws) })
    ws.on('error', (e: Error) => { clearTimeout(t); reject(e) })
  })
}

function createTopic(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let tid: string | null = null
    const t = setTimeout(() => { ws.removeListener('message', onMsg); reject(new Error('topic.create timeout')) }, 30000)
    function onMsg(data: WebSocket.Data) {
      const raw = parseMsg(data)
      let f: { t?: string; d?: unknown }
      try { f = JSON.parse(raw) as { t?: string; d?: unknown } } catch { return }
      const d = f.d as Record<string, unknown> | undefined
      if (f.t === 'topic.created') tid = (d?.id as string) ?? null
      if (f.t === 'session.status' && d?.ready && tid) { clearTimeout(t); ws.removeListener('message', onMsg); resolve(tid!) }
      if (f.t === 'error') { clearTimeout(t); ws.removeListener('message', onMsg); reject(new Error((d?.message as string) ?? 'topic error')) }
    }
    ws.on('message', onMsg)
    ssend(ws, 'topic.create', {
      name: `verify-${Date.now()}`, agentType: 'programming',
      programming: { extension: 'claude-code', yolo: true, cwd: `/tmp/verify-${Date.now()}`, permissionMode: 'bypassPermissions' },
    })
  })
}

function sendAndWait(ws: WebSocket, topicId: string, prompt: string): Promise<{ ok: boolean; durationMs: number; events: number; stopReason?: string; error?: string }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    let msgId: string | null = null
    let events = 0
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => { if (timer) { clearTimeout(timer); timer = null } ws.removeListener('message', onMsg) }

    timer = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); resolve({ ok: false, durationMs: Date.now() - t0, error: 'turn timeout', events }) }
    }, TURN_TIMEOUT_MS)

    function onMsg(data: WebSocket.Data) {
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }
      if (msgId) { events++ }
      const d = f.d as Record<string, unknown> | undefined

      if (f.t === 'message.start' && (d?.role as string) === 'assistant') msgId = d?.messageId as string
      if (f.t === 'message.end' && d?.messageId === msgId) {
        if (!resolved) { resolved = true; cleanup(); resolve({ ok: true, durationMs: Date.now() - t0, events, stopReason: d?.stopReason as string }) }
      }
      if (f.t === 'error' && !resolved) {
        resolved = true; cleanup(); resolve({ ok: false, durationMs: Date.now() - t0, error: (d?.message as string) ?? 'error', events })
      }
    }
    ws.on('message', onMsg)
    ssend(ws, 'user.message', { topicId, content: prompt, clientMessageId: `v-${Date.now()}` })
  })
}

// ─── L1: 单 topic + 单消息 ──────────────────────────────────────────

async function runL1(): Promise<boolean> {
  console.log('\n── L1: Single turn ──')
  const wsUrl = `${SERVER_WS}?token=${encodeURIComponent(AUTH_TOKEN)}`
  let ws: WebSocket | null = null
  try {
    ws = await connect(wsUrl)
    const topicId = await createTopic(ws)
    console.log(`  topic: ${topicId}`)
    const r = await sendAndWait(ws, topicId, 'hi，請用一句話打招呼。')
    console.log(`  ${r.ok ? '✓' : '✗'} ${(r.durationMs / 1000).toFixed(1)}s ev=${r.events} ${r.stopReason ?? r.error ?? ''}`)
    return r.ok
  } catch (err) {
    console.log(`  ✗ ${fmtErr(err)}`)
    return false
  } finally {
    ws?.close()
  }
}

// ─── L2: 单 topic + 多消息 ─────────────────────────────────────────

async function runL2(nTurns: number): Promise<boolean> {
  console.log(`\n── L2: ${nTurns} turns, single topic ──`)
  const wsUrl = `${SERVER_WS}?token=${encodeURIComponent(AUTH_TOKEN)}`
  const ws = await connect(wsUrl)
  let allOk = true

  try {
    const topicId = await createTopic(ws)
    console.log(`  topic: ${topicId}`)

    const prompts = [
      '一句話解釋 TypeScript。',
      '列出三種咖啡種類。',
      '什麼是 REST API？簡短回答。',
      '寫一個 JavaScript hello world。',
      '解釋 localhost 的意思。',
    ]

    for (let i = 0; i < nTurns && i < prompts.length; i++) {
      const prompt = prompts[i]!
      process.stdout.write(`  [${i + 1}/${nTurns}] ${prompt.slice(0, 50)}... `)
      const r = await sendAndWait(ws, topicId, prompt)
      console.log(r.ok ? `✓ ${(r.durationMs / 1000).toFixed(1)}s ev=${r.events}` : `✗ ${r.error}`)
      if (!r.ok) { allOk = false; break }
      await new Promise(r2 => setTimeout(r2, 5000)) // inter-turn gap
    }
  } catch (err) {
    console.log(`  ✗ ${fmtErr(err)}`)
    allOk = false
  }

  ssend(ws, 'topic.delete', { id: 'cleanup', artifactStrategy: 'delete' })
  await new Promise(r => setTimeout(r, 500))
  ws.close()
  return allOk
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] || 'l2'

  console.log('╔══════════════════════════════════╗')
  console.log('║  LINK VERIFY (layered)           ║')
  console.log('╚══════════════════════════════════╝')
  console.log(`  Server: ${SERVER_WS}  |  Timeout: ${TURN_TIMEOUT_MS}ms`)

  let l1ok = true, l2ok = true

  if (arg === 'l1' || arg === 'l2' || arg === 'all') {
    l1ok = await runL1()
  }

  if ((arg === 'l2' || arg === 'all') && l1ok) {
    l2ok = await runL2(5)
  }

  const passed = (l1ok ? 1 : 0) + (l2ok ? 1 : 0)
  const total = (arg === 'l1' ? 1 : 2)
  console.log(`\n${'═'.repeat(40)}`)
  console.log(`  ${passed}/${total} layers passed`)
  if (passed < total) process.exitCode = 1
}

main().catch(err => { console.error('Fatal:', err); process.exit(2) })
