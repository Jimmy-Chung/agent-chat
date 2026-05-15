// VAPID JWT signing for Cloudflare Workers (SubtleCrypto / ES256)

function b64ToBytes(b64: string): Uint8Array {
  const converted = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = converted.padEnd(Math.ceil(converted.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function bytesToB64url(src: ArrayBuffer | Uint8Array): string {
  const arr = src instanceof ArrayBuffer ? new Uint8Array(src) : src
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function importVapidPrivateKey(
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<CryptoKey> {
  const pub = b64ToBytes(publicKeyB64) // uncompressed: 04 || x(32) || y(32)
  const x = bytesToB64url(pub.slice(1, 33))
  const y = bytesToB64url(pub.slice(33, 65))
  const d = bytesToB64url(b64ToBytes(privateKeyB64))
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

export async function buildVapidAuthHeader(
  endpoint: string,
  privateKeyB64: string,
  publicKeyB64: string,
  subject: string,
): Promise<string> {
  const key = await importVapidPrivateKey(privateKeyB64, publicKeyB64)
  const origin = new URL(endpoint).origin
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600

  const enc = new TextEncoder()
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToB64url(enc.encode(JSON.stringify({ aud: origin, exp, sub: subject })))
  const unsigned = `${header}.${payload}`

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsigned),
  )
  return `vapid t=${unsigned}.${bytesToB64url(sig)},k=${publicKeyB64}`
}
