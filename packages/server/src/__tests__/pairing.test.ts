import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../worker'
import { setupTestDb } from './db-helper'
import { decodeJwt } from '../pairing/crypto'
import { getDeviceByCredentialHash, setDeviceRevoked } from '../pairing/store'
import { sha256Hex } from '../pairing/crypto'

const TOKEN = env.AGENT_CHAT_TOKEN || 'test-token'
const ADAPTER = 'adapter_test_1'
const WSS = 'wss://adapter.example.com/api/agent-chat/v1/socket'

function call(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://srv.example.com${path}`, init), env)
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function createSession(expiresInSeconds?: number) {
  const res = await call('/api/agent-chat/v1/pairing/sessions', {
    ...json({ adapterWssUrl: WSS, adapterInstanceId: ADAPTER, displayName: "Jimmy's Mac", frontendBaseUrl: 'https://web.example.com', ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}) }),
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  })
  return { res, body: await res.json() as any }
}

describe('AIT-216 device pairing API', () => {
  beforeAll(async () => { await setupTestDb() })

  it('TC-01: create session returns pairingUrl without token + desktopPollToken to adapter', async () => {
    const { res, body } = await createSession()
    expect(res.status).toBe(200)
    expect(body.pairingSessionId).toMatch(/^ps_/)
    expect(body.status).toBe('pending_scan')
    expect(body.pollIntervalMs).toBe(2000)
    expect(typeof body.expiresAt).toBe('string')
    expect(body.desktopPollToken).toBeTruthy()
    // pairingUrl carries session+nonce+ws, never any token
    expect(body.pairingUrl).toContain('/pair?session=')
    expect(body.pairingUrl).toContain('nonce=')
    expect(body.pairingUrl).toContain(encodeURIComponent(WSS))
    expect(body.pairingUrl).not.toContain(body.desktopPollToken)
    expect(body.pairingUrl).not.toContain(TOKEN)
  })

  it('create session rejects without server token', async () => {
    const res = await call('/api/agent-chat/v1/pairing/sessions', json({ adapterWssUrl: WSS, adapterInstanceId: ADAPTER }))
    expect(res.status).toBe(401)
  })

  it('TC-02: claim validates nonce, issues code, response has no code', async () => {
    const { body: s } = await createSession()
    const nonce = new URL(s.pairingUrl).searchParams.get('nonce')!

    const bad = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/claim`, json({ nonce: 'wrong' }))
    expect(bad.status).toBe(403)

    const ok = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/claim`, json({ nonce, deviceHint: { name: 'iPhone', platform: 'ios' } }))
    const okBody = await ok.json() as any
    expect(ok.status).toBe(200)
    expect(okBody.status).toBe('code_issued')
    expect(okBody.code).toBeUndefined()
    expect(okBody.verificationCode).toBeUndefined()
  })

  it('TC-03: desktop-status returns code only with valid desktopPollToken', async () => {
    const { body: s } = await createSession()
    const nonce = new URL(s.pairingUrl).searchParams.get('nonce')!
    await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/claim`, json({ nonce }))

    const noAuth = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`)
    expect(noAuth.status).toBe(401)
    const wrong = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`, { headers: { Authorization: 'Bearer nope' } })
    expect(wrong.status).toBe(401)

    const good = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`, { headers: { Authorization: `Bearer ${s.desktopPollToken}` } })
    const gb = await good.json() as any
    expect(good.status).toBe(200)
    expect(gb.status).toBe('code_issued')
    expect(gb.verificationCode).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('TC-04: verify — wrong code counts down, correct code pairs + issues deviceCredential, one-time', async () => {
    const { body: s } = await createSession()
    const nonce = new URL(s.pairingUrl).searchParams.get('nonce')!
    await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/claim`, json({ nonce, deviceHint: { name: 'iPhone', platform: 'ios' } }))
    const ds = await (await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`, { headers: { Authorization: `Bearer ${s.desktopPollToken}` } })).json() as any
    const code = ds.verificationCode

    const wrong = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/verify`, json({ code: 'ZZZZZZ' }))
    expect(wrong.status).toBe(400)
    expect((await wrong.json() as any).remainingAttempts).toBe(4)

    const ok = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/verify`, json({ code }))
    const okBody = await ok.json() as any
    expect(ok.status).toBe(200)
    expect(okBody.status).toBe('paired')
    expect(okBody.deviceCredential).toMatch(/^dc_/)
    expect(okBody.pairedDevice.id).toMatch(/^device_/)

    // one-time: re-verify now invalid_state
    const again = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/verify`, json({ code }))
    expect(again.status).toBe(409)
    // desktop-status now reports paired + pairedDevice
    const after = await (await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`, { headers: { Authorization: `Bearer ${s.desktopPollToken}` } })).json() as any
    expect(after.status).toBe('paired')
    expect(after.pairedDevice.platform).toBe('ios')
  })

  it('TC-05/06: devices/token mints RS256 JWT (claims correct), JWKS kid matches; revoked + mismatch rejected', async () => {
    const { body: s } = await createSession()
    const nonce = new URL(s.pairingUrl).searchParams.get('nonce')!
    await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/claim`, json({ nonce }))
    const ds = await (await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/desktop-status`, { headers: { Authorization: `Bearer ${s.desktopPollToken}` } })).json() as any
    const verified = await (await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/verify`, json({ code: ds.verificationCode }))).json() as any
    const cred = verified.deviceCredential

    // adapter mismatch
    const mism = await call('/api/agent-chat/v1/devices/token', json({ deviceCredential: cred, adapterInstanceId: 'other_adapter' }))
    expect(mism.status).toBe(403)

    // happy path
    const tokRes = await call('/api/agent-chat/v1/devices/token', json({ deviceCredential: cred, adapterInstanceId: ADAPTER }))
    const tok = await tokRes.json() as any
    expect(tokRes.status).toBe(200)
    expect(tok.expiresInSeconds).toBe(300)
    const { header, payload } = decodeJwt(tok.accessToken)
    expect(header.alg).toBe('RS256')
    expect(header.kid).toBeTruthy()
    expect(payload.aud).toBe(ADAPTER)
    expect(payload.sub).toBe(verified.pairedDevice.id)
    expect((payload.exp as number) - (payload.iat as number)).toBe(300)

    // JWKS contains the kid that signed the JWT
    const jwks = await (await call('/api/agent-chat/v1/.well-known/jwks.json')).json() as any
    expect(jwks.keys.some((k: any) => k.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256')).toBe(true)

    // revoke → mint rejected
    const device = await getDeviceByCredentialHash(await sha256Hex(cred))
    await setDeviceRevoked(device!.id, true)
    const revoked = await call('/api/agent-chat/v1/devices/token', json({ deviceCredential: cred, adapterInstanceId: ADAPTER }))
    expect(revoked.status).toBe(403)
  })

  it('TC-07: cancel → cancelled; expired session reports expired', async () => {
    const { body: s } = await createSession()
    const cancel = await call(`/api/agent-chat/v1/pairing/sessions/${s.pairingSessionId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${s.desktopPollToken}` } })
    expect((await cancel.json() as any).status).toBe('cancelled')

    const { body: s2 } = await createSession(-5) // already expired
    const nonce = new URL(s2.pairingUrl).searchParams.get('nonce')!
    const claim = await call(`/api/agent-chat/v1/pairing/sessions/${s2.pairingSessionId}/claim`, json({ nonce }))
    expect(claim.status).toBe(410)
  })
})
