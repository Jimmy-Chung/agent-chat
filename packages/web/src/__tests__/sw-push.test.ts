import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// AIT-175 — exercises the real public/sw.js push + notificationclick handlers in
// a constructed Service Worker scope (`self`, `clients` injected as params).
// Covers foreground de-dup (don't pop a notification over a visible window) and
// topic routing on click (focus + postMessage, or openWindow as fallback).

// vitest runs with cwd = packages/web; sw.js lives in this package's public/.
const SW_SRC = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8')
const ORIGIN = 'https://app.example.com'

type Handlers = Record<string, (event: unknown) => void>

function loadSw() {
  const handlers: Handlers = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue([])

  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers[type] = fn
    },
    registration: { showNotification },
    location: { origin: ORIGIN },
  }
  const clients = { matchAll, openWindow }

  // eslint-disable-next-line no-new-func
  new Function('self', 'clients', SW_SRC)(self, clients)

  return { handlers, showNotification, openWindow, matchAll, clients }
}

function makeWindow(visibilityState: 'visible' | 'hidden', url = `${ORIGIN}/`) {
  return {
    url,
    visibilityState,
    focus: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
  }
}

async function firePush(handlers: Handlers, body: unknown) {
  let waited: Promise<unknown> | undefined
  const event = {
    data: body === undefined ? null : { json: () => body, text: () => '' },
    waitUntil: (p: Promise<unknown>) => {
      waited = p
    },
  }
  handlers.push(event)
  await waited
}

async function fireClick(handlers: Handlers, url: string | undefined) {
  let waited: Promise<unknown> | undefined
  const event = {
    notification: { close: vi.fn(), data: url === undefined ? {} : { url } },
    waitUntil: (p: Promise<unknown>) => {
      waited = p
    },
  }
  handlers.notificationclick(event)
  await waited
}

describe('sw.js push — foreground de-dup', () => {
  let sw: ReturnType<typeof loadSw>
  beforeEach(() => {
    sw = loadSw()
  })

  it('shows a notification when no window is open', async () => {
    sw.matchAll.mockResolvedValue([])
    await firePush(sw.handlers, {
      title: 'agent-chat',
      body: 'hi',
      tag: 't',
      url: '/?topic=abc',
    })
    expect(sw.showNotification).toHaveBeenCalledTimes(1)
    expect(sw.showNotification).toHaveBeenCalledWith(
      'agent-chat',
      expect.objectContaining({
        body: 'hi',
        tag: 't',
        data: { url: '/?topic=abc' },
      }),
    )
  })

  it('shows a notification when the only window is hidden (backgrounded)', async () => {
    sw.matchAll.mockResolvedValue([makeWindow('hidden')])
    await firePush(sw.handlers, { title: 'agent-chat', body: 'hi' })
    expect(sw.showNotification).toHaveBeenCalledTimes(1)
  })

  it('suppresses the notification when a visible window exists (foreground)', async () => {
    sw.matchAll.mockResolvedValue([makeWindow('hidden'), makeWindow('visible')])
    await firePush(sw.handlers, { title: 'agent-chat', body: 'hi' })
    expect(sw.showNotification).not.toHaveBeenCalled()
  })

  it('ignores push events with no data', async () => {
    await firePush(sw.handlers, undefined)
    expect(sw.showNotification).not.toHaveBeenCalled()
    expect(sw.matchAll).not.toHaveBeenCalled()
  })
})

describe('sw.js notificationclick — topic routing', () => {
  let sw: ReturnType<typeof loadSw>
  beforeEach(() => {
    sw = loadSw()
  })

  it('focuses an existing same-origin window and posts the navigate message', async () => {
    const win = makeWindow('hidden', `${ORIGIN}/`)
    sw.matchAll.mockResolvedValue([win])
    await fireClick(sw.handlers, '/?topic=abc')
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(win.postMessage).toHaveBeenCalledWith({
      type: 'agent-chat:navigate',
      topic: 'abc',
    })
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when none is open', async () => {
    sw.matchAll.mockResolvedValue([])
    await fireClick(sw.handlers, '/?topic=abc')
    expect(sw.openWindow).toHaveBeenCalledWith('/?topic=abc')
  })

  it('does not post a navigate message when the url carries no topic', async () => {
    const win = makeWindow('visible', `${ORIGIN}/`)
    sw.matchAll.mockResolvedValue([win])
    await fireClick(sw.handlers, '/')
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(win.postMessage).not.toHaveBeenCalled()
  })

  it('skips cross-origin windows and opens a new one', async () => {
    const foreign = makeWindow('visible', 'https://evil.example.net/')
    sw.matchAll.mockResolvedValue([foreign])
    await fireClick(sw.handlers, '/?topic=abc')
    expect(foreign.focus).not.toHaveBeenCalled()
    expect(sw.openWindow).toHaveBeenCalledWith('/?topic=abc')
  })
})
