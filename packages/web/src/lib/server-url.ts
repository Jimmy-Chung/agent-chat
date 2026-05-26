export function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  return 'ws://127.0.0.1:8080/ws'
}

export function getServerBase(): string {
  try {
    const u = new URL(getWsUrl())
    return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`
  } catch {
    return ''
  }
}
