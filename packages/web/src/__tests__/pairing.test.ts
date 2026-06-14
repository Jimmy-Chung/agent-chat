import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parsePairingParams, parsePairingUrl, buildAdapterWsUrl, applyPairedConnection, savePairedDevice, updatePairedDeviceAdapterInstanceId, loadPairedDevice } from '../lib/pairing'

const WS = 'wss://adapter.example.com/api/agent-chat/v1/socket'

describe('AIT-216 pairing client helpers', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
    })
  })

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

  it('applyPairedConnection points the app adapter URL at the paired adapter (JWT embedded, token cleared)', () => {
    applyPairedConnection(WS, 'jwt.xyz')
    expect(localStorage.getItem('PI_ADAPTER_WSS_URL')).toBe(`${WS}?access_token=jwt.xyz`)
    expect(localStorage.getItem('PI_ADAPTER_TOKEN')).toBe('')
  })

  it('updates persisted paired adapterInstanceId after token exchange rebind', () => {
    savePairedDevice({
      deviceId: 'dev_1',
      deviceCredential: 'dc_1',
      adapterInstanceId: 'old_instance',
      adapterWssUrl: WS,
      pairedAt: '2026-06-14T00:00:00.000Z',
    })

    updatePairedDeviceAdapterInstanceId('new_instance')

    expect(loadPairedDevice()?.adapterInstanceId).toBe('new_instance')
  })
})
