import { describe, expect, it } from 'vitest'
import type { Topic } from '@agent-chat/protocol'
import {
  getTopicCwd,
  getTopicDirectoryLabel,
  getWorkspaceDirMatches,
  joinWorkspacePath,
  resolveWorkspaceCwd,
} from '@/lib/workspace-path'

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

  it('extracts topic cwd and strips workspace root for display', () => {
    const topic = makeTopic({
      programming_spec_json: JSON.stringify({ cwd: '/Users/test/Desktop/workspace/agent-chat/packages/web' }),
    })

    expect(getTopicCwd(topic)).toBe('/Users/test/Desktop/workspace/agent-chat/packages/web')
    expect(getTopicDirectoryLabel(topic, workspace.workspacePath)).toBe('/agent-chat/packages/web')
  })

  it('uses general topic cwd for directory labels', () => {
    const topic = makeTopic({
      agent_type: 'general',
      programming_spec_json: null,
      general_spec_json: JSON.stringify({ cwd: '/Users/test/Desktop/workspace/Design' }),
    })

    expect(getTopicDirectoryLabel(topic, workspace.workspacePath)).toBe('/Design')
  })
})

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    name: 'Topic',
    kind: 'normal',
    agent_type: 'programming',
    pi_session_id: null,
    programming_spec_json: null,
    general_spec_json: null,
    sop_template_id: null,
    current_model: null,
    current_provider_id: null,
    history_frozen_at: null,
    plan_mode: false,
    created_at: 1,
    updated_at: 1,
    archived: false,
    ...overrides,
  }
}
