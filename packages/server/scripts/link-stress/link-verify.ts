#!/usr/bin/env -S npx tsx
/**
 * 分层链路验证脚本
 *
 * L0: 心跳保活 — 静默状态下至少 20 个心跳来回不断
 * L1-1: 单轮问答 — server 问 → adapter 回
 * L1-2: 双话题并发 — 话题 A 发话 → 切话题 B 发话 → 两边都收到回复
 * L2: 多轮简单对话 — 10 轮纯文本对话
 * L3: 压力测试 — 10 轮复杂对话，涉及规划、tool use
 *
 * 用法: npx tsx scripts/link-stress/link-verify.ts [l0|l1-1|l1-2|l2|l3|all]
 */

import WebSocket from 'ws'
import { encodeFrame, decodeFrame, createFrame, type WSFrame, DEFAULT_PI_ADAPTER_URL } from '@agent-chat/protocol'

const PI_ADAPTER_URL = process.env.PI_ADAPTER_URL || DEFAULT_PI_ADAPTER_URL
const PI_ADAPTER_TOKEN = process.env.PI_ADAPTER_TOKEN || '1234'
const SERVER_WS_URL = process.env.SERVER_WS_URL || 'ws://127.0.0.1:8787/ws'
const AUTH_TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const TARGET_HEARTBEATS = parseInt(process.env.TARGET_HEARTBEATS || '20', 10)
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '120000', 10)
const RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || '30000', 10)
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS || '120000', 10)

