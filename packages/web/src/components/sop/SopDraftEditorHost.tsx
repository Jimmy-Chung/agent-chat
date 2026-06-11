'use client'

import { getWsClient } from '@/lib/ws-client'
import {
  type SopTemplateDraft,
  useSopTemplateStore,
} from '@/stores/sop-template-store'
import { useToastStore } from '@/stores/toast-store'
import { useCallback } from 'react'
import { SopEditorModal } from './SopEditorModal'

/**
 * Global host for the SOP draft editor: whenever the server returns a
 * generated draft (sop_template.generated — attention export or history
 * generation), open the editor so the user reviews and edits the draft before
 * it is persisted via sop_template.create.
 */
export function SopDraftEditorHost() {
  const generatedDraft = useSopTemplateStore((s) => s.generatedDraft)
  const setGeneratedDraft = useSopTemplateStore((s) => s.setGeneratedDraft)

  const close = useCallback(() => {
    setGeneratedDraft(null)
  }, [setGeneratedDraft])

  const save = useCallback(
    (draft: SopTemplateDraft) => {
      const sent = getWsClient().send({
        type: 'sop_template.create',
        data: {
          name: draft.name,
          icon: draft.icon,
          description: draft.description,
          agent_type: draft.agent_type,
          instruction: draft.instruction,
          input_contract: draft.input_contract,
          output_contract: draft.output_contract,
          plan_template: draft.plan_template,
          todo_items_json: draft.todo_items_json,
        },
      })
      if (!sent) {
        useToastStore.getState().pushToast({
          tone: 'error',
          title: 'SOP 保存失败',
          description: '连接不可用，请稍后重试。草稿仍保留在编辑器中。',
        })
        return
      }
      setGeneratedDraft(null)
      useToastStore.getState().pushToast({
        tone: 'success',
        title: 'SOP 已保存',
        description: '可在 SOP 中心查看，或在新建话题时组合为工作流。',
        durationMs: 5000,
      })
    },
    [setGeneratedDraft],
  )

  if (!generatedDraft) return null

  return (
    <SopEditorModal
      title="编辑 SOP 草稿"
      initial={generatedDraft}
      onClose={close}
      onSave={save}
    />
  )
}
