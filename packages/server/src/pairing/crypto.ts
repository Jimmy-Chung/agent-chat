// Device pairing crypto helpers (AIT-216).
// Random tokens / codes, SHA-256 hashing, and RS256 JWT signing via WebCrypto.

const enc = new TextEncoder()

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** URL-safe random opaque token (default 32 bytes). */
export function randomToken(bytes = 32): string {
  const u8 = new Uint8Array(bytes)
  crypto.getRandomValues(u8)
  return b64url(u8)
}

// Verification code alphabet: omit ambiguous chars (I/O/0/1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Human-typable one-time verification code. */
export function randomCode(len = 6): string {
  const u8 = new Uint8Array(len)
  crypto.getRandomValues(u8)
  let out = ''
  for (const b of u8) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const RSA_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

export interface SigningKeyMaterial {
  kid: string
  publicJwk: JsonWebKey
  privateJwk: JsonWebKey
}

// DOM's JsonWebKey type omits `kid`; JWKS entries need it.
export interface PublicJwk {
  kty?: string
  n?: string
  e?: string
  alg: string
  use: string
  kid: string
}

/** Generate an RS256 signing keypair; kid derived from the public modulus. */
export async function generateSigningKey(): Promise<SigningKeyMaterial> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  const kid = (await sha256Hex(`${publicJwk.n ?? ''}.${publicJwk.e ?? ''}`)).slice(0, 16)
  return { kid, publicJwk, privateJwk }
}

/** Public JWK for the JWKS endpoint (strips private fields, sets RS256/sig metadata). */
export function publicJwkEntry(publicJwk: JsonWebKey, kid: string): PublicJwk {
  return { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, alg: 'RS256', use: 'sig', kid }
}

/** Sign a compact JWS (RS256) with the given private JWK and kid. */
export async function signJwt(
  privateJwk: JsonWebKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, RSA_ALG, false, ['sign'])
  const header = { alg: 'RS256', typ: 'JWT', kid }
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`
  const sig = await crypto.subtle.sign(RSA_ALG.name, key, enc.encode(signingInput))
  return `${signingInput}.${b64url(sig)}`
}

/** Decode a JWT's header+payload (no verification — for tests/inspection). */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = token.split('.')
  const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')))
  return { header: dec(h), payload: dec(p) }
}
