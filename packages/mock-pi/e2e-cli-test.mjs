/**
 * E2E test for CLI Backend (claude-code programming agent)
 */
import { WebSocket } from 'ws'

const WS_URL = 'ws://127.0.0.1:8787/ws'
const TOKEN = 'test-token'

let ws
const events = []

function send(t, d) {
  const frame = JSON.stringify({ v: 1, t, d })
  console.log(`  → ${t}`, JSON.stringify(d).slice(0, 150))
  ws.send(frame)
}

function handleRaw(raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { return }
  const { t, d } = msg
  events.push({ t, d, ts: Date.now() })
  if (t === 'ping') return
  console.log(`  ← ${t}`, JSON.stringify(d).slice(0, 300))
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)) }

function waitForEvent(type, timeoutMs = 30000, predicate) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const match = events.find(e => e.t === type && (!predicate || predicate(e)))
      if (match) { resolve(match); return }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for ${type}`))
        return
      }
      setTimeout(check, 200)
    }
    check()
  })
}

async function runTest() {
  console.log('\n=== E2E Test: CLI Backend (claude-code) ===\n')

  // Step 1: Connect
  console.log('Step 1: WS Connect')
  ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${TOKEN}` } })
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  ws.on('message', (raw) => handleRaw(raw.toString()))
  console.log('  ✓ Connected\n')
  await waitMs(500)

  // Step 2: Create programming topic
  console.log('Step 2: Create programming topic')
  send('topic.create', {
    name: `CLI Test ${new Date().toISOString().slice(11, 19)}`,
    agentType: 'programming',
    programming: { extension: 'claude-code', yolo: true, permissionMode: 'bypassPermissions' },
  })
  const created = await waitForEvent('topic.created')
  const topicId = created.d?.id
  console.log(`  ✓ Topic created: ${topicId}\n`)

  // Step 3: Wait for session
  console.log('Step 3: Wait for PI session (30s)')
  try {
    const sessionStatus = await waitForEvent('session.status', 30000, e => e.d?.ready === true)
    console.log(`  ✓ Session ready: ${JSON.stringify(sessionStatus.d)}\n`)
  } catch {
    const updated = events.find(e => e.t === 'topic.updated' && e.d?.pi_session_id)
    if (updated) {
      console.log(`  ✓ Got session via topic.updated: ${updated.d.pi_session_id}\n`)
    } else {
      console.log('  ⚠ No session established, trying message anyway\n')
    }
  }

  // Step 4: Send message
  console.log('Step 4: Send user message')
  send('user.message', {
    topicId,
    content: 'Say "CLI_OK" in one word.',
    clientMessageId: `cm-cli-${Date.now()}`,
  })
  await waitMs(2000)
  console.log('  ✓ Sent\n')

  // Step 5: Wait for full response
  console.log('Step 5: Wait for response (60s)')
  await waitMs(60000)

  // Summary
  const thinkingDeltas = events.filter(e => e.t === 'message.delta' && e.d?.part?.kind === 'thinking')
  const textDeltas = events.filter(e => e.t === 'message.delta' && e.d?.part?.kind === 'text')
  const toolCalls = events.filter(e => e.t === 'tool.call')
  const toolResults = events.filter(e => e.t === 'tool.result')
  const ends = events.filter(e => e.t === 'message.end')
  const deliveries = events.filter(e => e.t === 'message.delivery')
  const errors = events.filter(e => e.t === 'error' || (e.t === 'message.delta' && e.d?.part?.content?.includes('error')))

  console.log('\n--- Results ---')
  console.log(`  Total events: ${events.length}`)
  console.log(`  message.start: ${events.filter(e => e.t === 'message.start').length}`)
  console.log(`  thinking deltas: ${thinkingDeltas.length}`)
  console.log(`  text deltas: ${textDeltas.length}`)
  console.log(`  tool.call: ${toolCalls.length}`)
  console.log(`  tool.result: ${toolResults.length}`)
  console.log(`  message.end: ${ends.length} (${ends.map(e => e.d?.stopReason).join(', ')})`)
  console.log(`  deliveries: ${deliveries.map(d => d.d?.status).join(' → ')}`)

  if (thinkingDeltas.length > 0) {
    const thinkingContent = thinkingDeltas.map(e => e.d.part.content).join('')
    console.log(`\n  Thinking content: "${thinkingContent.slice(0, 200)}"`)
  }
  if (textDeltas.length > 0) {
    const textContent = textDeltas.map(e => e.d.part.content).join('')
    console.log(`  Text content: "${textContent.slice(0, 200)}"`)
  }
  if (errors.length > 0) {
    console.log(`\n  Errors detected: ${errors.length}`)
    for (const e of errors.slice(0, 3)) {
      console.log(`    - ${e.t}: ${JSON.stringify(e.d).slice(0, 200)}`)
    }
  }

  const hasContent = thinkingDeltas.length > 0 || textDeltas.length > 0
  const isDone = deliveries.some(d => d.d?.status === 'done')
  const hasEnd = ends.some(e => e.d?.stopReason === 'end_turn')

  if (hasContent && hasEnd) {
    console.log('\n  ✓ SUCCESS: CLI Backend full pipeline working')
    ws.close()
    process.exit(0)
  } else if (hasContent) {
    console.log('\n  ✓ PARTIAL: Got content but no clean end_turn')
    ws.close()
    process.exit(0)
  } else {
    console.log('\n  ✗ FAIL: No content received from CLI Backend')
    ws.close()
    process.exit(1)
  }
}

runTest().catch((err) => {
  console.error('\nTest failed:', err.message)
  ws?.close()
  process.exit(1)
})
