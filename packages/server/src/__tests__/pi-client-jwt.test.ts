import { describe, it, expect } from 'vitest'
import { setAccessTokenParam } from '../pi/client'

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
})
