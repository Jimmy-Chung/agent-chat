'use client'

import { getWsClient } from '@/lib/ws-client'
import {
  type SopTemplate,
  type SopTemplateDraft,
  useSopTemplateStore,
} from '@/stores/sop-template-store'
import { useToastStore } from '@/stores/toast-store'
import { useState } from 'react'
import { SopEditorModal } from './SopEditorModal'

export function SopLibraryView() {
  const templates = useSopTemplateStore((s) => s.templates)
  const [editingTemplate, setEditingTemplate] = useState<SopTemplate | null>(
    null,
  )

  const saveEdit = (draft: SopTemplateDraft, id?: string) => {
    if (!id) return
    const sent = getWsClient().send({
      type: 'sop_template.update',
      data: {
        id,
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
        description: '连接不可用，请稍后重试。',
      })
      return
    }
    setEditingTemplate(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h3
            className="text-[15px] font-semibold"
            style={{ color: 'var(--fg-strong)' }}
          >
            SOP 中心
          </h3>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--fg-dim)' }}>
            管理从注意力面板导出的 SOP，并在新话题中组合为工作流。
          </p>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {templates.map((template) => (
            <SopTemplateCard
              key={template.id}
              template={template}
              onEdit={
                template.builtin
                  ? undefined
                  : () => setEditingTemplate(template)
              }
              onDelete={() =>
                getWsClient().send({
                  type: 'sop_template.delete',
                  data: { id: template.id },
                })
              }
            />
          ))}
        </div>
      )}
      {templates.length === 0 && (
        <p
          className="py-8 text-center text-sm"
          style={{ color: 'var(--fg-dim)' }}
        >
          暂无 SOP，请从注意力面板导出。
        </p>
      )}

      {editingTemplate && (
        <SopEditorModal
          title="编辑 SOP"
          initial={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  )
}

function SopTemplateCard({
  template,
  onEdit,
  onDelete,
}: { template: SopTemplate; onEdit?: () => void; onDelete: () => void }) {
  return (
    <div className="glass-1 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {template.icon && <span>{template.icon}</span>}
            <span
              className="truncate text-sm font-medium"
              style={{ color: 'var(--fg-strong)' }}
            >
              {template.name}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}
            >
              {template.agent_type}
            </span>
          </div>
          {template.description && (
            <p
              className="mt-2 line-clamp-2 break-words text-xs"
              style={{ color: 'var(--fg-dim)' }}
            >
              {template.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg px-2 py-1 text-[12px]"
              style={{
                color: '#8FC6FF',
                background: 'rgba(10,132,255,.10)',
                border: '1px solid rgba(10,132,255,.22)',
              }}
            >
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg px-2 py-1 text-[12px]"
            style={{
              color: 'var(--state-danger)',
              background: 'rgba(255,69,58,.10)',
              border: '1px solid rgba(255,69,58,.20)',
            }}
          >
            删除
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-[12px] md:grid-cols-2">
        <PreviewLine label="输入" value={template.input_contract || '默认'} />
        <PreviewLine label="输出" value={template.output_contract} />
      </div>
    </div>
  )
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex min-w-0 items-baseline gap-1 rounded-lg px-2 py-1.5"
      style={{
        background: 'rgba(0,0,0,.18)',
        border: '1px solid var(--hairline)',
      }}
    >
      <span className="shrink-0" style={{ color: 'var(--fg-dim)' }}>
        {label}
      </span>
      <span
        className="min-w-0 flex-1 truncate"
        title={value}
        style={{ color: 'var(--fg-regular)' }}
      >
        {value}
      </span>
    </div>
  )
}
