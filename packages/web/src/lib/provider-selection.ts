import type { ProviderConfig } from '@/stores/ws-store'

export type ProgrammingExtension = 'claude-code' | 'codex'
export type ProviderGroup = ProgrammingExtension | 'pi-agent'

const PROVIDER_GROUPS = new Set<ProviderGroup>(['claude-code', 'codex', 'pi-agent'])

export function getProviderGroup(provider: ProviderConfig): ProviderGroup | undefined {
  return PROVIDER_GROUPS.has(provider.group as ProviderGroup)
    ? provider.group as ProviderGroup
    : undefined
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
