import { describe, expect, it } from 'vitest'
import { buildPiWsUrl, normalizePiWsUrl, piWsToHttpBase } from '../pi-adapter'

describe('PI adapter URL helpers', () => {
  it('normalizes http(s) socket URLs to ws(s)', () => {
    expect(normalizePiWsUrl('https://adapter.example.com/api/agent-chat/v1/socket'))
      .toBe('wss://adapter.example.com/api/agent-chat/v1/socket')
    expect(normalizePiWsUrl('http://127.0.0.1:7331/api/agent-chat/v1/socket'))
      .toBe('ws://127.0.0.1:7331/api/agent-chat/v1/socket')
  })

  it('builds websocket URLs from http(s) input before appending token', () => {
    expect(buildPiWsUrl('https://adapter.example.com/api/agent-chat/v1/socket', 'tok'))
      .toBe('wss://adapter.example.com/api/agent-chat/v1/socket?token=tok')
    expect(buildPiWsUrl('http://127.0.0.1:7331/api/agent-chat/v1/socket?token=old', 'new tok'))
      .toBe('ws://127.0.0.1:7331/api/agent-chat/v1/socket?token=new%20tok')
  })

  it('maps normalized websocket URLs to adapter HTTP base', () => {
    expect(piWsToHttpBase('https://adapter.example.com/api/agent-chat/v1/socket'))
      .toBe('https://adapter.example.com/api/agent-chat/v1')
    expect(piWsToHttpBase('ws://127.0.0.1:7331/api/agent-chat/v1/socket'))
      .toBe('http://127.0.0.1:7331/api/agent-chat/v1')
  })
})
