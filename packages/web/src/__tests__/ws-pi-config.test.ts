import { describe, it, expect } from 'vitest'

// Test the URL params building logic (same logic as WsClient.connect)
function buildConnectUrl(wsUrl: string, token: string | null, piConfig?: { wssUrl: string; piToken: string }): string {
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (piConfig?.wssUrl) params.set('piWssUrl', piConfig.wssUrl)
  if (piConfig?.piToken) params.set('piToken', piConfig.piToken)
  return params.toString() ? `${wsUrl}?${params}` : wsUrl
}

describe('FEAT-036: WsClient PI config URL params', () => {
  const wsUrl = 'wss://localhost/ws'

  it('includes piWssUrl and piToken when PiConfig provided', () => {
    const url = buildConnectUrl(wsUrl, 'test-token', {
      wssUrl: 'wss://pi.example.com/socket',
      piToken: 'pi-secret',
    })
    expect(url).toContain('token=test-token')
    expect(url).toContain('piWssUrl=wss%3A%2F%2Fpi.example.com%2Fsocket')
    expect(url).toContain('piToken=pi-secret')
  })

  it('does not include PI params when no PiConfig', () => {
    const url = buildConnectUrl(wsUrl, 'test-token')
    expect(url).toContain('token=test-token')
    expect(url).not.toContain('piWssUrl')
    expect(url).not.toContain('piToken')
  })

  it('returns bare wsUrl when no token and no PiConfig', () => {
    const url = buildConnectUrl(wsUrl, null)
    expect(url).toBe(wsUrl)
  })

  it('handles special characters in PI config values', () => {
    const url = buildConnectUrl(wsUrl, 'test-token', {
      wssUrl: 'wss://pi.example.com/api/agent-chat/v1/socket',
      piToken: 'tok&en=with=special',
    })
    expect(url).toContain('piWssUrl=wss%3A%2F%2Fpi.example.com%2Fapi%2Fagent-chat%2Fv1%2Fsocket')
    // URLSearchParams should encode special chars
    const parsed = new URL(url)
    expect(parsed.searchParams.get('piToken')).toBe('tok&en=with=special')
  })
})
