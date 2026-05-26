import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AIT-175 — foreground reconnect: when a mobile browser/PWA returns to the
// foreground after the WS was torn down in the background, the client must
// reconnect immediately (skipping exponential backoff) rather than wait for the
// scheduled retry. These tests drive the real WsClient singleton with a mock
// WebSocket and assert the reconnect timing via the number of sockets opened.

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }

  // test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateBackgroundDrop(): void {
    // The OS closes the socket while the tab is hidden (code 1006 = abnormal).
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1006 })
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

// Imported after WebSocket is stubbed so the singleton uses the mock.
let getWsClient: typeof import('@/lib/ws-client').getWsClient

beforeEach(async () => {
  vi.useFakeTimers()
  MockWebSocket.instances = []
  setVisibility('visible')
  ;({ getWsClient } = await import('@/lib/ws-client'))
})

afterEach(() => {
  getWsClient().disconnect()
  vi.useRealTimers()
})

describe('WsClient — AIT-175 foreground reconnect', () => {
  it('reconnects immediately (skipping backoff) when the tab returns to foreground', () => {
    const client = getWsClient()
    client.connect({ wssUrl: 'wss://pi.example.com', piToken: 'tok' })
    expect(MockWebSocket.instances).toHaveLength(1)
    MockWebSocket.instances[0].simulateOpen()

    // Tab goes to background → OS drops the socket → backoff retry scheduled.
    setVisibility('hidden')
    MockWebSocket.instances[0].simulateBackgroundDrop()
    expect(MockWebSocket.instances).toHaveLength(1)

    // Return to foreground → reconnect must happen now, not after the timer.
    setVisibility('visible')
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('resets the backoff so the timer does not also fire a duplicate socket', () => {
    const client = getWsClient()
    client.connect({ wssUrl: 'wss://pi.example.com', piToken: 'tok' })
    MockWebSocket.instances[0].simulateOpen()
    MockWebSocket.instances[0].simulateBackgroundDrop()

    setVisibility('visible')
    expect(MockWebSocket.instances).toHaveLength(2)

    // The pending backoff timer should have been cleared by reconnectNow().
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('does not open a second socket when already connected', () => {
    const client = getWsClient()
    client.connect({ wssUrl: 'wss://pi.example.com', piToken: 'tok' })
    MockWebSocket.instances[0].simulateOpen()

    setVisibility('visible')
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('does not reconnect while the tab is hidden', () => {
    const client = getWsClient()
    client.connect({ wssUrl: 'wss://pi.example.com', piToken: 'tok' })
    MockWebSocket.instances[0].simulateOpen()
    MockWebSocket.instances[0].simulateBackgroundDrop()

    setVisibility('hidden')
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('stops listening for visibility changes after disconnect', () => {
    const client = getWsClient()
    client.connect({ wssUrl: 'wss://pi.example.com', piToken: 'tok' })
    MockWebSocket.instances[0].simulateOpen()
    client.disconnect()
    expect(MockWebSocket.instances).toHaveLength(1)

    setVisibility('visible')
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
