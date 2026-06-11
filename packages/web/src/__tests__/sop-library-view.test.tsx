import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SopLibraryView } from '../components/sop/SopLibraryView'
import {
  type SopTemplate,
  useSopTemplateStore,
} from '../stores/sop-template-store'

const send = vi.fn(() => true)

vi.mock('../lib/ws-client', () => ({
  getWsClient: () => ({ send }),
}))

function template(overrides: Partial<SopTemplate> = {}): SopTemplate {
  return {
    id: 'sop-1',
    name: '数据分析 SOP',
    icon: null,
    description: '从注意力节点导出的工作流',
    agent_type: 'any',
    instruction: '步骤 1：拉取数据',
    input_contract: '提供数据源',
    output_contract: '交付分析结论',
    plan_template: '1. 拉取数据',
    todo_items_json: null,
    builtin: false,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

beforeEach(() => {
  act(() => {
    useSopTemplateStore.getState().setTemplates([])
  })
})

afterEach(() => {
  cleanup()
  send.mockClear()
})

describe('SopLibraryView', () => {
  // TC-251-01
  it('opens the editor from a card and saves via sop_template.update with the template id', () => {
    act(() => {
      useSopTemplateStore.getState().setTemplates([template()])
    })
    render(<SopLibraryView />)

    fireEvent.click(screen.getByText('编辑'))
    expect(screen.getByText('编辑 SOP')).toBeTruthy()
    expect((screen.getByLabelText('名称 *') as HTMLInputElement).value).toBe(
      '数据分析 SOP',
    )

    fireEvent.change(screen.getByLabelText('名称 *'), {
      target: { value: '改名后的 SOP' },
    })
    fireEvent.click(screen.getByText('保存 SOP'))

    expect(send).toHaveBeenCalledWith({
      type: 'sop_template.update',
      data: expect.objectContaining({
        id: 'sop-1',
        name: '改名后的 SOP',
        instruction: '步骤 1：拉取数据',
        output_contract: '交付分析结论',
      }),
    })
    expect(screen.queryByText('编辑 SOP')).toBeNull()
  })

  // TC-251-02
  it('hides the edit button for builtin templates', () => {
    act(() => {
      useSopTemplateStore
        .getState()
        .setTemplates([template({ id: 'sop-builtin', builtin: true })])
    })
    render(<SopLibraryView />)

    expect(screen.queryByText('编辑')).toBeNull()
    expect(screen.getByText('删除')).toBeTruthy()
  })

  // TC-251-04
  it('renders contract values inside a truncating flex line', () => {
    const longText = '一段非常长的输出契约'.repeat(20)
    act(() => {
      useSopTemplateStore
        .getState()
        .setTemplates([template({ output_contract: longText })])
    })
    render(<SopLibraryView />)

    const value = screen.getByTitle(longText)
    expect(value.className).toContain('truncate')
    expect(value.className).toContain('min-w-0')
    expect(value.parentElement?.className).toContain('min-w-0')
  })
})
