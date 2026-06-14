import { describe, expect, it } from 'vitest'
import { buildAdapterQueryParams } from '../lib/adapter-query'

function makeStorage(value: string | null): Storage {
  return {
    getItem: () => value,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: value ? 1 : 0,
  }
}

describe('adapter query params', () => {
  it('includes pairedAdapterWssUrl for paired HTTP proxy calls', () => {
    const params = buildAdapterQueryParams({
      wssUrl: 'wss://adapter.example.com/api/agent-chat/v1/socket?access_token=old',
      piToken: '',
    }, makeStorage(JSON.stringify({
      deviceCredential: 'dc_123',
      adapterInstanceId: 'adapter_old',
      adapterWssUrl: 'wss://adapter.example.com/api/agent-chat/v1/socket',
    })))

    expect(params.get('wssUrl')).toBe('wss://adapter.example.com/api/agent-chat/v1/socket?access_token=old')
    expect(params.get('deviceCredential')).toBe('dc_123')
    expect(params.get('adapterInstanceId')).toBe('adapter_old')
    expect(params.get('pairedAdapterWssUrl')).toBe('wss://adapter.example.com/api/agent-chat/v1/socket')
  })

  it('keeps legacy token params when no paired device exists', () => {
    const params = buildAdapterQueryParams({
      wssUrl: 'wss://adapter.example.com/api/agent-chat/v1/socket',
      piToken: 'legacy-token',
    }, makeStorage(null))

    expect(params.get('wssUrl')).toBe('wss://adapter.example.com/api/agent-chat/v1/socket')
    expect(params.get('piToken')).toBe('legacy-token')
    expect(params.has('pairedAdapterWssUrl')).toBe(false)
  })

  it('ignores corrupt paired device storage instead of dropping legacy params', () => {
    const params = buildAdapterQueryParams({
      wssUrl: 'wss://adapter.example.com/api/agent-chat/v1/socket',
      piToken: 'legacy-token',
    }, makeStorage('{bad json'))

    expect(params.get('wssUrl')).toBe('wss://adapter.example.com/api/agent-chat/v1/socket')
    expect(params.get('piToken')).toBe('legacy-token')
    expect(params.has('deviceCredential')).toBe(false)
  })
})
