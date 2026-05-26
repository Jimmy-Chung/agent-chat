export interface WorkspaceBrowseResponse {
  workspacePath: string
  subDirList: string[]
}

export function normalizeCwd(cwd: string): string {
  return cwd.trim().replace(/\/+$/, '') || '/'
}

export function joinWorkspacePath(workspacePath: string, input: string): string {
  const root = normalizeCwd(workspacePath)
  const child = input.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return child ? `${root}/${child}` : root
}

export function resolveWorkspaceCwd(input: string, workspace: WorkspaceBrowseResponse | null): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (!workspace || !trimmed.startsWith('/')) return normalizeCwd(trimmed)
  return joinWorkspacePath(workspace.workspacePath, trimmed)
}

export function getWorkspaceDirMatches(input: string, subDirList: string[]): string[] {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return []
  const query = trimmed.replace(/^\/+/, '').toLowerCase()
  return subDirList
    .filter((name) => !name.startsWith('.'))
    .filter((name) => name.toLowerCase().startsWith(query))
    .sort((a, b) => a.localeCompare(b))
}
