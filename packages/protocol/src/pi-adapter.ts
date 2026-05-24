/**
 * PI Adapter URL constants and URL utilities.
 *
 * Single source of truth for:
 * - Default/fallback PI Adapter address (local mock-pi)
 * - ws(s) ↔ http(s) protocol conversion
 * - URL construction with token param (avoids new URL() TLD validation)
 */

/** Fallback PI Adapter URL — local mock-pi. Used when no env var is set. */
export const DEFAULT_PI_ADAPTER_URL = 'ws://127.0.0.1:7331/api/agent-chat/v1/socket'

/**
 * Convert a ws(s) PI Adapter URL to the http(s) API base (protocol + host + /api/agent-chat/v1).
 * No final path segment — callers append their own (e.g. /mcp, /adapter-status).
 */
export function piWsToHttpBase(rawUrl: string): string {
  const m = rawUrl.match(/^(wss?|https?):\/\/([^/?#]+)/)
  if (!m) throw new Error(`Invalid PI_ADAPTER_URL: ${rawUrl}`)
  const proto = m[1] === 'wss' ? 'https:' : m[1] === 'ws' ? 'http:' : `${m[1]}:`
  return `${proto}//${m[2]}/api/agent-chat/v1`
}

/**
 * Convert a ws(s) PI Adapter URL to the corresponding http(s) MCP endpoint.
 * Uses regex parsing to avoid Node.js `new URL()` TLD validation issues
 * with non-standard domains (e.g. `.jam`).
 */
export function piWsToHttp(rawUrl: string): string {
  return `${piWsToHttpBase(rawUrl)}/mcp`
}

/**
 * Build a full PI Adapter WS URL with token query param.
 * Replaces an existing `token` param if present; appends otherwise.
 * Uses regex parsing to avoid `new URL()` TLD validation issues.
 */
export function buildPiWsUrl(rawUrl: string, token?: string): string {
  if (!token) return rawUrl
  // Strip any existing token param before appending the new one
  const base = rawUrl.replace(/([?&])token=[^&]*&?/, (_, lead) =>
    lead === '?' ? '?' : '',
  )
  const cleaned = base.replace(/[?&]$/, '')
  const sep = cleaned.includes('?') ? '&' : '?'
  return `${cleaned}${sep}token=${encodeURIComponent(token)}`
}
