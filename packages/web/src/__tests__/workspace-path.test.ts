import { describe, expect, it } from 'vitest'
import { getWorkspaceDirMatches, joinWorkspacePath, resolveWorkspaceCwd } from '@/lib/workspace-path'

describe('workspace path helpers', () => {
  const workspace = {
    workspacePath: '/Users/test/Desktop/workspace/',
    subDirList: ['agent-chat', 'adapter', '.hidden', 'Design'],
  }

  it('resolves slash input under workspace root', () => {
    expect(resolveWorkspaceCwd('/agent-chat', workspace)).toBe('/Users/test/Desktop/workspace/agent-chat')
    expect(resolveWorkspaceCwd('/', workspace)).toBe('/Users/test/Desktop/workspace')
  })

  it('keeps non-slash input as explicit cwd', () => {
    expect(resolveWorkspaceCwd('~/repo', workspace)).toBe('~/repo')
  })

  it('joins missing directories under workspace root', () => {
    expect(joinWorkspacePath(workspace.workspacePath, '/new-project')).toBe('/Users/test/Desktop/workspace/new-project')
  })

  it('matches first-level workspace directories and hides dot dirs', () => {
    expect(getWorkspaceDirMatches('/a', workspace.subDirList)).toEqual(['adapter', 'agent-chat'])
    expect(getWorkspaceDirMatches('/.', workspace.subDirList)).toEqual([])
  })
})
