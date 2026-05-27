import { describe, expect, it } from 'vitest'
import { getActiveProviderIdForExtension } from '@/lib/provider-selection'
import type { ProviderConfig } from '@/stores/ws-store'

describe('getActiveProviderIdForExtension', () => {
  const providers: ProviderConfig[] = [
    { id: 'claude-active', name: 'Claude', provider: 'anthropic', group: 'claude-code', isActive: true },
    { id: 'codex-active', name: 'Codex', provider: 'openai', group: 'codex', isActive: true },
    { id: 'codex-inactive', name: 'Codex inactive', provider: 'openai', group: 'codex', isActive: false },
  ]

  it('keeps programming topic creation provider aligned with the selected extension', () => {
    expect(getActiveProviderIdForExtension(providers, 'claude-code')).toBe('claude-active')
    expect(getActiveProviderIdForExtension(providers, 'codex')).toBe('codex-active')
  })

  it('does not fall back to another active provider group', () => {
    expect(getActiveProviderIdForExtension([
      { id: 'claude-active', name: 'Claude', provider: 'anthropic', group: 'claude-code', isActive: true },
    ], 'codex')).toBeUndefined()
  })
})
