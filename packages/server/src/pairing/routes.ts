// Device pairing HTTP API (AIT-216). Mounted on the main Hono app.
//
// Topology: phone/browser pairs here, then connects DIRECTLY to the adapter WSS
// with a short-lived RS256 JWT minted by /devices/token and verified offline by
// the adapter via /.well-known/jwks.json. See AIT-208 「讨论结论」.
import { Hono } from 'hono'
import type { AppConfig } from '../config'
import { logger } from '../logger'
import {
  randomToken,
  randomCode,
  sha256Hex,
  signJwt,
  publicJwkEntry,
} from './crypto'
import {
  createPairingSession,
  getPairingSession,
  updatePairingSession,
  createDevice,
  getDeviceByCredentialHash,
  getActiveSigningKey,
  listActiveSigningKeys,
  type PairingSession,
} from './store'

const POLL_INTERVAL_MS = 2000
const SESSION_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MAX_MS = 10 * 60 * 1000
const CODE_TTL_MS = 3 * 60 * 1000
const MAX_CODE_ATTEMPTS = 5
const JWT_TTL_SECONDS = 300
const DEFAULT_SCOPES = ['agent:control', 'workspace:preview']

function bearer(authHeader: string | undefined): string | undefined {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
}

function isExpired(s: PairingSession): boolean {
  return Date.now() > s.expires_at
}

// Lazily transition a stale session to `expired` (only from non-terminal states).
async function loadLive(id: string): Promise<PairingSession | null> {
  const s = await getPairingSession(id)
  if (!s) return null
  if (isExpired(s) && ['pending_scan', 'scanned', 'code_issued'].includes(s.status)) {
    await updatePairingSession(id, { status: 'expired' })
    return { ...s, status: 'expired' }
  }
  return s
}

