import { describe, it, expect } from 'vitest'
import {
  didPiAdapterConfigChange,
  setAccessTokenParam,
  stripAdapterAuthParams,
} from '../pi/client'
import type { AppConfig } from '../config'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    token: 'test-token',
    piAdapterUrl: 'wss://adapter.example.com/api/socket',
    originalPiAdapterUrl: 'wss://adapter.example.com/api/socket',
    piAdapterToken: '',
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

describe('setAccessTokenParam — adapter WS JWT refresh', () => {
  it('appends access_token when the URL has no query params', () => {
    const out = setAccessTokenParam('wss://adapter.example.com/api/socket', 'JWT1')
    expect(out).toBe('wss://adapter.example.com/api/socket?access_token=JWT1')
  })

  it('appends with & when the URL already has other params', () => {
    const out = setAccessTokenParam('wss://adapter.example.com/api/socket?foo=bar', 'JWT1')
    expect(out).toBe('wss://adapter.example.com/api/socket?foo=bar&access_token=JWT1')
  })

  it('replaces an existing (expired) access_token rather than duplicating it', () => {
    const out = setAccessTokenParam(
      'wss://adapter.example.com/api/socket?access_token=OLD_EXPIRED',
      'JWT_FRESH',
    )
    expect(out).toBe('wss://adapter.example.com/api/socket?access_token=JWT_FRESH')
    expect(out.match(/access_token=/g)).toHaveLength(1)
  })

  it('replaces access_token while preserving other params', () => {
    const out = setAccessTokenParam(
      'wss://adapter.example.com/api/socket?access_token=OLD&foo=bar',
      'JWT_FRESH',
    )
    expect(out).toContain('foo=bar')
    expect(out).toContain('access_token=JWT_FRESH')
    expect(out.match(/access_token=/g)).toHaveLength(1)
  })

  it('url-encodes the JWT', () => {
    const out = setAccessTokenParam('wss://adapter.example.com/s', 'a.b/c+d=')
    expect(out).toBe('wss://adapter.example.com/s?access_token=a.b%2Fc%2Bd%3D')
  })

  it('inserts access_token before a URL hash', () => {
    const out = setAccessTokenParam('wss://adapter.example.com/s#hash', 'JWT')
    expect(out).toBe('wss://adapter.example.com/s?access_token=JWT#hash')
  })
})

describe('didPiAdapterConfigChange — JWT rotation identity', () => {
  it('strips adapter auth params without URL parsing', () => {
    expect(stripAdapterAuthParams('wss://adapter.example.com/s?foo=1&access_token=OLD&token=debug#hash'))
      .toBe('wss://adapter.example.com/s?foo=1#hash')
  })

  it('does not treat paired JIT JWT rotation as PI config change', () => {
    const prev = makeConfig({
      piAdapterUrl: 'wss://adapter.example.com/api/socket?foo=bar&access_token=OLD',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
    })
    const next = makeConfig({
      piAdapterUrl: 'wss://adapter.example.com/api/socket?foo=bar&access_token=NEW',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
    })

    expect(didPiAdapterConfigChange(prev, next)).toBe(false)
  })

  it('still detects real paired adapter URL changes', () => {
    const prev = makeConfig({
      piAdapterUrl: 'wss://adapter-a.example.com/api/socket?access_token=OLD',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
    })
    const next = makeConfig({
      piAdapterUrl: 'wss://adapter-b.example.com/api/socket?access_token=NEW',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
    })

    expect(didPiAdapterConfigChange(prev, next)).toBe(true)
  })

  it('treats paired adapterInstanceId changes as PI config changes', () => {
    const prev = makeConfig({
      piAdapterUrl: 'wss://adapter.example.com/api/socket?access_token=OLD',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_live',
    })
    const next = makeConfig({
      piAdapterUrl: 'wss://adapter.example.com/api/socket?access_token=OLD',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_old',
    })

    expect(didPiAdapterConfigChange(prev, next)).toBe(true)
  })

  it('still detects manual debug token changes', () => {
    const prev = makeConfig({ piAdapterToken: 'old-debug-token' })
    const next = makeConfig({ piAdapterToken: 'new-debug-token' })

    expect(didPiAdapterConfigChange(prev, next)).toBe(true)
  })

  it('detects server origin changes because paired JWT issuer changes', () => {
    const prev = makeConfig({
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
      serverOrigin: 'https://old.example.com',
    })
    const next = makeConfig({
      deviceCredential: 'dc_1',
      adapterInstanceId: 'adapter_1',
      serverOrigin: 'https://new.example.com',
    })

    expect(didPiAdapterConfigChange(prev, next)).toBe(true)
  })

  it('keeps URL token changes meaningful on unpaired legacy config', () => {
    const prev = makeConfig({ piAdapterUrl: 'wss://adapter.example.com/api/socket?token=old' })
    const next = makeConfig({ piAdapterUrl: 'wss://adapter.example.com/api/socket?token=new' })

    expect(didPiAdapterConfigChange(prev, next)).toBe(true)
  })
})
