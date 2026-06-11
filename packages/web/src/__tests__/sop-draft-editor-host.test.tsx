import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SopDraftEditorHost } from '../components/sop/SopDraftEditorHost'
import {
  type SopTemplateDraft,
  useSopTemplateStore,
} from '../stores/sop-template-store'

const send = vi.fn(() => true)

vi.mock('../lib/ws-client', () => ({
  getWsClient: () => ({ send }),
}))

const DRAFT: SopTemplateDraft = {
  name: '数据分析 SOP',
  icon: null,
  description: '从注意力节点提炼的工作流',
  agent_type: 'any',
  instruction: '步骤 1：拉取数据\n输入：数据源\n动作：校验后拉取\n产出：数据集',
  input_contract: '提供数据源与目标',
  output_contract: '交付分析结论',
  plan_template: '1. 拉取数据',
  todo_items_json: JSON.stringify([
    { id: '1', content: '拉取数据', status: 'pending' },
  ]),
}

beforeEach(() => {
  act(() => {
    useSopTemplateStore.getState().setGeneratedDraft(null)
  })
})

afterEach(() => {
  cleanup()
  send.mockClear()
})

describe('SopDraftEditorHost', () => {
  // TC-249-02（前端部分）
  it('opens the editor when a generated draft arrives', () => {
    render(<SopDraftEditorHost />)
    expect(screen.queryByText('保存 SOP')).toBeNull()

    act(() => {
      useSopTemplateStore.getState().setGeneratedDraft(DRAFT)
    })

    expect(screen.getByText('编辑 SOP 草稿')).toBeTruthy()
    expect((screen.getByLabelText('名称 *') as HTMLInputElement).value).toBe(
      '数据分析 SOP',
    )
    expect(
      (screen.getByLabelText('适用 Agent') as HTMLSelectElement).value,
    ).toBe('any')
  })

  // TC-249-03
  it('saves the edited draft via sop_template.create and clears the draft', () => {
    render(<SopDraftEditorHost />)
    act(() => {
      useSopTemplateStore.getState().setGeneratedDraft(DRAFT)
    })

    fireEvent.change(screen.getByLabelText('名称 *'), {
      target: { value: '改名后的 SOP' },
    })
    fireEvent.click(screen.getByText('保存 SOP'))

    expect(send).toHaveBeenCalledWith({
      type: 'sop_template.create',
      data: expect.objectContaining({
        name: '改名后的 SOP',
        agent_type: 'any',
        instruction: DRAFT.instruction,
        output_contract: DRAFT.output_contract,
        plan_template: DRAFT.plan_template,
        todo_items_json: DRAFT.todo_items_json,
      }),
    })
    expect(useSopTemplateStore.getState().generatedDraft).toBeNull()
    expect(screen.queryByText('编辑 SOP 草稿')).toBeNull()
  })

  // TC-249-05（前端部分）
  it('persists an agent_type change made in the editor', () => {
    render(<SopDraftEditorHost />)
    act(() => {
      useSopTemplateStore.getState().setGeneratedDraft(DRAFT)
    })

    fireEvent.change(screen.getByLabelText('适用 Agent'), {
      target: { value: 'programming' },
    })
    fireEvent.click(screen.getByText('保存 SOP'))

    expect(send).toHaveBeenCalledWith({
      type: 'sop_template.create',
      data: expect.objectContaining({ agent_type: 'programming' }),
    })
  })

  it('discards the draft on close without sending anything', () => {
    render(<SopDraftEditorHost />)
    act(() => {
      useSopTemplateStore.getState().setGeneratedDraft(DRAFT)
    })

    fireEvent.click(screen.getByText('取消'))

    expect(send).not.toHaveBeenCalled()
    expect(useSopTemplateStore.getState().generatedDraft).toBeNull()
  })
})
