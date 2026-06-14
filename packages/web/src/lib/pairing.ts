// Device pairing client (AIT-216). Drives the agent-chat server pairing API
// from the /pair page, then stores the long-lived deviceCredential locally.
import { getServerBase } from '@/lib/server-url'

const PAIRED_KEY = 'AGENT_CHAT_PAIRED_DEVICE'

export interface PairingParams {
  session: string
  nonce: string
  ws: string
}

export interface PairedDevice {
  deviceId: string
  deviceCredential: string
  adapterInstanceId: string
  adapterWssUrl: string
  pairedAt: string
}

export class PairingError extends Error {
  constructor(
    public code: string,
    public status: number,
    public remainingAttempts?: number,
  ) {
    super(code)
    this.name = 'PairingError'
  }
}

/** Read session/nonce/ws from a query string or URLSearchParams. */
export function parsePairingParams(search: string | URLSearchParams): PairingParams | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  const session = p.get('session')
  const nonce = p.get('nonce')
  const ws = p.get('ws')
  if (!session || !nonce || !ws) return null
  return { session, nonce, ws }
}

/** Accept a full pairing URL (from QR decode / paste) or a raw query string. */
export function parsePairingUrl(input: string): PairingParams | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    return parsePairingParams(new URL(trimmed).searchParams)
  } catch {
    const qi = trimmed.indexOf('?')
    return parsePairingParams(qi >= 0 ? trimmed.slice(qi + 1) : trimmed)
  }
}

/** Append the short-lived access JWT as a query param (browser WS can't set headers). */
export function buildAdapterWsUrl(adapterWssUrl: string, accessToken: string): string {
  const u = new URL(adapterWssUrl)
  u.searchParams.set('access_token', accessToken)
  return u.toString()
}

export function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  if (/macintosh|mac os x/i.test(ua)) return 'macos'
  if (/windows/i.test(ua)) return 'windows'
  return 'web'
}

async function postJson(path: string, body: unknown): Promise<{ res: Response; data: any }> {
  const res = await fetch(`${getServerBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

export async function claimSession(
  session: string,
  nonce: string,
  deviceHint: { name?: string; platform?: string },
): Promise<void> {
  const { res, data } = await postJson(`/api/agent-chat/v1/pairing/sessions/${session}/claim`, { nonce, deviceHint })
  if (!res.ok) throw new PairingError(data.error ?? 'claim_failed', res.status)
}

export interface VerifyResult {
  deviceCredential: string
  adapterInstanceId: string
  adapterWssUrl: string
  pairedDevice: { id: string; pairedAt: string }
}

export async function verifyCode(session: string, code: string): Promise<VerifyResult> {
  const { res, data } = await postJson(`/api/agent-chat/v1/pairing/sessions/${session}/verify`, { code })
  if (!res.ok) throw new PairingError(data.error ?? 'verify_failed', res.status, data.remainingAttempts)
  return data as VerifyResult
}

export async function exchangeToken(
  deviceCredential: string,
  adapterInstanceId: string,
  adapterWssUrl?: string,
): Promise<{ accessToken: string; adapterInstanceId: string }> {
  const { res, data } = await postJson('/api/agent-chat/v1/devices/token', {
    deviceCredential,
    adapterInstanceId,
    ...(adapterWssUrl ? { adapterWssUrl } : {}),
  })
  if (!res.ok) throw new PairingError(data.error ?? 'token_failed', res.status)
  return {
    accessToken: data.accessToken as string,
    adapterInstanceId: typeof data.adapterInstanceId === 'string' ? data.adapterInstanceId : adapterInstanceId,
  }
}

export function updatePairedDeviceAdapterInstanceId(adapterInstanceId: string): void {
  const paired = loadPairedDevice()
  if (!paired || paired.adapterInstanceId === adapterInstanceId) return
  savePairedDevice({ ...paired, adapterInstanceId })
}

export function savePairedDevice(d: PairedDevice): void {
  try { localStorage.setItem(PAIRED_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}

export function loadPairedDevice(): PairedDevice | null {
  try {
    const s = localStorage.getItem(PAIRED_KEY)
    return s ? (JSON.parse(s) as PairedDevice) : null
  } catch {
    return null
  }
}

export function clearPairedDevice(): void {
  try { localStorage.removeItem(PAIRED_KEY) } catch { /* ignore */ }
}

// Connection keys shared with ConnectionConfigModal / ws-client.
const PI_WSS_URL_KEY = 'PI_ADAPTER_WSS_URL'
const PI_TOKEN_KEY = 'PI_ADAPTER_TOKEN'

/**
 * Point the app's adapter connection at the paired adapter, carrying the JWT
 * as `?access_token=` on the adapter WSS URL (server connects to it as-is).
 * 首版：JWT 直接嵌入 URL；过期刷新留作后续优化。
 */
export function applyPairedConnection(adapterWssUrl: string, accessToken: string): void {
  try {
    localStorage.setItem(PI_WSS_URL_KEY, buildAdapterWsUrl(adapterWssUrl, accessToken))
    localStorage.setItem(PI_TOKEN_KEY, '')
  } catch { /* ignore */ }
}
