import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../pairing/routes', () => ({
  issueJitJwt: vi.fn(),
}))

import { buildPiAdapterUrl, PiClient } from '../pi/client'
import { issueJitJwt } from '../pairing/routes'
import type { AppConfig } from '../config'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  }
}

describe('PiClient', () => {
  beforeEach(() => {
    vi.mocked(issueJitJwt).mockReset()
  })

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

  it('uses a fresh paired JWT for createSession without mutating stored config', async () => {
    vi.mocked(issueJitJwt).mockResolvedValue('JWT_FRESH')
    const config = makeConfig({
      piAdapterUrl: 'wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=OLD',
      piAdapterToken: '',
      deviceCredential: 'dc_123',
      adapterInstanceId: 'adapter_123',
      serverOrigin: 'https://agent-chat.example.com',
    })
    const client = new PiClient(config)
    const conn = {
      connect: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockResolvedValue({ sessionId: 'sess-created' }),
      on: vi.fn(),
      close: vi.fn(),
      lastSeq: 0,
    }
    const createSessionConn = vi.spyOn(
      client as unknown as { createSessionConn: (sessionId: string, adapterUrl?: string) => unknown },
      'createSessionConn',
    ).mockReturnValue(conn)

    await client.createSession({ kind: 'general', general: {} })

    expect(issueJitJwt).toHaveBeenCalledWith('dc_123', 'adapter_123', 'https://agent-chat.example.com')
    expect(createSessionConn).toHaveBeenCalledWith(
      expect.any(String),
      'wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=JWT_FRESH',
    )
    expect(config.piAdapterUrl).toBe('wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=OLD')
    expect(conn.rpc).toHaveBeenCalledWith('createSession', { kind: 'general', general: {} })
  })

  it('uses a fresh paired JWT for rpcGlobal transient connections', async () => {
    vi.mocked(issueJitJwt).mockResolvedValue('JWT_GLOBAL')
    const config = makeConfig({
      piAdapterUrl: 'wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=OLD',
      piAdapterToken: '',
      deviceCredential: 'dc_123',
      adapterInstanceId: 'adapter_123',
      serverOrigin: 'https://agent-chat.example.com',
    })
    const client = new PiClient(config)
    const conn = {
      connect: vi.fn().mockResolvedValue(undefined),
      rpc: vi.fn().mockResolvedValue([{ id: 'provider-1' }]),
      on: vi.fn(),
      close: vi.fn(),
      lastSeq: 0,
    }
    const createSessionConn = vi.spyOn(
      client as unknown as { createSessionConn: (sessionId: string, adapterUrl?: string) => unknown },
      'createSessionConn',
    ).mockReturnValue(conn)

    const result = await client.rpcGlobal('listProviderConfigs', {})

    expect(result).toEqual([{ id: 'provider-1' }])
    expect(createSessionConn).toHaveBeenCalledWith(
      expect.stringMatching(/^global-/),
      'wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=JWT_GLOBAL',
    )
    expect(conn.connect).toHaveBeenCalled()
    expect(conn.rpc).toHaveBeenCalledWith('listProviderConfigs', {})
    expect(conn.close).toHaveBeenCalled()
    expect(config.piAdapterUrl).toBe('wss://pi-adapter.example.com/api/agent-chat/v1/socket?access_token=OLD')
  })
})
