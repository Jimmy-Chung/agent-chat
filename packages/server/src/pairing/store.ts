// Device pairing persistence (AIT-216) — raw D1 access.
import { getD1 } from '../db/migrate'
import { ulid } from '../lib/ulid'
import { generateSigningKey, type SigningKeyMaterial } from './crypto'

export type PairingStatus =
  | 'pending_scan'
  | 'scanned'
  | 'code_issued'
  | 'paired'
  | 'expired'
  | 'cancelled'
  | 'error'

export interface PairingSession {
  id: string
  adapter_instance_id: string
  adapter_wss_url: string
  display_name: string | null
  status: PairingStatus
  nonce: string
  desktop_poll_token_hash: string
  device_hint: string | null
  // Plaintext: only ever released to the desktopPollToken holder via desktop-status.
  verification_code: string | null
  code_expires_at: number | null
  code_attempts: number
  paired_device_id: string | null
  expires_at: number
  created_at: number
  updated_at: number
}

export interface PairedDevice {
  id: string
  adapter_instance_id: string
  name: string | null
  platform: string | null
  credential_hash: string
  scopes: string | null
  revoked: number
  pairing_session_id: string | null
  created_at: number
}

export async function createPairingSession(input: {
  adapterInstanceId: string
  adapterWssUrl: string
  displayName: string | null
  nonce: string
  desktopPollTokenHash: string
  expiresAt: number
}): Promise<PairingSession> {
  const now = Date.now()
  const row: PairingSession = {
    id: `ps_${ulid()}`,
    adapter_instance_id: input.adapterInstanceId,
    adapter_wss_url: input.adapterWssUrl,
    display_name: input.displayName,
    status: 'pending_scan',
    nonce: input.nonce,
    desktop_poll_token_hash: input.desktopPollTokenHash,
    device_hint: null,
    verification_code: null,
    code_expires_at: null,
    code_attempts: 0,
    paired_device_id: null,
    expires_at: input.expiresAt,
    created_at: now,
    updated_at: now,
  }
  await getD1()
    .prepare(
      `INSERT INTO pairing_sessions
        (id, adapter_instance_id, adapter_wss_url, display_name, status, nonce,
         desktop_poll_token_hash, device_hint, verification_code, code_expires_at, code_attempts,
         paired_device_id, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id, row.adapter_instance_id, row.adapter_wss_url, row.display_name, row.status, row.nonce,
      row.desktop_poll_token_hash, row.device_hint, row.verification_code, row.code_expires_at, row.code_attempts,
      row.paired_device_id, row.expires_at, row.created_at, row.updated_at,
    )
    .run()
  return row
}

export async function getPairingSession(id: string): Promise<PairingSession | null> {
  const row = await getD1().prepare(`SELECT * FROM pairing_sessions WHERE id = ?`).bind(id).first<PairingSession>()
  return row ?? null
}

export async function updatePairingSession(
  id: string,
  fields: Partial<Omit<PairingSession, 'id' | 'created_at'>>,
): Promise<void> {
  const keys = Object.keys(fields)
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (fields as Record<string, unknown>)[k])
  await getD1()
    .prepare(`UPDATE pairing_sessions SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...values, Date.now(), id)
    .run()
}

export async function createDevice(input: {
  adapterInstanceId: string
  name: string | null
  platform: string | null
  credentialHash: string
  scopes: string[]
  pairingSessionId: string
}): Promise<PairedDevice> {
  const now = Date.now()
  const row: PairedDevice = {
    id: `device_${ulid()}`,
    adapter_instance_id: input.adapterInstanceId,
    name: input.name,
    platform: input.platform,
    credential_hash: input.credentialHash,
    scopes: JSON.stringify(input.scopes),
    revoked: 0,
    pairing_session_id: input.pairingSessionId,
    created_at: now,
  }
  await getD1()
    .prepare(
      `INSERT INTO devices (id, adapter_instance_id, name, platform, credential_hash, scopes, revoked, pairing_session_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(row.id, row.adapter_instance_id, row.name, row.platform, row.credential_hash, row.scopes, row.revoked, row.pairing_session_id, row.created_at)
    .run()
  return row
}

export async function getDeviceByCredentialHash(hash: string): Promise<PairedDevice | null> {
  const row = await getD1().prepare(`SELECT * FROM devices WHERE credential_hash = ?`).bind(hash).first<PairedDevice>()
  return row ?? null
}

export async function updateDeviceAdapterInstanceId(deviceId: string, adapterInstanceId: string): Promise<void> {
  await getD1()
    .prepare(`UPDATE devices SET adapter_instance_id = ? WHERE id = ?`)
    .bind(adapterInstanceId, deviceId)
    .run()
}

export async function setDeviceRevoked(deviceId: string, revoked: boolean): Promise<void> {
  await getD1().prepare(`UPDATE devices SET revoked = ? WHERE id = ?`).bind(revoked ? 1 : 0, deviceId).run()
}

// ─── Signing keys ────────────────────────────────────────────────────

export interface StoredSigningKey {
  kid: string
  publicJwk: JsonWebKey
  privateJwk: JsonWebKey
}

/** Get the active signing key, generating + persisting one on first use. */
export async function getActiveSigningKey(): Promise<StoredSigningKey> {
  const existing = await getD1()
    .prepare(`SELECT kid, public_jwk, private_jwk FROM signing_keys WHERE active = 1 ORDER BY created_at DESC LIMIT 1`)
    .first<{ kid: string; public_jwk: string; private_jwk: string }>()
  if (existing) {
    return { kid: existing.kid, publicJwk: JSON.parse(existing.public_jwk), privateJwk: JSON.parse(existing.private_jwk) }
  }
  const generated: SigningKeyMaterial = await generateSigningKey()
  await getD1()
    .prepare(`INSERT INTO signing_keys (kid, public_jwk, private_jwk, active, created_at) VALUES (?,?,?,1,?)`)
    .bind(generated.kid, JSON.stringify(generated.publicJwk), JSON.stringify(generated.privateJwk), Date.now())
    .run()
  return generated
}

/** All currently-published public keys (for JWKS). */
export async function listActiveSigningKeys(): Promise<StoredSigningKey[]> {
  const { results } = await getD1()
    .prepare(`SELECT kid, public_jwk, private_jwk FROM signing_keys WHERE active = 1 ORDER BY created_at DESC`)
    .all<{ kid: string; public_jwk: string; private_jwk: string }>()
  return (results ?? []).map((r) => ({ kid: r.kid, publicJwk: JSON.parse(r.public_jwk), privateJwk: JSON.parse(r.private_jwk) }))
}
