import { describe, expect, it } from 'vitest'
import { buildPiAdapterUrl } from '../pi/client'

describe('PiClient', () => {
  it('adds PI_ADAPTER_TOKEN as token query param for Worker WebSocket auth', () => {
    expect(
      buildPiAdapterUrl(
        'wss://pi-adapter.example.com/api/agent-chat/v1/socket',
        'secret-token',
      ),
    ).toBe(
      'wss://pi-adapter.example.com/api/agent-chat/v1/socket?token=secret-token',
    )
  })

  it('preserves existing query params and replaces stale token', () => {
    expect(
      buildPiAdapterUrl(
        'wss://pi-adapter.example.com/socket?env=prod&token=old',
        'new-token',
      ),
    ).toBe('wss://pi-adapter.example.com/socket?env=prod&token=new-token')
  })
})
