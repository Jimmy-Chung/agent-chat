import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { setupTestDb } from './db-helper'

function getStub(name: string) {
  const id = env.TOPIC_DO.idFromName(name)
  return env.TOPIC_DO.get(id)
}

describe('TopicDurableObject — fetch routing', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  it('accepts WS upgrade for /ws', async () => {
    const stub = getStub('routing-ws')

    const res = await stub.fetch(
      new Request('http://localhost/ws', {
        headers: {
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          Upgrade: 'websocket',
        },
      }),
    )
    // Without config set, token check is skipped; DO should accept any token
    expect(res.status).toBe(101)
  })

  it('returns 404 for non-/ws paths', async () => {
    const stub = getStub('routing-404')
    const res = await stub.fetch(new Request('http://localhost/something-else'))
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).toBe('Not Found')
  })
})
