import type { Topic } from '@agent-chat/protocol'

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

export function getTopicCwd(topic: Topic): string | null {
  const specJson = topic.agent_type === 'programming'
    ? topic.programming_spec_json
    : topic.general_spec_json
  if (!specJson) return null
  try {
    const parsed = JSON.parse(specJson) as { cwd?: string }
    return parsed.cwd ? normalizeCwd(parsed.cwd) : null
  } catch {
    return null
  }
}

export function getWorkspaceRelativePath(cwd: string, workspaceRoot?: string | null): string {
  const normalizedCwd = normalizeCwd(cwd)
  const root = workspaceRoot ? normalizeCwd(workspaceRoot) : ''
  if (root && normalizedCwd === root) return '/'
  if (root && normalizedCwd.startsWith(`${root}/`)) {
    return `/${normalizedCwd.slice(root.length + 1)}`
  }
  return normalizedCwd
}

export function getWorkspaceScopedPathLabel(path: string, workspaceRoot?: string | null): string {
  const normalizedPath = normalizeCwd(path)
  const root = workspaceRoot ? normalizeCwd(workspaceRoot) : ''
  if (root && normalizedPath === root) return '${workspace}'
  if (root && normalizedPath.startsWith(`${root}/`)) {
    return `\${workspace}/${normalizedPath.slice(root.length + 1)}`
  }
  return normalizedPath
}

export function getTopicDirectoryLabel(topic: Topic, workspaceRoot?: string | null): string | null {
  const cwd = getTopicCwd(topic)
  if (!cwd || cwd === '/') return null
  return getWorkspaceRelativePath(cwd, workspaceRoot)
}
