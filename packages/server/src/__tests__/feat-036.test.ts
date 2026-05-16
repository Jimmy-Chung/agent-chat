import { describe, it, expect, beforeAll, vi } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../worker'
import { setupTestDb } from './db-helper'

// ─── Mock helpers ────────────────────────────────────────────────────────

function mockHealthz(fetchResponse: Response) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn().mockResolvedValue(fetchResponse)
  return () => { globalThis.fetch = originalFetch }
}

// ─── /pi-healthz proxy endpoint (TC-036-07, TC-036-08) ──────────────────

describe('FEAT-036: /pi-healthz proxy endpoint', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  async function fetch(path: string) {
    return worker.fetch(new Request(`http://localhost${path}`), env)
  }

  it('returns 400 when wssUrl is missing', async () => {
    const res = await fetch('/pi-healthz')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('wssUrl')
  })

  it('returns 400 for invalid wssUrl', async () => {
    const res = await fetch('/pi-healthz?wssUrl=not-a-url')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('Invalid')
  })

  it('proxies to PI adapter healthz + WS probe (TC-036-07)', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await fetch('/pi-healthz?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket')
    const body = await res.json() as { ok: boolean }

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe('https://pi.example.com/healthz')
    expect(body.ok).toBe(true)

    restore()
  })

  it('passes Authorization header when piToken provided', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await fetch('/pi-healthz?wssUrl=wss://pi.example.com/socket&piToken=my-secret')

    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret')

    restore()
  })

  it('returns 502 when PI adapter unreachable (TC-036-08)', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await fetch('/pi-healthz?wssUrl=wss://unreachable.example.com/socket')
    expect(res.status).toBe(502)
    const body = await res.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)

    globalThis.fetch = originalFetch
  })

  it('derives http:// from ws:// URL', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    )

    await fetch('/pi-healthz?wssUrl=ws://localhost:7331/api/agent-chat/v1/socket')

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:7331/healthz')

    restore()
  })
})

// ─── WS upgrade PI config override (TC part of Step 2) ──────────────

describe('FEAT-036: WS upgrade reads PI config from URL params', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  async function fetch(path: string, init?: RequestInit) {
    return worker.fetch(new Request(`http://localhost${path}`, init), env)
  }

  it('accepts WS upgrade with valid token + PI config params', async () => {
    const res = await fetch(
      '/ws?token=test-token&piWssUrl=wss://custom.example.com/socket&piToken=custom-token',
      { headers: { 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Upgrade: 'websocket' } },
    )
    // 101 = successful WS upgrade — PI config params are read and passed to DO
    expect(res.status).toBe(101)
  })

  it('still rejects invalid token even with PI config', async () => {
    const res = await fetch(
      '/ws?token=wrong-token&piWssUrl=wss://custom.example.com/socket',
      { headers: { 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } },
    )
    expect(res.status).toBe(401)
  })
})
