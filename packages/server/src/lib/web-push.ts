// RFC 8291 Web Push payload encryption (aes128gcm) using SubtleCrypto

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

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

// HKDF-Extract + single-block Expand (length <= 32)
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey(
    'raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm))

  const prkKey = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const t1Input = new Uint8Array(info.length + 1)
  t1Input.set(info)
  t1Input[info.length] = 0x01
  const t1 = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, t1Input))
  return t1.slice(0, length)
}

export interface EncryptedPush {
  body: Uint8Array
  contentEncoding: string
}

export async function encryptPushPayload(
  plaintext: string,
  sub: PushSubscriptionKeys,
): Promise<EncryptedPush> {
  const enc = new TextEncoder()

  // 1. Sender ephemeral keypair
  const senderPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )) as CryptoKeyPair
  const asPublicRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', senderPair.publicKey)) as ArrayBuffer,
  )

  // 2. Receiver's public key
  const uaPublicRaw = b64ToBytes(sub.p256dh)
  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )

  // 3. ECDH shared secret (CF Workers types use $public for the receiver's public key)
  const sharedSecret = new Uint8Array(
    // CF Workers types use $public to avoid keyword conflict, but the runtime requires "public"
    // biome-ignore lint: intentional cast to pass "public" key name at runtime
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey } as never,
      senderPair.privateKey,
      256,
    ),
  )

  // 4. Auth secret
  const auth = b64ToBytes(sub.auth)

  // 5. PRK_key = HKDF(salt=auth, ikm=sharedSecret, info="WebPush: info\x00"||ua||as, len=32)
  const authInfoPrefix = enc.encode('WebPush: info\x00')
  const context = new Uint8Array(authInfoPrefix.length + uaPublicRaw.length + asPublicRaw.length)
  context.set(authInfoPrefix)
  context.set(uaPublicRaw, authInfoPrefix.length)
  context.set(asPublicRaw, authInfoPrefix.length + uaPublicRaw.length)
  const prkKey = await hkdf(auth, sharedSecret, context, 32)

  // 6. Random salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // 7. CEK and nonce
  const cek = await hkdf(salt, prkKey, enc.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdf(salt, prkKey, enc.encode('Content-Encoding: nonce\x00'), 12)

  // 8. Pad plaintext: payload || 0x02 (last-record delimiter)
  const plaintextBytes = enc.encode(plaintext)
  const padded = new Uint8Array(plaintextBytes.length + 1)
  padded.set(plaintextBytes)
  padded[plaintextBytes.length] = 0x02

  // 9. AES-128-GCM encrypt
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded),
  )

  // 10. Build aes128gcm record: salt(16) + rs(4 BE) + idlen(1) + keyid(65) + ciphertext
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, rs, false)
  header[20] = asPublicRaw.length
  header.set(asPublicRaw, 21)

  const body = new Uint8Array(header.length + ciphertext.length)
  body.set(header)
  body.set(ciphertext, header.length)

  return { body, contentEncoding: 'aes128gcm' }
}

export { bytesToB64url }
