import { describe, expect, it } from 'vitest'
import { activateProviderInGroup, getActiveProviderIdForExtension, getActiveProviderIdForGroup } from '@/lib/provider-selection'
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

  it('selects the active provider from the requested general topic group', () => {
    expect(getActiveProviderIdForGroup([
      { id: 'claude-active', name: 'Claude', provider: 'anthropic', group: 'claude-code', isActive: true },
      { id: 'codex-active', name: 'Codex', provider: 'openai', group: 'codex', isActive: true },
      { id: 'pi-active', name: 'PI', provider: 'pi', group: 'pi-agent', isActive: true },
    ], 'pi-agent')).toBe('pi-active')
  })

  it('activates a provider only within its own group', () => {
    const next = activateProviderInGroup([
      { id: 'claude-active', name: 'Claude', provider: 'anthropic', group: 'claude-code', isActive: true },
      { id: 'codex-active', name: 'Codex', provider: 'openai', group: 'codex', isActive: true },
      { id: 'codex-inactive', name: 'Codex inactive', provider: 'openai', group: 'codex', isActive: false },
    ], 'codex-inactive')

    expect(next.find((provider) => provider.id === 'claude-active')?.isActive).toBe(true)
    expect(next.find((provider) => provider.id === 'codex-active')?.isActive).toBe(false)
    expect(next.find((provider) => provider.id === 'codex-inactive')?.isActive).toBe(true)
  })
})
