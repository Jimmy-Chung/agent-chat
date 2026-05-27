import type { ProviderConfig } from '@/stores/ws-store'

export type ProgrammingExtension = 'claude-code' | 'codex'

export function getActiveProviderIdForExtension(
  providers: ProviderConfig[],
  extension: ProgrammingExtension,
): string | undefined {
  return providers.find((provider) => provider.isActive && provider.group === extension)?.id
}