function fmtErr(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function parseMsg(raw: WebSocket.Data): string {
  return typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : new TextDecoder().decode(raw as ArrayBuffer)
}

function buildAdapterUrl(): string {
  const url = new URL(PI_ADAPTER_URL)
  if (PI_ADAPTER_TOKEN) url.searchParams.set('token', PI_ADAPTER_TOKEN)
  return url.toString()
}

function buildServerUrl(): string {
  const url = new URL(SERVER_WS_URL)
  if (AUTH_TOKEN) url.searchParams.set('token', AUTH_TOKEN)
  return url.toString()
}

function ssend(ws: WebSocket, t: string, d: unknown, id?: string): void {
  ws.send(encodeFrame(createFrame(t, d, id)))
}

// ─── L0: 心跳保活 ─────────────────────────────────────────────────────

interface L0Result {
  passed: boolean
  heartbeatCount: number
  durationMs: number
  disconnectCode?: number
  disconnectReason?: string
  error?: string
}

async function runL0(): Promise<L0Result> {
  console.log('\n── L0: 心跳保活 (静默状态) ──')
  console.log(`  目标: ${TARGET_HEARTBEATS} 个心跳来回`)
  const wsUrl = buildAdapterUrl()
  const t0 = Date.now()

  return new Promise((resolve) => {
    let heartbeatCount = 0
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    }

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        const passed = heartbeatCount >= TARGET_HEARTBEATS
        console.log(`\n  ${passed ? '✓' : '✗'} 心跳计数: ${heartbeatCount}/${TARGET_HEARTBEATS} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
        if (!passed) console.log(`    └─ 超时，仅收到 ${heartbeatCount} 个心跳`)
        resolve({ passed, heartbeatCount, durationMs: Date.now() - t0, error: passed ? undefined : `心跳不足: ${heartbeatCount}/${TARGET_HEARTBEATS}` })
      }
    }, HEARTBEAT_TIMEOUT_MS)

    ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      console.log('  ✓ WS 连接成功')
    })

    ws.on('ping', () => {
      // 原生 WebSocket ping frame — WS 库会自动回复 pong
      // 但 adapter 还需要 keepalive_ack 数据帧
      heartbeatCount++
      process.stdout.write(`  💓 ${heartbeatCount}(ping)`)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(createFrame('keepalive_ack', { kind: 'keepalive_ack' })))
      }
      if (heartbeatCount >= TARGET_HEARTBEATS && !resolved) {
        resolved = true
        cleanup()
        console.log(`\n  ✓ 心跳计数: ${heartbeatCount}/${TARGET_HEARTBEATS} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
        resolve({ passed: true, heartbeatCount, durationMs: Date.now() - t0 })
      }
    })

    ws.on('message', (data: WebSocket.Data) => {
      if (resolved) return
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }

      if (f.t === 'keepalive') {
        heartbeatCount++
        process.stdout.write(`  ❤️ ${heartbeatCount}`)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(encodeFrame(createFrame('keepalive_ack', { kind: 'keepalive_ack' })))
        }
        if (heartbeatCount >= TARGET_HEARTBEATS && !resolved) {
          resolved = true
          cleanup()
          console.log(`\n  ✓ 心跳计数: ${heartbeatCount}/${TARGET_HEARTBEATS} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
          resolve({ passed: true, heartbeatCount, durationMs: Date.now() - t0 })
        }
      }
    })

    ws.on('close', (code, reason) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`\n  ✗ 链路断开: code=${code}, reason="${reason.toString()}"`)
        console.log(`    心跳计数: ${heartbeatCount}/${TARGET_HEARTBEATS}`)
        resolve({ passed: false, heartbeatCount, durationMs: Date.now() - t0, disconnectCode: code, disconnectReason: reason.toString(), error: `链路断开: code=${code}` })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`\n  ✗ WS 错误: ${fmtErr(err)}`)
        resolve({ passed: false, heartbeatCount, durationMs: Date.now() - t0, error: fmtErr(err) })
      }
    })
  })
}

// ─── L1-1: 单轮问答 (直连 Adapter) ────────────────────────────────────

interface L11Result {
  passed: boolean
  sessionId?: string
  durationMs: number
  eventCount: number
  stopReason?: string
  error?: string
}

async function runL11(): Promise<L11Result> {
  console.log('\n── L1-1: 单轮问答 (直连 Adapter) ──')
  const wsUrl = buildAdapterUrl()
  const t0 = Date.now()

  return new Promise((resolve) => {
    let ws: WebSocket | null = null
    let sessionId: string | null = null
    let messageId: string | null = null
    let eventCount = 0
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    }

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 超时 (${TURN_TIMEOUT_MS}ms)`)
        resolve({ passed: false, sessionId: sessionId ?? undefined, durationMs: Date.now() - t0, eventCount, error: 'timeout' })
      }
    }, TURN_TIMEOUT_MS)

    ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      console.log('  ✓ WS 连接成功')
      // 发送 createSession RPC (programming session 使用 CLI backend)
      ssend(ws, 'rpc', { method: 'createSession', params: { kind: 'programming', programming: { extension: 'claude-code', cwd: '/Users/enjoychan/Desktop/workspace/adapters' } } }, '1')
    })

    ws.on('message', (data: WebSocket.Data) => {
      if (resolved) return
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }

      // 处理 RPC 结果
      if (f.t === 'rpc.result' && f.id === '1') {
        const d = f.d as Record<string, unknown>
        sessionId = (d?.sessionId ?? d?.session_id) as string | null
        if (sessionId) {
          console.log(`  ✓ Session: ${sessionId}`)
          // 发送用户消息
          ssend(ws, 'rpc', { method: 'sendUserMessage', params: { sessionId, content: 'hi，请用一句话打招呼。' } }, '2')
        }
      }

      // 处理消息事件
      if (f.t === 'pi.event' || f.t === 'event') {
        const d = f.d as Record<string, unknown>
        const payload = d?.payload as Record<string, unknown> | undefined

        if (payload?.kind === 'message.start' && (payload as { role?: string })?.role === 'assistant') {
          messageId = (payload as { messageId?: string })?.messageId ?? null
          eventCount++
        }
        if (payload?.kind === 'message.delta') {
          eventCount++
        }
        if (payload?.kind === 'message.end' && (payload as { messageId?: string })?.messageId === messageId) {
          eventCount++
          const stopReason = (payload as { stopReason?: string })?.stopReason ?? 'end_turn'
          if (!resolved) {
            resolved = true
            cleanup()
            console.log(`  ✓ 收到回复: ${eventCount} events, stop=${stopReason}`)
            resolve({ passed: true, sessionId: sessionId!, durationMs: Date.now() - t0, eventCount, stopReason })
          }
        }
        if (payload?.kind === 'error') {
          if (!resolved) {
            resolved = true
            cleanup()
            const msg = (payload as { message?: string })?.message ?? 'error'
            console.log(`  ✗ Adapter 错误: ${msg}`)
            resolve({ passed: false, sessionId: sessionId ?? undefined, durationMs: Date.now() - t0, eventCount, error: msg })
          }
        }
      }

      // 处理 RPC 错误
      if (f.t === 'rpc.error') {
        const d = f.d as Record<string, unknown>
        const msg = (d?.message as string) ?? 'rpc error'
        if (!resolved) {
          resolved = true
          cleanup()
          console.log(`  ✗ RPC 错误: ${msg}`)
          resolve({ passed: false, sessionId: sessionId ?? undefined, durationMs: Date.now() - t0, eventCount, error: msg })
        }
      }
    })

    ws.on('close', (code, reason) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 链路断开: code=${code}`)
        resolve({ passed: false, sessionId: sessionId ?? undefined, durationMs: Date.now() - t0, eventCount, error: `disconnect: ${code}` })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ WS 错误: ${fmtErr(err)}`)
        resolve({ passed: false, durationMs: Date.now() - t0, eventCount, error: fmtErr(err) })
      }
    })
  })
}

