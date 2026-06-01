import { describe, it, expect } from 'vitest'
import { parsePairingParams, parsePairingUrl, buildAdapterWsUrl } from '../lib/pairing'

const WS = 'wss://adapter.example.com/api/agent-chat/v1/socket'

describe('AIT-216 pairing client helpers', () => {
  it('parsePairingParams reads session/nonce/ws', () => {
    const p = parsePairingParams(`session=ps_1&nonce=abc&ws=${encodeURIComponent(WS)}`)
    expect(p).toEqual({ session: 'ps_1', nonce: 'abc', ws: WS })
  })

  it('parsePairingParams returns null when incomplete', () => {
    expect(parsePairingParams('session=ps_1&nonce=abc')).toBeNull()
    expect(parsePairingParams('')).toBeNull()
  })

  it('parsePairingUrl accepts a full pairing URL (QR decode / mobile)', () => {
    const url = `https://web.example.com/pair?session=ps_2&nonce=n2&ws=${encodeURIComponent(WS)}`
    expect(parsePairingUrl(url)).toEqual({ session: 'ps_2', nonce: 'n2', ws: WS })
  })

  it('parsePairingUrl accepts a raw query string (paste fallback)', () => {
    expect(parsePairingUrl(`?session=ps_3&nonce=n3&ws=${encodeURIComponent(WS)}`)).toEqual({ session: 'ps_3', nonce: 'n3', ws: WS })
  })

  it('parsePairingUrl rejects junk', () => {
    expect(parsePairingUrl('not a qr')).toBeNull()
    expect(parsePairingUrl('https://example.com/other')).toBeNull()
  })

  it('buildAdapterWsUrl appends access_token, value is the JWT (not in QR)', () => {
    const out = buildAdapterWsUrl(WS, 'jwt.abc.def')
    expect(out).toBe(`${WS}?access_token=jwt.abc.def`)
    expect(new URL(out).searchParams.get('access_token')).toBe('jwt.abc.def')
  })
})
