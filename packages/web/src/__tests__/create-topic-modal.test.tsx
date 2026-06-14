import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateTopicModal } from '../components/layout/Sidebar'

afterEach(cleanup)

describe('CreateTopicModal', () => {
  it('does not render agent description text', () => {
    render(
      <CreateTopicModal
        name=""
        agentType="general"
        extension="claude-code"
        cwd=""
        workspace={null}
        workspaceLoading={false}
        workspaceError={null}
        permissionTier="normal"
        selectedSopIds={[]}
        templates={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onNameChange={vi.fn()}
        onAgentTypeChange={vi.fn()}
        onExtensionChange={vi.fn()}
        onPermissionTierChange={vi.fn()}
        onSelectedSopIdsChange={vi.fn()}
        onCwdChange={vi.fn()}
        onLoadWorkspace={vi.fn()}
      />,
    )

    expect(screen.queryByText('通用对话与轻任务')).toBeNull()
    expect(screen.queryByText('代码、终端与工作目录')).toBeNull()
  })

  it('shows workspace suggestions under the input and closes after selection', async () => {
    const onCwdChange = vi.fn()
    render(
      <CreateTopicModal
        name=""
        agentType="programming"
        extension="claude-code"
        cwd="/a"
        workspace={{ workspacePath: '/Users/test/Desktop/workspace', subDirList: ['agent-chat', 'adapter', '.git'] }}
        workspaceLoading={false}
        workspaceError={null}
        permissionTier="normal"
        selectedSopIds={[]}
        templates={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onNameChange={vi.fn()}
        onAgentTypeChange={vi.fn()}
        onExtensionChange={vi.fn()}
        onPermissionTierChange={vi.fn()}
        onSelectedSopIdsChange={vi.fn()}
        onCwdChange={onCwdChange}
        onLoadWorkspace={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('/path/to/project')
    fireEvent.focus(input)

    await waitFor(() => {
      expect(screen.getByText('adapter')).toBeTruthy()
      expect(screen.getByText('agent-chat')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('agent-chat'))

    expect(onCwdChange).toHaveBeenCalledWith('/agent-chat')
    await waitFor(() => {
      expect(screen.queryByText('adapter')).toBeNull()
      expect(screen.queryByText('agent-chat')).toBeNull()
    })
  })
})
