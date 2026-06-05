import { describe, expect, it, vi } from 'vitest'
import { buildPiAdapterUrl, PiClient } from '../pi/client'
import type { AppConfig } from '../config'

function makeConfig(): AppConfig {
  return {
    token: 'test-token',
    piAdapterUrl: 'wss://pi-adapter.example.com/api/agent-chat/v1/socket',
    originalPiAdapterUrl: 'wss://pi-adapter.example.com/api/agent-chat/v1/socket',
    piAdapterToken: 'pi-token',
    artifactTokenSecret: 'artifact-secret',
    logLevel: 'info',
    r2: {
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: 'agent-chat-artifacts',
      publicUrl: '',
    },
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: 'mailto:test@example.com',
    webBaseUrl: '',
    attentionLlm: { apiKey: '', baseUrl: '', model: '' },
  }
}

describe('PiClient', () => {
  it('adds PI_ADAPTER_TOKEN as token query param for Worker WebSocket auth', () => {
    expect(
      buildPiAdapterUrl(
        'wss://pi-adapter.example.com/api/agent-chat/v1/socket',
        'secret-token',
      ),
    ).toBe(
      'wss://pi-adapter.example.com/api/agent-chat/v1/socket?token=secret-token',
    )
  })

  it('preserves existing query params and replaces stale token', () => {
    expect(
      buildPiAdapterUrl(
        'wss://pi-adapter.example.com/socket?env=prod&token=old',
        'new-token',
      ),
    ).toBe('wss://pi-adapter.example.com/socket?env=prod&token=new-token')
  })

  it('uses the routed lastSeq when reconnecting a stale session', async () => {
    const client = new PiClient(makeConfig())
    const connect = vi.fn().mockResolvedValue(undefined)
    const attach = vi.fn().mockResolvedValue({})
    const close = vi.fn()

    const staleConn = {
      isConnected: false,
      lastSeq: 99,
      close,
    }
    const freshConn = {
      connect,
      rpc: attach,
      on: vi.fn(),
      lastSeq: 0,
    }
    const sessions = (client as unknown as { sessions: Map<string, unknown> }).sessions
    sessions.set('sess-stale', staleConn)
    client.markSeqRouted('sess-stale', 42)
    vi.spyOn(client as unknown as { createSessionConn: (sessionId: string) => unknown }, 'createSessionConn')
      .mockReturnValue(freshConn)

    await client.reconnectSession('sess-stale')

    expect(close).toHaveBeenCalled()
    expect(connect).toHaveBeenCalled()
    expect(attach).toHaveBeenCalledWith('attachSession', { sessionId: 'sess-stale', lastSeq: 42 })
  })

  it('does not use an unpersisted session connection lastSeq for reconnect', async () => {
    const client = new PiClient(makeConfig())
    const connect = vi.fn().mockResolvedValue(undefined)
    const attach = vi.fn().mockResolvedValue({})
    const close = vi.fn()

    const staleConn = {
      isConnected: false,
      lastSeq: 99,
      close,
    }
    const freshConn = {
      connect,
      rpc: attach,
      on: vi.fn(),
      lastSeq: 0,
    }
    const sessions = (client as unknown as { sessions: Map<string, unknown> }).sessions
    sessions.set('sess-unrouted', staleConn)
    vi.spyOn(client as unknown as { createSessionConn: (sessionId: string) => unknown }, 'createSessionConn')
      .mockReturnValue(freshConn)

    await client.reconnectSession('sess-unrouted')

    expect(attach).toHaveBeenCalledWith('attachSession', { sessionId: 'sess-unrouted', lastSeq: 0 })
  })
})
