import { describe, it, expect, beforeAll, vi } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../worker'
import { setupTestDb } from './db-helper'
import { createDevice, getDeviceByCredentialHash, setDeviceRevoked } from '../pairing/store'
import { sha256Hex, randomToken, decodeJwt } from '../pairing/crypto'
import { JIT_JWT_TTL_SECONDS } from '../pairing/routes'

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

describe('FEAT-036: provider proxy endpoint', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  async function fetch(path: string, init?: RequestInit) {
    return worker.fetch(new Request(`http://localhost${path}`, init), env)
  }

  it('maps PI WSS URL to adapter providers HTTP endpoint', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify([{ id: 'provider-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await fetch(
      '/api/agent-chat/v1/providers?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket&piToken=pi-secret&group=universal',
      { headers: { Authorization: 'Bearer test-token' } },
    )

    expect(res.status).toBe(200)
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(calledUrl).toBe('https://pi.example.com/api/agent-chat/v1/providers?group=universal')
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer pi-secret')

    restore()
  })

  it('uses access_token from paired adapter WSS URL when piToken is empty', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify([{ id: 'provider-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const wssUrl = encodeURIComponent('wss://pi.example.com/api/agent-chat/v1/socket?access_token=device-jwt')
    const res = await fetch(
      `/api/agent-chat/v1/providers?wssUrl=${wssUrl}&group=universal`,
      { headers: { Authorization: 'Bearer test-token' } },
    )

    expect(res.status).toBe(200)
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(calledUrl).toBe('https://pi.example.com/api/agent-chat/v1/providers?group=universal')
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer device-jwt')

    restore()
  })

  it('passes through non-JSON adapter errors instead of returning proxy 500', async () => {
    const restore = mockHealthz(
      new Response('error code: 1033', {
        status: 530,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      }),
    )

    const res = await fetch(
      '/api/agent-chat/v1/providers?wssUrl=wss://pi-adapter.jimmy-jam.com/api/agent-chat/v1/socket&piToken=1234&group=universal',
      { headers: { Authorization: 'Bearer test-token' } },
    )

    expect(res.status).toBe(530)
    expect(res.headers.get('content-type')).toContain('text/plain')
    await expect(res.text()).resolves.toBe('error code: 1033')

    restore()
  })

  it('maps PI WSS URL to adapter workspace HTTP endpoint', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify({ workspacePath: '/Users/test/Desktop/workspace', subDirList: ['agent-chat'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await fetch(
      '/api/agent-chat/v1/workspace?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket&piToken=pi-secret',
      { headers: { Authorization: 'Bearer test-token' } },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { workspacePath: string; subDirList: string[] }
    expect(body.workspacePath).toBe('/Users/test/Desktop/workspace')
    expect(body.subDirList).toEqual(['agent-chat'])
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(calledUrl).toBe('https://pi.example.com/api/agent-chat/v1/workspace')
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer pi-secret')

    restore()
  })

  it('signs a JIT JWT when deviceCredential + adapterInstanceId are provided', async () => {
    const credential = randomToken(24)
    const adapterId = 'adapter_jit_test'
    await createDevice({
      adapterInstanceId: adapterId,
      name: 'Test Device',
      platform: 'web',
      credentialHash: await sha256Hex(credential),
      scopes: ['agent:control', 'workspace:preview'],
      pairingSessionId: 'ps_test_jit',
    })

    const restore = mockHealthz(
      new Response(JSON.stringify([{ id: 'provider-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const qs = new URLSearchParams({
      wssUrl: 'wss://pi.example.com/api/agent-chat/v1/socket',
      deviceCredential: credential,
      adapterInstanceId: adapterId,
      group: 'universal',
    })
    const res = await fetch(`/api/agent-chat/v1/providers?${qs}`, {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    const authHeader = (calledInit.headers as Record<string, string>)['Authorization']
    expect(authHeader).toMatch(/^Bearer eyJ/)

    const { payload } = decodeJwt(authHeader.slice(7))
    expect(payload.aud).toBe(adapterId)
    expect(payload.scope).toContain('agent:control')
    expect(typeof payload.exp).toBe('number')
    expect(payload.exp as number - (payload.iat as number)).toBe(JIT_JWT_TTL_SECONDS)
    expect(payload.exp as number - (payload.iat as number)).toBe(300)

    restore()
  })

  it('rebinds JIT JWT audience to the live adapter instance id from adapter-status', async () => {
    const credential = randomToken(24)
    const oldAdapterId = 'adapter_jit_old'
    const liveAdapterId = 'adapter_jit_live'
    await createDevice({
      adapterInstanceId: oldAdapterId,
      name: 'Test Device',
      platform: 'web',
      credentialHash: await sha256Hex(credential),
      scopes: ['agent:control', 'workspace:preview'],
      pairingSessionId: 'ps_test_jit_rebind',
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = vi.fn(async (url: Parameters<typeof globalThis.fetch>[0]) => {
        if (String(url).endsWith('/adapter-status')) {
          return new Response(JSON.stringify({ adapterInstanceId: liveAdapterId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify([{ id: 'provider-1' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch

      const qs = new URLSearchParams({
        wssUrl: 'wss://pi.example.com/api/agent-chat/v1/socket?access_token=old-jwt',
        pairedAdapterWssUrl: 'wss://pi.example.com/api/agent-chat/v1/socket',
        deviceCredential: credential,
        adapterInstanceId: oldAdapterId,
        group: 'universal',
      })
      const res = await fetch(`/api/agent-chat/v1/providers?${qs}`, {
        headers: { Authorization: 'Bearer test-token' },
      })

      expect(res.status).toBe(200)
      const providerCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url]) => String(url).includes('/providers?'),
      )
      const authHeader = ((providerCall?.[1] as RequestInit).headers as Record<string, string>)['Authorization']
      const { payload } = decodeJwt(authHeader.slice(7))
      expect(payload.aud).toBe(liveAdapterId)
      const updatedDevice = await getDeviceByCredentialHash(await sha256Hex(credential))
      expect(updatedDevice?.adapter_instance_id).toBe(liveAdapterId)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns 401 when deviceCredential is invalid', async () => {
    const res = await fetch(
      '/api/agent-chat/v1/providers?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket&deviceCredential=bad-cred&adapterInstanceId=adapter_jit_test',
      { headers: { Authorization: 'Bearer test-token' } },
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when device is revoked', async () => {
    const credential = randomToken(24)
    const adapterId = 'adapter_jit_revoked'
    const device = await createDevice({
      adapterInstanceId: adapterId,
      name: 'Revoked Device',
      platform: 'web',
      credentialHash: await sha256Hex(credential),
      scopes: ['agent:control'],
      pairingSessionId: 'ps_test_revoked',
    })
    await setDeviceRevoked(device.id, true)

    const qs = new URLSearchParams({
      wssUrl: 'wss://pi.example.com/api/agent-chat/v1/socket',
      deviceCredential: credential,
      adapterInstanceId: adapterId,
    })
    const res = await fetch(`/api/agent-chat/v1/providers?${qs}`, {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(res.status).toBe(401)
  })

  it('returns reachable=true when adapter-status upstream is healthy', async () => {
    const restore = mockHealthz(
      new Response(JSON.stringify({ version: '1.9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await fetch('/api/agent-chat/v1/adapter-status?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket')
    const body = await res.json() as { version: string; reachable: boolean }

    expect(body.version).toBe('1.9.9')
    expect(body.reachable).toBe(true)

    restore()
  })

  it('returns reachable=false with HTTP status when adapter-status upstream fails', async () => {
    const restore = mockHealthz(
      new Response('bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      }),
    )

    const res = await fetch('/api/agent-chat/v1/adapter-status?wssUrl=wss://pi.example.com/api/agent-chat/v1/socket')
    const body = await res.json() as { version: string; reachable: boolean; lastError: string }

    expect(body.version).toBe('unknown')
    expect(body.reachable).toBe(false)
    expect(body.lastError).toBe('HTTP 502')

    restore()
  })
})
