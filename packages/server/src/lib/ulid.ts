// Web Crypto-based ULID — avoids ulid package's node:crypto require
// which fails in Cloudflare Workers (no window.crypto detection fallback).
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(time: number): string {
  let str = ""
  for (let i = 0; i < TIME_LEN; i++) {
    str = ENCODING[time % ENCODING_LEN] + str
    time = Math.floor(time / ENCODING_LEN)
  }
  return str
}

function encodeRandom(bytes: Uint8Array): string {
  let str = ""
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[bytes[i] % ENCODING_LEN]
  }
  return str
}

export function ulid(): string {
  const time = Date.now()
  const random = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(random)
  return encodeTime(time) + encodeRandom(random)
}
