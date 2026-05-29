import type { ProviderConfig } from '@/stores/ws-store'

export type ProgrammingExtension = 'claude-code' | 'codex'
export type ProviderGroup = ProgrammingExtension | 'pi-agent'

export function getActiveProviderIdForGroup(
  providers: ProviderConfig[],
  group: ProviderGroup,
): string | undefined {
  return providers.find((provider) => provider.isActive && provider.group === group)?.id
}

export function getActiveProviderIdForExtension(
  providers: ProviderConfig[],
  extension: ProgrammingExtension,
): string | undefined {
  return getActiveProviderIdForGroup(providers, extension)
}
