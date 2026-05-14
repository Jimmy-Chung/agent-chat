import type { AppConfig, Env } from '../config'

export const ARTIFACT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const ARTIFACT_URL_TTL_MS = 10 * 60 * 1000

export type ArtifactAction = 'upload' | 'download'

interface ArtifactTokenPayload {
  action: ArtifactAction
  key: string
  exp: number
  maxBytes?: number
}

export function buildArtifactKey(topicId: string | null | undefined, uploadId: string, name: string): string {
  const scope = topicId ? `topics/${safePathSegment(topicId)}` : 'pool'
  return `${scope}/${safePathSegment(uploadId)}/${safeFilename(name)}`
}

export function buildArtifactAccessUrl(
  baseUrl: string,
  action: ArtifactAction,
  key: string,
  token: string,
  name?: string,
): string {
  const url = new URL(`/api/artifacts/${action}/${encodeURIComponent(key)}`, baseUrl)
  url.searchParams.set('token', token)
  if (name) url.searchParams.set('name', name)
  return url.toString()
}

export async function createArtifactToken(
  config: AppConfig,
  payload: Omit<ArtifactTokenPayload, 'exp'> & { expiresAt?: number },
): Promise<string> {
  return createArtifactTokenWithSecret(config.artifactTokenSecret, payload)
}

export async function createArtifactTokenWithSecret(
  secret: string,
  payload: Omit<ArtifactTokenPayload, 'exp'> & { expiresAt?: number },
): Promise<string> {
  const fullPayload: ArtifactTokenPayload = {
    action: payload.action,
    key: payload.key,
    exp: payload.expiresAt ?? Date.now() + ARTIFACT_URL_TTL_MS,
    maxBytes: payload.maxBytes,
  }
  const body = base64UrlEncode(JSON.stringify(fullPayload))
  const sig = await sign(secret, body)
  return `${body}.${sig}`
}

export async function verifyArtifactToken(
  config: AppConfig,
  token: string | null,
  action: ArtifactAction,
  key: string,
): Promise<ArtifactTokenPayload | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await sign(config.artifactTokenSecret, body)
  if (!timingSafeEqual(sig, expected)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as ArtifactTokenPayload
    if (payload.action !== action || payload.key !== key || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function handleArtifactAccessRequest(
  request: Request,
  env: Env,
  config: AppConfig,
): Promise<Response | null> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/artifacts\/(upload|download)\/(.+)$/)
  if (!match) return null
  if (request.method === 'OPTIONS') return artifactResponse(null, { status: 204 })
  if (!env.R2) return artifactResponse('R2 binding is not configured', { status: 503 })

  const action = match[1] as ArtifactAction
  const key = decodeURIComponent(match[2])
  const payload = await verifyArtifactToken(config, url.searchParams.get('token'), action, key)
  if (!payload) return artifactResponse('Unauthorized', { status: 401 })

  if (action === 'upload') {
    if (request.method !== 'PUT') return artifactResponse('Method Not Allowed', { status: 405 })
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (payload.maxBytes && contentLength > payload.maxBytes) {
      return artifactResponse('Payload Too Large', { status: 413 })
    }
    await env.R2.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get('content-type') ?? undefined,
      },
    })
    return artifactResponse(null, { status: 204 })
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return artifactResponse('Method Not Allowed', { status: 405 })
  }
  const object = await env.R2.get(key)
  if (!object) return artifactResponse('Not Found', { status: 404 })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  const name = url.searchParams.get('name')
  if (name) headers.set('content-disposition', `inline; filename="${sanitizeHeaderFilename(name)}"`)
  return artifactResponse(request.method === 'HEAD' ? null : object.body, { headers })
}

function artifactResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, PUT, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type, content-length')
  headers.set('access-control-expose-headers', 'content-disposition, content-type, etag')
  return new Response(body, { ...init, headers })
}

function safePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'item'
}

function safeFilename(input: string): string {
  const cleaned = input.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned.slice(0, 180) || 'artifact'
}

function sanitizeHeaderFilename(input: string): string {
  return safeFilename(input).replace(/"/g, "'")
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return base64UrlEncodeBytes(new Uint8Array(sig))
}

function base64UrlEncode(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input))
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return atob(padded)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}