export function createPairingRoutes(getConfig: () => AppConfig | null): Hono {
  const app = new Hono()

  // ── adapter → server: create pairing session ──────────────────────
  app.post('/api/agent-chat/v1/pairing/sessions', async (c) => {
    const cfg = getConfig()
    if (cfg?.token && bearer(c.req.header('Authorization')) !== cfg.token) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
    const adapterWssUrl = typeof body.adapterWssUrl === 'string' ? body.adapterWssUrl : ''
    const adapterInstanceId = typeof body.adapterInstanceId === 'string' ? body.adapterInstanceId : ''
    if (!adapterWssUrl || !adapterInstanceId) {
      return c.json({ error: 'adapterWssUrl and adapterInstanceId are required' }, 400)
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName : null
    const ttlMs = Math.min(
      typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds * 1000 : SESSION_TTL_MS,
      SESSION_TTL_MAX_MS,
    )
    const nonce = randomToken(16)
    const desktopPollToken = randomToken(32)
    const expiresAt = Date.now() + ttlMs
    const session = await createPairingSession({
      adapterInstanceId,
      adapterWssUrl,
      displayName,
      nonce,
      desktopPollTokenHash: await sha256Hex(desktopPollToken),
      expiresAt,
    })

    const frontendBase =
      (typeof body.frontendBaseUrl === 'string' && body.frontendBaseUrl) ||
      cfg?.webBaseUrl ||
      new URL(c.req.url).origin
    const pairingUrl =
      `${frontendBase.replace(/\/+$/, '')}/pair?session=${encodeURIComponent(session.id)}` +
      `&nonce=${encodeURIComponent(nonce)}&ws=${encodeURIComponent(adapterWssUrl)}`

    return c.json({
      pairingSessionId: session.id,
      pairingUrl,
      status: 'pending_scan',
      expiresAt: new Date(expiresAt).toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
      desktopPollToken, // only returned to the adapter; never in the QR/pairingUrl
    })
  })

  // ── phone/browser → server: claim (scanned) + issue verification code ──
  app.post('/api/agent-chat/v1/pairing/sessions/:id/claim', async (c) => {
    const session = await loadLive(c.req.param('id'))
    if (!session) return c.json({ error: 'not_found' }, 404)
    if (session.status === 'expired') return c.json({ pairingSessionId: session.id, status: 'expired' }, 410)
    if (!['pending_scan', 'scanned', 'code_issued'].includes(session.status)) {
      return c.json({ error: 'invalid_state', status: session.status }, 409)
    }
    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
    if (typeof body.nonce !== 'string' || body.nonce !== session.nonce) {
      return c.json({ error: 'invalid_nonce' }, 403)
    }
    const hint = (body.deviceHint && typeof body.deviceHint === 'object') ? body.deviceHint as Record<string, unknown> : {}
    const code = randomCode(6)
    await updatePairingSession(session.id, {
      status: 'code_issued',
      device_hint: JSON.stringify({ name: hint.name ?? null, platform: hint.platform ?? null }),
      verification_code: code,
      code_expires_at: Date.now() + CODE_TTL_MS,
      code_attempts: 0,
    })
    // NOTE: deliberately does NOT return the code — only the desktop can read it.
    return c.json({ pairingSessionId: session.id, status: 'code_issued' })
  })

  // ── adapter → server: desktop status (reads the verification code) ──
  app.get('/api/agent-chat/v1/pairing/sessions/:id/desktop-status', async (c) => {
    const session = await loadLive(c.req.param('id'))
    if (!session) return c.json({ error: 'not_found' }, 404)
    const token = bearer(c.req.header('Authorization'))
    if (!token || (await sha256Hex(token)) !== session.desktop_poll_token_hash) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const out: Record<string, unknown> = {
      pairingSessionId: session.id,
      status: session.status,
      expiresAt: new Date(session.expires_at).toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
    }
    if (session.status === 'code_issued' && session.verification_code && session.code_expires_at && Date.now() <= session.code_expires_at) {
      out.verificationCode = session.verification_code
      out.codeExpiresAt = new Date(session.code_expires_at).toISOString()
    }
    if (session.status === 'paired' && session.paired_device_id) {
      const hint = session.device_hint ? JSON.parse(session.device_hint) : {}
      out.pairedDevice = {
        id: session.paired_device_id,
        name: hint.name ?? null,
        platform: hint.platform ?? null,
        pairedAt: new Date(session.updated_at).toISOString(),
      }
    }
    return c.json(out)
  })

  // ── phone/browser → server: verify code → issue long-lived deviceCredential ──
  app.post('/api/agent-chat/v1/pairing/sessions/:id/verify', async (c) => {
    const session = await loadLive(c.req.param('id'))
    if (!session) return c.json({ error: 'not_found' }, 404)
    if (session.status === 'expired') return c.json({ status: 'expired' }, 410)
    if (session.status !== 'code_issued') return c.json({ error: 'invalid_state', status: session.status }, 409)
    if (session.code_expires_at && Date.now() > session.code_expires_at) {
      return c.json({ error: 'code_expired' }, 400)
    }
    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
    const submitted = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''

    const attempts = session.code_attempts + 1
    if (submitted !== (session.verification_code ?? '')) {
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await updatePairingSession(session.id, { status: 'error', code_attempts: attempts, verification_code: null })
        return c.json({ error: 'too_many_attempts' }, 429)
      }
      await updatePairingSession(session.id, { code_attempts: attempts })
      return c.json({ error: 'invalid_code', remainingAttempts: MAX_CODE_ATTEMPTS - attempts }, 400)
    }

    const hint = session.device_hint ? JSON.parse(session.device_hint) as { name?: string; platform?: string } : {}
    const deviceCredential = `dc_${randomToken(32)}`
    const device = await createDevice({
      adapterInstanceId: session.adapter_instance_id,
      name: hint.name ?? null,
      platform: hint.platform ?? null,
      credentialHash: await sha256Hex(deviceCredential),
      scopes: DEFAULT_SCOPES,
      pairingSessionId: session.id,
    })
    await updatePairingSession(session.id, {
      status: 'paired',
      paired_device_id: device.id,
      verification_code: null,
    })

    return c.json({
      status: 'paired',
      deviceCredential, // long-lived; held by web, exchanged at /devices/token
      pairedDevice: {
        id: device.id,
        name: device.name,
        platform: device.platform,
        pairedAt: new Date(device.created_at).toISOString(),
      },
    })
  })

  // ── cancel (adapter via desktopPollToken, or server token) ──────────
  app.post('/api/agent-chat/v1/pairing/sessions/:id/cancel', async (c) => {
    const cfg = getConfig()
    const session = await getPairingSession(c.req.param('id'))
    if (!session) return c.json({ error: 'not_found' }, 404)
    const token = bearer(c.req.header('Authorization'))
    const okDesktop = token && (await sha256Hex(token)) === session.desktop_poll_token_hash
    const okServer = cfg?.token && token === cfg.token
    if (!okDesktop && !okServer) return c.json({ error: 'unauthorized' }, 401)
    if (session.status !== 'paired') {
      await updatePairingSession(session.id, { status: 'cancelled' })
    }
    return c.json({ pairingSessionId: session.id, status: session.status === 'paired' ? 'paired' : 'cancelled' })
  })

  // ── phone/browser web → server: exchange deviceCredential for short JWT ──
  app.post('/api/agent-chat/v1/devices/token', async (c) => {
    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
    const deviceCredential = typeof body.deviceCredential === 'string' ? body.deviceCredential : ''
    const adapterInstanceId = typeof body.adapterInstanceId === 'string' ? body.adapterInstanceId : ''
    if (!deviceCredential || !adapterInstanceId) return c.json({ error: 'missing_params' }, 400)

    const device = await getDeviceByCredentialHash(await sha256Hex(deviceCredential))
    if (!device) return c.json({ error: 'invalid_credential' }, 401)
    if (device.revoked) return c.json({ error: 'revoked' }, 403)
    if (device.adapter_instance_id !== adapterInstanceId) return c.json({ error: 'adapter_mismatch' }, 403)

    const key = await getActiveSigningKey()
    const now = Math.floor(Date.now() / 1000)
    const accessToken = await signJwt(key.privateJwk, key.kid, {
      iss: new URL(c.req.url).origin,
      aud: adapterInstanceId,
      sub: device.id,
      sid: device.pairing_session_id,
      scope: (device.scopes ? JSON.parse(device.scopes) : DEFAULT_SCOPES).join(' '),
      iat: now,
      exp: now + JWT_TTL_SECONDS,
      jti: randomToken(12),
    })
    return c.json({ accessToken, tokenType: 'Bearer', expiresInSeconds: JWT_TTL_SECONDS })
  })

  // ── adapter offline verification: JWKS ──────────────────────────────
  app.get('/api/agent-chat/v1/.well-known/jwks.json', async (c) => {
    await getActiveSigningKey() // ensure at least one key exists
    const keys = await listActiveSigningKeys()
    return c.json({ keys: keys.map((k) => publicJwkEntry(k.publicJwk, k.kid)) })
  })

  app.onError((err, c) => {
    logger.error({ err }, 'pairing route error')
    return c.json({ error: 'internal' }, 500)
  })

  return app
}
