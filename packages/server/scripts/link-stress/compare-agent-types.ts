#!/usr/bin/env -S npx tsx
/**
 * General vs Programming 对比测试
 * 创建两种类型的话题，发消息，对比 adapter 返回的 delta
 */

import WebSocket from 'ws'
import { encodeFrame, decodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'

const SERVER_WS_URL = process.env.SERVER_WS_URL || 'ws://127.0.0.1:8787/ws'
const AUTH_TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const RPC_TIMEOUT_MS = 30000
const TURN_TIMEOUT_MS = 60000

function parseMsg(raw: WebSocket.Data): string {
  return typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : new TextDecoder().decode(raw as ArrayBuffer)
}

function ssend(ws: WebSocket, t: string, d: unknown, id?: string): void {
  ws.send(encodeFrame(createFrame(t, d, id)))
}

function buildServerUrl(): string {
  const url = new URL(SERVER_WS_URL)
  if (AUTH_TOKEN) url.searchParams.set('token', AUTH_TOKEN)
  return url.toString()
}

async function createTopic(ws: WebSocket, agentType: 'general' | 'programming'): Promise<string | null> {
  return new Promise((resolve) => {
    let topicId: string | null = null
    const timer = setTimeout(() => { resolve(null) }, RPC_TIMEOUT_MS)

    function onMsg(data: WebSocket.Data) {
      const raw = parseMsg(data)
      let f: WSFrame
      try { f = decodeFrame(raw) } catch { return }
      const d = f.d as Record<string, unknown>

      if (f.t === 'topic.created') topicId = (d as { id?: string })?.id ?? null
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
    const payload: Record<string, unknown> = { name: `compare-${agentType}-${Date.now()}`, agentType }
    if (agentType === 'programming') {
      payload.programming = { extension: 'claude-code', yolo: true, cwd: `/tmp/compare-${agentType}`, permissionMode: 'bypassPermissions' }
    }
    ssend(ws, 'topic.create', payload)
  })
}

async function testAgentType(agentType: 'general' | 'programming'): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  测试 agentType: '${agentType}'`)
  console.log(`${'═'.repeat(60)}`)

  const ws = new WebSocket(buildServerUrl())

  await new Promise<void>((resolve) => {
    ws.on('open', async () => {
      console.log('  ✓ WS 连接成功')
      const topicId = await createTopic(ws, agentType)
      if (!topicId) {
        console.log(`  ✗ 话题创建失败`)
        ws.close()
        resolve()
        return
      }
      console.log(`  ✓ 话题: ${topicId}`)

      const testMessage = '你好，请用一句话介绍你自己'
      console.log(`  发送: "${testMessage}"`)

      // 收集 assistant 的 delta（通过 message.start 的 role 区分）
      const assistantDeltas: Array<{ type: string; part: any }> = []
      let currentMessageRole: string | null = null
      let messageEndReceived = false
      const timer = setTimeout(() => {
        console.log(`  ✗ 超时，未收到完整回复`)
        ws.close()
        resolve()
      }, TURN_TIMEOUT_MS)

      ws.on('message', (data: WebSocket.Data) => {
        const raw = parseMsg(data)
        let f: WSFrame
        try { f = decodeFrame(raw) } catch { return }
        const d = f.d as Record<string, unknown>

        if (f.t === 'message.start') {
          currentMessageRole = (d as { role?: string })?.role ?? null
          console.log(`    ← message.start (role: ${currentMessageRole})`)
        }

        if (f.t === 'message.delta') {
          const part = (d as { part?: Record<string, unknown> })?.part
          if (part) {
            const preview = (part.content as string)?.slice(0, 80) ?? JSON.stringify(part).slice(0, 80)
            console.log(`    ← delta [${part.kind}] (role: ${currentMessageRole}): "${preview}"`)
            // 只收集 assistant 的 delta
            if (currentMessageRole === 'assistant') {
              assistantDeltas.push({ type: f.t, part })
            }
          }
        }

        if (f.t === 'message.end') {
          messageEndReceived = true
          const stopReason = (d as { stopReason?: string })?.stopReason ?? 'unknown'
          console.log(`    ← message.end (stopReason: ${stopReason})`)
          clearTimeout(timer)

          // 分析结果（只统计 assistant 的 delta）
          console.log(`\n  ── 分析 ──`)
          const textDeltas = assistantDeltas.filter(d => d.part.kind === 'text')
          const thinkingDeltas = assistantDeltas.filter(d => d.part.kind === 'thinking')
          const toolDeltas = assistantDeltas.filter(d => d.part.kind === 'tool_input')

          console.log(`    assistant text deltas: ${textDeltas.length} 个`)
          if (textDeltas.length > 0) {
            const fullText = textDeltas.map(d => d.part.content).join('')
            console.log(`    assistant 正文: "${fullText.slice(0, 200)}"`)
          }

          console.log(`    assistant thinking deltas: ${thinkingDeltas.length} 个`)
          if (thinkingDeltas.length > 0) {
            const fullThinking = thinkingDeltas.map(d => d.part.content).join('')
            console.log(`    assistant 思考: "${fullThinking.slice(0, 200)}"`)
          }

          console.log(`    tool_input deltas: ${toolDeltas.length} 个`)

          ws.close()
          resolve()
        }

        if (f.t === 'error') {
          const msg = (d as { message?: string })?.message ?? 'error'
          console.log(`  ✗ Server 错误: ${msg}`)
          clearTimeout(timer)
          ws.close()
          resolve()
        }
      })

      // 发送消息
      ssend(ws, 'user.message', {
        topicId,
        content: testMessage,
        clientMessageId: `compare-${agentType}-${Date.now()}`
      })
    })
  })
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗')
  console.log('║  General vs Programming 对比测试                    ║')
  console.log('╚════════════════════════════════════════════════════╝')

  // 先测 general
  await testAgentType('general')

  // 等几秒
  await new Promise(r => setTimeout(r, 2000))

  // 再测 programming
  await testAgentType('programming')

  console.log('\n完成')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
