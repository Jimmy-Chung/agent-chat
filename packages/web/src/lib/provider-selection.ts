import type { ProviderConfig } from '@/stores/ws-store'

export type ProgrammingExtension = 'claude-code' | 'codex'
export type ProviderGroup = ProgrammingExtension | 'pi-agent'

const PROVIDER_GROUPS = new Set<ProviderGroup>(['claude-code', 'codex', 'pi-agent'])
const PROVIDER_GROUP_ALIASES: Record<string, ProviderGroup> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  apipass: 'codex',
  'pi-agent': 'pi-agent',
}

export function getProviderGroup(provider: ProviderConfig): ProviderGroup | undefined {
  const normalized = provider.group ? PROVIDER_GROUP_ALIASES[provider.group] : undefined
  return normalized && PROVIDER_GROUPS.has(normalized) ? normalized : undefined
}

export function getActiveProviderForGroup(
  providers: ProviderConfig[],
  group: ProviderGroup,
): ProviderConfig | undefined {
  return providers.find((provider) => provider.isActive && getProviderGroup(provider) === group)
}

export function getActiveProviderIdForGroup(
  providers: ProviderConfig[],
  group: ProviderGroup,
): string | undefined {
  return getActiveProviderForGroup(providers, group)?.id
}

export function getActiveProviderIdForExtension(
  providers: ProviderConfig[],
  extension: ProgrammingExtension,
): string | undefined {
  return getActiveProviderIdForGroup(providers, extension)
}

export function activateProviderInGroup(
  providers: ProviderConfig[],
  providerId: string,
): ProviderConfig[] {
  const target = providers.find((provider) => provider.id === providerId)
  const targetGroup = target ? getProviderGroup(target) : undefined
  if (!targetGroup) return providers

  return providers.map((provider) => (
    getProviderGroup(provider) === targetGroup
      ? { ...provider, isActive: provider.id === providerId }
      : provider
  ))
}
