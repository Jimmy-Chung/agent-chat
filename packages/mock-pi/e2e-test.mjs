/**
 * Real end-to-end test against live PI Adapter
 * Server protocol: broadcast events only, no RPC replies.
 * {v:1, t:"...", d:{...}} — t is the event type, d is payload
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
  console.log(`  ← ${t}`, JSON.stringify(d).slice(0, 250))
}

function waitMs(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function waitForEvent(type, timeoutMs = 15000, predicate) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const match = events.find(e =>
        e.t === type && (!predicate || predicate(e))
      )
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
  console.log('\n=== E2E Test: Real PI Adapter ===\n')

  // Step 1: Connect
  console.log('Step 1: WS Connect')
  ws = new WebSocket(WS_URL, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  ws.on('message', (raw) => handleRaw(raw.toString()))
  console.log('  ✓ Connected\n')

  // Wait for initial burst (topics.list, sop_template.list)
  await waitMs(1000)

  // Step 2: Create topic
  console.log('Step 2: Create topic')
  send('topic.create', {
    name: `E2E ${new Date().toISOString().slice(11, 19)}`,
    agentType: 'general',
  })

  const created = await waitForEvent('topic.created')
  const topicId = created.d?.id
  console.log(`  ✓ Topic created: ${topicId}\n`)

  // Step 3: Wait for session.status (PI session establishment)
  console.log('Step 3: Wait for session.status (30s)')
  let sessionReady = false
  try {
    const sessionStatus = await waitForEvent('session.status', 30000, e => e.d?.ready === true)
    console.log(`  ✓ session.status: ready=${sessionStatus.d?.ready}\n`)
    sessionReady = true
  } catch {
    // Check if topic.updated came with pi_session_id
    const updated = events.find(e => e.t === 'topic.updated' && e.d?.id === topicId)
    if (updated?.d?.pi_session_id) {
      console.log(`  ✓ Got topic.updated with session: ${updated.d.pi_session_id}\n`)
      sessionReady = true
    } else {
      console.log('  ⚠ No session.status or topic.updated received, trying message anyway\n')
    }
  }

  // Step 4: Send user message
  console.log('Step 4: Send user message' + (sessionReady ? '' : ' (session may not be ready)'))
  send('user.message', {
    topicId,
    content: 'Hello from E2E test! Reply with "E2E_OK".',
    clientMessageId: `cm-e2e-${Date.now()}`,
  })
  await waitMs(1000)
  console.log('  ✓ Sent\n')

  // Step 5: Wait for streaming response
  console.log('Step 5: Wait for response (20s)')
  await waitMs(20000)

  // Summary
  const deltas = events.filter(e => e.t === 'message.delta')
  const ends = events.filter(e => e.t === 'message.end')
  const deliveries = events.filter(e => e.t === 'message.delivery')
  const topicUpdated = events.filter(e => e.t === 'topic.updated')

  console.log('\n--- Results ---')
  console.log(`  Events received: ${events.length}`)
  console.log(`  message.start: ${events.filter(e => e.t === 'message.start').length}`)
  console.log(`  message.delta: ${deltas.length}`)
  console.log(`  message.end: ${ends.length}`)
  for (const d of deliveries) {
    console.log(`  message.delivery: status=${d.d?.status}`)
  }
  for (const u of topicUpdated) {
    console.log(`  topic.updated: pi_session_id=${u.d?.pi_session_id}`)
  }

  const hasContent = deltas.length > 0
  const needsRetry = deliveries.some(d => d.d?.status === 'needs_retry')
  const isDone = deliveries.some(d => d.d?.status === 'done')

  if (hasContent && isDone) {
    console.log('\n  ✓ SUCCESS: Received streaming response + delivery confirmed')
  } else if (needsRetry) {
    console.log('\n  ✗ PARTIAL: Message needs retry (PI may be busy)')
  } else if (hasContent) {
    console.log('\n  ✓ PARTIAL SUCCESS: Got deltas but no delivery confirmation yet')
  } else {
    console.log('\n  ✗ FAIL: No response received')
  }

  console.log('\n=== E2E Test Done ===\n')
  ws.close()
  process.exit(hasContent || isDone ? 0 : 1)
}

runTest().catch((err) => {
  console.error('\nTest failed:', err.message)
  ws?.close()
  process.exit(1)
})
