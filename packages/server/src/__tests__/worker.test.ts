import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../worker'
import { setupTestDb } from './db-helper'

describe('Worker HTTP endpoints', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  async function fetch(path: string, init?: RequestInit) {
    return worker.fetch(new Request(`http://localhost${path}`, init), env)
  }

  it('GET /healthz returns 200 with db connected', async () => {
    const res = await fetch('/healthz')
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; db: string; timestamp: number }
    expect(body.status).toBe('ok')
    expect(body.db).toBe('connected')
  })

  it('GET /debug returns 200 with config info', async () => {
    const res = await fetch('/debug')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.token).toBe('***')
    expect(body.initialized).toBe(true)
  })

  it('returns 404 for unknown paths (falls through to Hono)', async () => {
    const res = await fetch('/nonexistent')
    expect(res.status).toBe(404)
  })
})

describe('Worker WS upgrade auth', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  async function fetch(path: string, init?: RequestInit) {
    return worker.fetch(new Request(`http://localhost${path}`, init), env)
  }

  it('rejects upgrade without Sec-WebSocket-Key with 426', async () => {
    const res = await fetch('/ws')
    expect(res.status).toBe(426)
    const text = await res.text()
    expect(text).toContain('WebSocket')
  })

  it('rejects upgrade with invalid token with 401', async () => {
    const res = await fetch('/ws?token=wrong-token', {
      headers: { 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts WS upgrade with valid token (101)', async () => {
    const res = await fetch('/ws?token=test-token', {
      headers: {
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Upgrade: 'websocket',
      },
    })
    expect(res.status).toBe(101)
  })
})
