import { describe, it, expect, vi, beforeEach } from 'vitest'

// push-client uses browser APIs — mock them here
const mockRegister = vi.fn()
const mockFetch = vi.fn()

vi.stubGlobal('navigator', {
  serviceWorker: {
    register: mockRegister,
  },
})
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'))

import {
  registerServiceWorker,
  getVapidPublicKey,
  saveSubscriptionToServer,
} from '../lib/push-client'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerServiceWorker', () => {
  it('registers /sw.js and returns registration', async () => {
    const fakeReg = { scope: '/' }
    mockRegister.mockResolvedValue(fakeReg)
    const result = await registerServiceWorker()
    expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(result).toBe(fakeReg)
  })

  it('returns null on registration error', async () => {
    mockRegister.mockRejectedValue(new Error('SW not supported'))
    const result = await registerServiceWorker()
    expect(result).toBeNull()
  })
})

describe('getVapidPublicKey', () => {
  it('returns publicKey from server', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ publicKey: 'BBBBB' }),
    })
    const key = await getVapidPublicKey('http://localhost:8080')
    expect(key).toBe('BBBBB')
  })

  it('returns null when server responds with error', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const key = await getVapidPublicKey('http://localhost:8080')
    expect(key).toBeNull()
  })

  it('returns null on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const key = await getVapidPublicKey('http://localhost:8080')
    expect(key).toBeNull()
  })
})

describe('saveSubscriptionToServer', () => {
  const fakeSub = {
    endpoint: 'https://push.example.com/sub/1',
    toJSON: () => ({ keys: { p256dh: 'P256', auth: 'AUTH' } }),
  } as unknown as PushSubscription

  it('POSTs subscription and returns true on success', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const ok = await saveSubscriptionToServer(fakeSub, 'http://localhost:8080', 'tok')
    expect(ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/push/subscribe',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    )
  })

  it('returns false when server responds with error', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const ok = await saveSubscriptionToServer(fakeSub, 'http://localhost:8080', 'tok')
    expect(ok).toBe(false)
  })

  it('returns false on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const ok = await saveSubscriptionToServer(fakeSub, 'http://localhost:8080', 'tok')
    expect(ok).toBe(false)
  })
})