// ─── L1-2: 双话题并发 (经 Server) ───────────────────────────────────────

interface L12Result {
  passed: boolean
  topicA?: string
  topicB?: string
  durationMs: number
  error?: string
}

async function runL12(): Promise<L12Result> {
  console.log('\n── L1-2: 双话题并发 (经 Server) ──')
  console.log('  目标: 话题 A 发话 → 切话题 B 发话 → 两边都收到回复')
  const wsUrl = buildServerUrl()
  const t0 = Date.now()

  return new Promise((resolve) => {
    let ws: WebSocket | null = null
    let topicA: string | null = null
    let topicB: string | null = null
    let msgAReceived = false
    let msgBReceived = false
    let msgAId: string | null = null
    let msgBId: string | null = null
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    }

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 超时`)
        console.log(`    话题 A: ${msgAReceived ? '✓ 已收到回复' : '✗ 未收到回复'}`)
        console.log(`    话题 B: ${msgBReceived ? '✓ 已收到回复' : '✗ 未收到回复'}`)
        resolve({ passed: false, topicA: topicA ?? undefined, topicB: topicB ?? undefined, durationMs: Date.now() - t0, error: 'timeout' })
      }
    }, TURN_TIMEOUT_MS * 2) // 双话题需要更长超时

    ws = new WebSocket(wsUrl)

    ws.on('open', async () => {
      console.log('  ✓ WS 连接成功')

      // 创建话题 A
      topicA = await createTopic(ws, 'A')
      if (!topicA) {
        resolved = true
        cleanup()
        resolve({ passed: false, durationMs: Date.now() - t0, error: 'topic A create failed' })
        return
      }
      console.log(`  ✓ 话题 A: ${topicA}`)

      // 发送消息 A
      ssend(ws, 'user.message', { topicId: topicA, content: '你好，请用一句话介绍自己。', clientMessageId: `a-${Date.now()}` })

      // 等待 1s 后切话题 B
      await new Promise(r => setTimeout(r, 1000))

      // 创建话题 B
      topicB = await createTopic(ws, 'B')
      if (!topicB) {
        console.log(`  ✗ 话题 B 创建失败`)
        // 继续等待 A 的回复
        return
      }
      console.log(`  ✓ 话题 B: ${topicB}`)

      // 发送消息 B
      ssend(ws, 'user.message', { topicId: topicB, content: '你好，请说出今天天气如何。', clientMessageId: `b-${Date.now()}` })
    })

    ws.on('message', (data: WebSocket.Data) => {
      if (resolved) return
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }

      const d = f.d as Record<string, unknown>

      // 检测消息开始
      if (f.t === 'message.start' && (d as { role?: string })?.role === 'assistant') {
        const topicId = (d as { topicId?: string })?.topicId
        const messageId = (d as { messageId?: string })?.messageId
        if (topicId === topicA) msgAId = messageId
        if (topicId === topicB) msgBId = messageId
      }

      // 检测消息结束
      if (f.t === 'message.end') {
        const messageId = (d as { messageId?: string })?.messageId
        if (messageId === msgAId) {
          msgAReceived = true
          console.log(`  ✓ 话题 A 收到回复`)
        }
        if (messageId === msgBId) {
          msgBReceived = true
          console.log(`  ✓ 话题 B 收到回复`)
        }

        // 两者都收到才算通过
        if (msgAReceived && msgBReceived && !resolved) {
          resolved = true
          cleanup()
          console.log(`  ✓ 双话题并发验证成功`)
          resolve({ passed: true, topicA: topicA!, topicB: topicB!, durationMs: Date.now() - t0 })
        }
      }

      // 处理错误
      if (f.t === 'error') {
        const msg = (d as { message?: string })?.message ?? 'error'
        console.log(`  ✗ Server 错误: ${msg}`)
      }
    })

    ws.on('close', (code) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 链路断开: code=${code}`)
        resolve({ passed: false, topicA: topicA ?? undefined, topicB: topicB ?? undefined, durationMs: Date.now() - t0, error: `disconnect: ${code}` })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ WS 错误: ${fmtErr(err)}`)
        resolve({ passed: false, durationMs: Date.now() - t0, error: fmtErr(err) })
      }
    })
  })
}

// Helper: 创建话题
async function createTopic(ws: WebSocket, label: string, options?: { agentType?: 'general' | 'programming' }): Promise<string | null> {
  const agentType = options?.agentType ?? 'programming'
  return new Promise((resolve) => {
    let topicId: string | null = null
    const timer = setTimeout(() => {
      ws.removeListener('message', onMsg)
      resolve(null)
    }, RPC_TIMEOUT_MS)

    function onMsg(data: WebSocket.Data) {
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }
      const d = f.d as Record<string, unknown>

      if (f.t === 'topic.created') {
        topicId = (d as { id?: string })?.id ?? null
      }
      if (f.t === 'session.status' && (d as { ready?: boolean })?.ready && topicId) {
        clearTimeout(timer)
        ws.removeListener('message', onMsg)
        resolve(topicId)
      }
      if (f.t === 'error') {
        clearTimeout(timer)
        ws.removeListener('message', onMsg)
        resolve(null)
      }
    }

    ws.on('message', onMsg)

    const createPayload: Record<string, unknown> = {
      name: `l12-${label}-${Date.now()}`,
      agentType,
    }
    if (agentType === 'programming') {
      createPayload.programming = { extension: 'claude-code', yolo: true, cwd: `/tmp/l12-${label}`, permissionMode: 'bypassPermissions' }
    }
    ssend(ws, 'topic.create', createPayload)
  })
}

// ─── L2: 多轮简单对话 (10 轮纯文本) ───────────────────────────────────

interface L2TurnLog {
  turn: number
  userMessage: string
  textContent: string
  thinkingContent: string
  stopReason: string | null
  durationMs: number
  receivedText: boolean
}

interface L2Result {
  passed: boolean
  turns: number
  durationMs: number
  error?: string
  logs: L2TurnLog[]
}

async function runL2(): Promise<L2Result> {
  console.log('\n── L2: 多轮简单对话 (10 轮纯文本) ──')
  const wsUrl = buildServerUrl()
  const t0 = Date.now()
  const TARGET_TURN = 10

  return new Promise((resolve) => {
    let ws: WebSocket | null = null
    let topicId: string | null = null
    let currentTurn = 0
    let waitingForReply = false
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const logs: L2TurnLog[] = []
    let turnT0 = Date.now()
    let turnText = ''
    let turnThinking = ''
    let turnStopReason: string | null = null

    const startTurnLog = (turn: number, userMsg: string) => {
      turnT0 = Date.now()
      turnText = ''
      turnThinking = ''
      turnStopReason = null
      logs.push({
        turn: turn + 1,
        userMessage: userMsg,
        textContent: '',
        thinkingContent: '',
        stopReason: null,
        durationMs: 0,
        receivedText: false,
      })
    }

    const finishTurnLog = (receivedText: boolean) => {
      const log = logs[logs.length - 1]
      if (!log) return
      log.textContent = turnText.slice(0, 200)
      log.thinkingContent = turnThinking.slice(0, 200)
      log.stopReason = turnStopReason
      log.durationMs = Date.now() - turnT0
      log.receivedText = receivedText
    }

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    }

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 超时`)
        console.log(`    完成轮数: ${currentTurn}/${TARGET_TURN}`)
        resolve({ passed: false, turns: currentTurn, durationMs: Date.now() - t0, error: 'timeout' })
      }
    }, TURN_TIMEOUT_MS * 10) // 10 轮需要更长超时

    ws = new WebSocket(wsUrl)

    ws.on('open', async () => {
      console.log('  ✓ WS 连接成功')
      topicId = await createTopic(ws, 'L2')
      if (!topicId) {
        resolved = true
        cleanup()
        resolve({ passed: false, turns: 0, durationMs: Date.now() - t0, error: 'topic create failed' })
        return
      }
      console.log(`  ✓ 话题: ${topicId}`)
      // 发送第一轮
      sendTurn()
    })

    // L2 任务列表：多轮简单对话，生成一个计算器脚本
    const l2Tasks = [
      '创建一个简单的 JavaScript 计算器脚本，支持加减乘除',
      '添加输入验证，处理非法输入',
      '添加除零错误处理',
      '添加连续计算功能，可以连续输入多个数字',
      '添加历史记录功能，记录最近的计算',
      '添加清空历史记录功能',
      '添加百分比计算功能',
      '添加平方根计算功能',
      '添加圆周率常数 PI',
      '总结计算器功能'
    ]

    function sendTurn() {
      if (currentTurn >= TARGET_TURN) {
        resolved = true
        cleanup()
        console.log(`  ✓ 完成 ${TARGET_TURN} 轮对话`)
        resolve({ passed: true, turns: TARGET_TURN, durationMs: Date.now() - t0, logs })
        return
      }
      waitingForReply = true
      startTurnLog(currentTurn, l2Tasks[currentTurn])
      ssend(ws, 'user.message', {
        topicId,
        content: l2Tasks[currentTurn],
        clientMessageId: `l2-${currentTurn}-${Date.now()}`
      })
    }

    // 跟踪是否收到有 text 内容的 message.delta
    let receivedTextDelta = false

    ws.on('message', (data: WebSocket.Data) => {
      if (resolved) return
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }

      const d = f.d as Record<string, unknown>

      // 记录 message.delta 内容
      if (f.t === 'message.delta') {
        const part = (d as { part?: { kind?: string, content?: string } })?.part
        if (part?.kind === 'text' && part?.content?.trim()) {
          receivedTextDelta = true
          turnText += part.content
        }
        if (part?.kind === 'thinking' && part?.content?.trim()) {
          turnThinking += part.content
        }
      }

      // 检测消息结束
      if (f.t === 'message.end' && waitingForReply) {
        turnStopReason = (d as { stopReason?: string })?.stopReason ?? null
        finishTurnLog(receivedTextDelta)

        if (!receivedTextDelta) {
          // 没收到 text delta，等待后续消息
          return
        }
        receivedTextDelta = false  // 重置
        waitingForReply = false
        currentTurn++
        console.log(`  ✓ 第 ${currentTurn} 轮完成`)
        // 发送下一轮
        setTimeout(sendTurn, 500)
      }

      if (f.t === 'error') {
        const msg = (d as { message?: string })?.message ?? 'error'
        if (!resolved) {
          resolved = true
          cleanup()
          console.log(`  ✗ Server 错误: ${msg}`)
          resolve({ passed: false, turns: currentTurn, durationMs: Date.now() - t0, error: msg, logs })
        }
      }
    })

    ws.on('close', (code) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 链路断开: code=${code}`)
        resolve({ passed: false, turns: currentTurn, durationMs: Date.now() - t0, error: `disconnect: ${code}`, logs })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ WS 错误: ${fmtErr(err)}`)
        resolve({ passed: false, turns: currentTurn, durationMs: Date.now() - t0, error: fmtErr(err), logs })
      }
    })
  })
}

