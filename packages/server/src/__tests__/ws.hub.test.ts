import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import { WsHub } from '../ws/hub'
import type { ServerEvent } from '@agent-chat/protocol'

const TEST_PORT = 18080
// Must match config.token default ('test-token')
const TEST_TOKEN = 'test-token'

describe('WsHub', () => {
  let hub: WsHub
  let wss: WebSocketServer

  beforeEach(() => {
    hub = new WsHub()
    wss = new WebSocketServer({ port: TEST_PORT })
  })

  afterEach(() => {
    hub.closeAll()
    wss.close()
  })

  it('should reject unauthorized connections', async () => {
    const authPromise = new Promise<boolean>((resolve) => {
      wss.on('connection', (ws) => {
        const ok = hub.addClient(ws, 'wrong-token')
        resolve(ok)
      })
    })

    const client = new WsWebSocket(`ws://localhost:${TEST_PORT}`)
    await new Promise<void>((resolve, reject) => {
      client.on('close', () => {
        resolve()
      })
      client.on('error', reject)
      setTimeout(() => resolve(), 2000)
    })

    const ok = await authPromise
    expect(ok).toBe(false)
  })

  it('should accept authorized connections', async () => {
    const authPromise = new Promise<boolean>((resolve) => {
      wss.on('connection', (ws) => {
        const ok = hub.addClient(ws, TEST_TOKEN)
        resolve(ok)
      })
    })

    const client = new WsWebSocket(`ws://localhost:${TEST_PORT}`)
    await new Promise<void>((resolve) => {
      client.on('open', resolve)
    })

    const ok = await authPromise
    expect(ok).toBe(true)
    expect(hub.clientCount).toBe(1)
    client.close()
  })

  it('should broadcast events to all clients', async () => {
    wss.on('connection', (ws) => {
      hub.addClient(ws, TEST_TOKEN)
    })

    const client1 = new WsWebSocket(`ws://localhost:${TEST_PORT}`)
    const client2 = new WsWebSocket(`ws://localhost:${TEST_PORT}`)

    await new Promise<void>((resolve) => {
      let connected = 0
      const onOpen = () => {
        connected++
        if (connected === 2) resolve()
      }
      client1.on('open', onOpen)
      client2.on('open', onOpen)
    })

    const event: ServerEvent = {
      type: 'topic.created',
      data: {
        id: 'test-id',
        name: 'Test',
        kind: 'normal',
        agent_type: 'general',
        pi_session_id: null,
        current_model: null,
        history_frozen_at: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        archived: false,
      },
    }

    const msgPromise1 = new Promise<string>((resolve) => {
      client1.on('message', (raw) => resolve(raw.toString()))
    })
    const msgPromise2 = new Promise<string>((resolve) => {
      client2.on('message', (raw) => resolve(raw.toString()))
    })

    hub.broadcast(event)

    const [raw1, raw2] = await Promise.all([msgPromise1, msgPromise2])
    const parsed1 = JSON.parse(raw1)
    const parsed2 = JSON.parse(raw2)

    expect(parsed1.t).toBe('topic.created')
    expect(parsed2.t).toBe('topic.created')
    expect(parsed1.d.id).toBe('test-id')
    expect(parsed2.d.id).toBe('test-id')

    client1.close()
    client2.close()
  })

  it('should send event to a specific client', async () => {
    let targetWs: WsWebSocket | null = null
    wss.on('connection', (ws) => {
      hub.addClient(ws, TEST_TOKEN)
      if (!targetWs) targetWs = ws
    })

    const client = new WsWebSocket(`ws://localhost:${TEST_PORT}`)
    await new Promise<void>((resolve) => {
      client.on('open', resolve)
    })

    // Wait for hub to register client
    await new Promise((r) => setTimeout(r, 50))

    const msgPromise = new Promise<string>((resolve) => {
      client.on('message', (raw) => resolve(raw.toString()))
    })

    const event: ServerEvent = {
      type: 'topics.list',
      data: {
        topics: [],
      },
    }

    hub.sendToClient(targetWs!, event)

    const raw = await msgPromise
    const parsed = JSON.parse(raw)
    expect(parsed.t).toBe('topics.list')
    expect(parsed.d.topics).toEqual([])

    client.close()
  })
})
