import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TodoTab } from '../components/layout/InspectorPanel'

describe('TodoTab', () => {
  it('shows active todos and collapses completed todos by default', () => {
    render(
      <TodoTab
        todos={[
          { id: '1', content: '进行中的任务', status: 'in_progress', activeForm: '处理中' },
          { id: '2', content: '已完成任务', status: 'completed' },
        ]}
      />,
    )

    expect(screen.getByText('进行中的任务')).toBeTruthy()
    expect(screen.getByText('已完成 1')).toBeTruthy()
    expect(screen.queryByText('已完成任务')).toBeNull()
  })

  it('expands completed todos on toggle', () => {
    render(
      <TodoTab
        todos={[
          { id: '1', content: '待处理任务', status: 'pending' },
          { id: '2', content: '已完成任务 A', status: 'completed' },
          { id: '3', content: '已完成任务 B', status: 'completed' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /已完成 2/ }))

    expect(screen.getByText('已完成任务 A')).toBeTruthy()
    expect(screen.getByText('已完成任务 B')).toBeTruthy()
  })

  it('can render completed todos expanded initially', () => {
    render(
      <TodoTab
        todos={[
          { id: '1', content: '已完成任务 A', status: 'completed' },
          { id: '2', content: '已完成任务 B', status: 'completed' },
        ]}
        defaultShowCompleted
      />,
    )

    expect(screen.getAllByText('已完成任务 A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已完成任务 B').length).toBeGreaterThan(0)
  })
})