// ─── L3: 压力测试 (5 轮 Web 开发，渐进式构建应用) ───────────────────────

interface L3TurnLog {
  turn: number
  userMessage: string
  textContent: string
  thinkingContent: string
  toolCalls: Array<{ name: string; input: string }>
  toolResults: Array<{ name: string; output: string }>
  todos: string[]
  plans: string[]
  artifacts: string[]
  stopReason: string | null
  durationMs: number
  hasThinking: boolean
  hasText: boolean
  hasToolUse: boolean
  hasTodo: boolean
  hasPlan: boolean
  hasArtifact: boolean
}

interface L3Result {
  passed: boolean
  turns: number
  toolCalls: number
  durationMs: number
  error?: string
  logs: L3TurnLog[]
}

/**
 * L3: 5 轮渐进式 Web 开发
 * 场景: 构建一个番茄钟 (Pomodoro Timer) Web 应用
 * 每轮验证: thinking、正文、tool use、todo、plan、artifact
 */
async function runL3(): Promise<L3Result> {
  console.log('\n── L3: 压力测试 (5 轮 Web 开发，渐进式构建番茄钟应用) ──')
  const wsUrl = buildServerUrl()
  const t0 = Date.now()
  const TARGET_TURN = 5

  return new Promise((resolve) => {
    let ws: WebSocket | null = null
    let topicId: string | null = null
    let currentTurn = 0
    let toolCalls = 0
    let waitingForReply = false
    let resolved = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const logs: L3TurnLog[] = []
    let turnT0 = Date.now()
    let turnText = ''
    let turnThinking = ''
    let turnToolCalls: Array<{ name: string; input: string }> = []
    let turnToolResults: Array<{ name: string; output: string }> = []
    let turnTodos: string[] = []
    let turnPlans: string[] = []
    let turnArtifacts: string[] = []
    let turnStopReason: string | null = null

    const startTurnLog = (turn: number, userMsg: string) => {
      turnT0 = Date.now()
      turnText = ''
      turnThinking = ''
      turnToolCalls = []
      turnToolResults = []
      turnTodos = []
      turnPlans = []
      turnArtifacts = []
      turnStopReason = null
      logs.push({
        turn: turn + 1,
        userMessage: userMsg,
        textContent: '',
        thinkingContent: '',
        toolCalls: [],
        toolResults: [],
        todos: [],
        plans: [],
        artifacts: [],
        stopReason: null,
        durationMs: 0,
        hasThinking: false,
        hasText: false,
        hasToolUse: false,
        hasTodo: false,
        hasPlan: false,
        hasArtifact: false,
      })
    }

    const finishTurnLog = () => {
      const log = logs[logs.length - 1]
      if (!log) return
      log.textContent = turnText.slice(0, 300)
      log.thinkingContent = turnThinking.slice(0, 300)
      log.toolCalls = [...turnToolCalls]
      log.toolResults = [...turnToolResults]
      log.todos = [...turnTodos]
      log.plans = [...turnPlans]
      log.artifacts = [...turnArtifacts]
      log.stopReason = turnStopReason
      log.durationMs = Date.now() - turnT0
      log.hasThinking = turnThinking.length > 0
      log.hasText = turnText.length > 0
      log.hasToolUse = turnToolCalls.length > 0
      log.hasTodo = turnTodos.length > 0
      log.hasPlan = turnPlans.length > 0
      log.hasArtifact = turnArtifacts.length > 0
    }

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    }

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 超时`)
        console.log(`    完成轮数: ${currentTurn}/${TARGET_TURN}`)
        console.log(`    Tool calls: ${toolCalls}`)
        resolve({ passed: false, turns: currentTurn, toolCalls, durationMs: Date.now() - t0, error: 'timeout', logs })
      }
    }, 180000) // 3 分钟每轮上限，5 轮最多 15 分钟

    // 5 轮渐进式 Web 开发: 番茄钟 (Pomodoro Timer) 应用
    const tasks = [
      // 第 1 轮: 需求分析 + 项目结构
      '创建一个番茄钟 (Pomodoro Timer) Web 应用。要求：25 分钟工作 + 5 分钟休息的循环，使用纯 HTML + CSS + JavaScript，创建完整的单页面应用。请先分析需求并创建项目结构。',
      // 第 2 轮: 核心计时器功能
      '实现核心计时器功能：显示倒计时（分:秒格式），有开始、暂停、重置按钮。计时器到零时自动切换工作/休息状态。',
      // 第 3 轮: 视觉和音频反馈
      '添加视觉反馈：工作时显示红色主题，休息时显示绿色主题。计时结束时播放提示音（使用 Web Audio API 生成）。同时添加浏览器的标题栏显示剩余时间。',
      // 第 4 轮: 历史记录
      '添加历史记录功能：使用 localStorage 保存每次完成的番茄钟记录，包括时间、类型（工作/休息）、持续时间。在页面底部显示最近 5 条记录。',
      // 第 5 轮: 总结 + 验证
      '总结整个番茄钟应用的功能，检查所有功能是否正常工作，并给出使用指南。',
    ]

    ws = new WebSocket(wsUrl)

    ws.on('open', async () => {
      console.log('  ✓ WS 连接成功')
      topicId = await createTopic(ws, 'L3')
      if (!topicId) {
        resolved = true
        cleanup()
        resolve({ passed: false, turns: 0, toolCalls: 0, durationMs: Date.now() - t0, error: 'topic create failed' })
        return
      }
      console.log(`  ✓ 话题: ${topicId}`)
      sendTurn()
    })

    function sendTurn() {
      if (currentTurn >= TARGET_TURN) {
        resolved = true
        cleanup()
        console.log(`  ✓ 完成 ${TARGET_TURN} 轮复杂对话`)
        console.log(`  ✓ Tool calls: ${toolCalls}`)
        resolve({ passed: true, turns: TARGET_TURN, toolCalls, durationMs: Date.now() - t0, logs })
        return
      }
      waitingForReply = true
      startTurnLog(currentTurn, tasks[currentTurn])
      ssend(ws, 'user.message', {
        topicId,
        content: tasks[currentTurn],
        clientMessageId: `l3-${currentTurn}-${Date.now()}`
      })
    }

    ws.on('message', (data: WebSocket.Data) => {
      if (resolved) return
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }

      const d = f.d as Record<string, unknown>

      // ── tool.call ──
      if (f.t === 'tool.call') {
        toolCalls++
        const name = (d as { name?: string })?.name || 'unknown'
        const input = JSON.stringify((d as { input?: unknown })?.input ?? '').slice(0, 150)
        turnToolCalls.push({ name, input })
        console.log(`  🔧 Tool call #${toolCalls}: ${name}`)
      }

      // ── tool.result ──
      if (f.t === 'tool.result') {
        const name = turnToolCalls[turnToolCalls.length - 1]?.name ?? 'unknown'
        const output = JSON.stringify((d as { output?: unknown })?.output ?? '').slice(0, 150)
        turnToolResults.push({ name, output })
      }

      // ── artifact ──
      if (f.t === 'artifact.added') {
        const name = (d as { name?: string })?.name || 'unknown'
        turnArtifacts.push(name)
        console.log(`  📦 Artifact: ${name}`)
      }

      // ── todo.update ──
      if (f.t === 'todo.update') {
        const items = (d as { items?: Array<{ content?: string }> })?.items
        if (items && Array.isArray(items)) {
          turnTodos = items.map(i => i.content ?? '').filter(Boolean)
        }
      }

      // ── plan.update ──
      if (f.t === 'plan.update') {
        const plan = (d as { plan?: string })?.plan
        if (plan) {
          turnPlans.push(plan.slice(0, 200))
        }
      }

      // ── message.delta ──
      if (f.t === 'message.delta') {
        const part = (d as { part?: { kind?: string, content?: string } })?.part
        if (part?.kind === 'text' && part?.content?.trim()) {
          turnText += part.content
        }
        if (part?.kind === 'thinking' && part?.content?.trim()) {
          turnThinking += part.content
        }
      }

      // ── message.end ──
      if (f.t === 'message.end' && waitingForReply) {
        turnStopReason = (d as { stopReason?: string })?.stopReason ?? null
        finishTurnLog()

        const log = logs[logs.length - 1]
        if (!log) return

        waitingForReply = false
        currentTurn++

        // 打印本轮摘要
        const flags: string[] = []
        if (log.hasThinking) flags.push('thinking')
        if (log.hasText) flags.push('text')
        if (log.hasToolUse) flags.push(`${log.toolCalls.length} tools`)
        if (log.hasTodo) flags.push('todo')
        if (log.hasPlan) flags.push('plan')
        if (log.hasArtifact) flags.push('artifact')
        console.log(`  ✓ 第 ${currentTurn} 轮完成 (${log.durationMs}ms) [${flags.join(', ') || 'empty'}]`)

        // 发送下一轮
        setTimeout(sendTurn, 1500)
      }

      if (f.t === 'error') {
        const msg = (d as { message?: string })?.message ?? 'error'
        if (!resolved) {
          resolved = true
          cleanup()
          console.log(`  ✗ Server 错误: ${msg}`)
          resolve({ passed: false, turns: currentTurn, toolCalls, durationMs: Date.now() - t0, error: msg, logs })
        }
      }
    })

    ws.on('close', (code) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ 链路断开: code=${code}`)
        resolve({ passed: false, turns: currentTurn, toolCalls, durationMs: Date.now() - t0, error: `disconnect: ${code}`, logs })
      }
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`  ✗ WS 错误: ${fmtErr(err)}`)
        resolve({ passed: false, turns: currentTurn, toolCalls, durationMs: Date.now() - t0, error: fmtErr(err), logs })
      }
    })
  })
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] || 'l0'

  console.log('╔══════════════════════════════════╗')
  console.log('║  LINK VERIFY (分层验证)           ║')
  console.log('╚══════════════════════════════════╝')
  if (arg === 'l0' || arg.startsWith('l1')) {
    console.log(`  Adapter: ${PI_ADAPTER_URL.replace(/token=[^&]+/, 'token=***')}`)
  } else {
    console.log(`  Server: ${SERVER_WS_URL}`)
  }

  let results: { layer: string; passed: boolean }[] = []

  if (arg === 'l0' || arg === 'all') {
    const r = await runL0()
    results.push({ layer: 'L0', passed: r.passed })
    if (!r.passed) {
      console.log('\n  L0 失败，后续测试中止')
      process.exitCode = 1
      return
    }
  }

  if (arg === 'l1-1' || arg === 'all') {
    const r = await runL11()
    results.push({ layer: 'L1-1', passed: r.passed })
    if (!r.passed) {
      console.log('\n  L1-1 失败，后续测试中止')
      process.exitCode = 1
      return
    }
  }

  if (arg === 'l1-2' || arg === 'all') {
    const r = await runL12()
    results.push({ layer: 'L1-2', passed: r.passed })
    if (!r.passed) {
      console.log('\n  L1-2 失败，后续测试中止')
      process.exitCode = 1
      return
    }
  }

  if (arg === 'l2' || arg === 'all') {
    const r = await runL2()
    results.push({ layer: 'L2', passed: r.passed })

    // 打印详细对话记录
    if (r.logs && r.logs.length > 0) {
      console.log('\n── L2 对话记录 ──')
      for (const log of r.logs) {
        console.log(`\n  【第 ${log.turn} 轮】${log.receivedText ? '✓ 有正文' : '✗ 无正文'} (${log.durationMs}ms)`)
        console.log(`  用户: ${log.userMessage.slice(0, 60)}${log.userMessage.length > 60 ? '...' : ''}`)
        if (log.thinkingContent) {
          console.log(`  思考: ${log.thinkingContent.slice(0, 120)}${log.thinkingContent.length > 120 ? '...' : ''}`)
        }
        if (log.textContent) {
          console.log(`  正文: ${log.textContent.slice(0, 120)}${log.textContent.length > 120 ? '...' : ''}`)
        }
        console.log(`  结束原因: ${log.stopReason ?? '无'}`)
      }
    }

    if (!r.passed) {
      console.log('\n  L2 失败，后续测试中止')
      process.exitCode = 1
      return
    }
  }

  if (arg === 'l3' || arg === 'all') {
    const r = await runL3()
    results.push({ layer: 'L3', passed: r.passed })

    // 打印详细对话记录
    if (r.logs && r.logs.length > 0) {
      console.log('\n── L3 对话记录 ──')
      for (const log of r.logs) {
        console.log(`\n  【第 ${log.turn} 轮】${log.receivedText ? '✓ 有正文' : '✗ 无正文'} (${log.durationMs}ms)`)
        console.log(`  用户: ${log.userMessage.slice(0, 60)}${log.userMessage.length > 60 ? '...' : ''}`)
        if (log.thinkingContent) {
          console.log(`  思考: ${log.thinkingContent.slice(0, 120)}${log.thinkingContent.length > 120 ? '...' : ''}`)
        }
        if (log.textContent) {
          console.log(`  正文: ${log.textContent.slice(0, 120)}${log.textContent.length > 120 ? '...' : ''}`)
        }
        if (log.toolCalls.length > 0) {
          console.log(`  工具: ${log.toolCalls.map(t => t.name).join(', ')}`)
        }
        if (log.artifacts.length > 0) {
          console.log(`  产物: ${log.artifacts.join(', ')}`)
        }
        console.log(`  结束原因: ${log.stopReason ?? '无'}`)
      }
    }

    if (!r.passed) {
      console.log('\n  L3 失败，后续测试中止')
      process.exitCode = 1
      return
    }
  }

  // 汇总
  console.log('\n════════════════════════════════════════')
  const passed = results.filter(r => r.passed).length
  const total = results.length
  console.log(`  ${passed}/${total} 层通过`)
  if (passed < total) process.exitCode = 1
}

main().catch(err => { console.error('Fatal:', fmtErr(err)); process.exit(2) })