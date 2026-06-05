'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SopTemplate, SopTemplateDraft } from '@/stores/sop-template-store'

type EditableSop = SopTemplate | SopTemplateDraft

const EMPTY_DRAFT: SopTemplateDraft = {
  name: '',
  icon: null,
  description: null,
  agent_type: 'any',
  instruction: '',
  input_contract: null,
  output_contract: '',
  plan_template: null,
  todo_items_json: null,
}

export function SopEditorModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string
  initial?: Partial<EditableSop>
  onClose: () => void
  onSave: (draft: SopTemplateDraft, id?: string) => void
}) {
  const [draft, setDraft] = useState<SopTemplateDraft>({
    ...EMPTY_DRAFT,
    ...initial,
    icon: initial?.icon ?? null,
    description: initial?.description ?? null,
    input_contract: initial?.input_contract ?? null,
    plan_template: initial?.plan_template ?? null,
    todo_items_json: initial?.todo_items_json ?? null,
  })
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const id = 'id' in (initial ?? {}) ? (initial as SopTemplate).id : undefined
  const outputMissing = !draft.output_contract.trim()
  const canSave = Boolean(draft.name.trim() && draft.instruction.trim() && draft.output_contract.trim())

  const todoPreview = useMemo(() => {
    if (!draft.todo_items_json?.trim()) return []
    try {
      const parsed = JSON.parse(draft.todo_items_json) as Array<{ id?: string; content?: string; status?: string }>
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [draft.todo_items_json])

  const update = useCallback(<K extends keyof SopTemplateDraft>(key: K, value: SopTemplateDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) onSave(draft, id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canSave, draft, id, onClose, onSave])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(3,5,10,.58)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(820px,calc(100vh-32px))] w-full max-w-[760px] flex-col overflow-hidden"
        style={{
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-6 py-4" style={{ borderColor: 'var(--hairline)' }}>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.018em' }}>{title}</div>
            <div className="mt-1 text-[12px]" style={{ color: 'var(--fg-dim)' }}>output contract 为必填，保存后可在创建话题时组合成工作流。</div>
          </div>
          <div className="ml-auto inline-flex rounded-xl p-1" style={{ background: 'rgba(0,0,0,.24)', border: '1px solid var(--hairline)' }}>
            {(['edit', 'preview'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className="h-7 rounded-lg px-3 text-[12px] font-medium"
                style={{
                  background: view === item ? 'rgba(255,255,255,.10)' : 'transparent',
                  color: view === item ? 'var(--fg-strong)' : 'var(--fg-dim)',
                }}
              >
                {item === 'edit' ? '编辑' : '预览'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {view === 'edit' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="名称" value={draft.name} onChange={(value) => update('name', value)} required />
              <label className="block">
                <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--fg-dim)' }}>适用 Agent</span>
                <select
                  value={draft.agent_type}
                  onChange={(e) => update('agent_type', e.target.value as SopTemplateDraft['agent_type'])}
                  className="h-10 w-full rounded-xl px-3 text-sm outline-none"
                  style={{ background: 'rgba(0,0,0,.24)', border: '1px solid var(--hairline-2)', color: 'var(--fg-regular)' }}
                >
                  <option value="any">Any</option>
                  <option value="general">General</option>
                  <option value="programming">Programming</option>
                </select>
              </label>
              <div className="md:col-span-2">
                <TextField label="描述" value={draft.description ?? ''} onChange={(value) => update('description', value || null)} />
              </div>
              <TextArea label="输入契约" value={draft.input_contract ?? ''} onChange={(value) => update('input_contract', value || null)} rows={4} />
              <TextArea label="输出契约" value={draft.output_contract} onChange={(value) => update('output_contract', value)} rows={4} required error={outputMissing ? '必须填写每个 SOP 的结果契约。' : undefined} />
              <div className="md:col-span-2">
                <TextArea label="执行指令" value={draft.instruction} onChange={(value) => update('instruction', value)} rows={7} required />
              </div>
              <TextArea label="Plan 模版" value={draft.plan_template ?? ''} onChange={(value) => update('plan_template', value || null)} rows={5} />
              <TextArea label="Todos JSON" value={draft.todo_items_json ?? ''} onChange={(value) => update('todo_items_json', value || null)} rows={5} />
            </div>
          ) : (
            <div className="space-y-4">
              <PreviewBlock title={draft.name || '未命名 SOP'}>
                {draft.description || '暂无描述'}
              </PreviewBlock>
              <PreviewBlock title="输入契约">{draft.input_contract || '默认接收用户输入、话题上下文或上一个 SOP 的输出。'}</PreviewBlock>
              <PreviewBlock title="执行指令">{draft.instruction || '暂无执行指令'}</PreviewBlock>
              <PreviewBlock title="输出契约">{draft.output_contract || '未填写'}</PreviewBlock>
              {draft.plan_template && <PreviewBlock title="Plan 模版">{draft.plan_template}</PreviewBlock>}
              {todoPreview.length > 0 && (
                <PreviewBlock title="Todos">
                  {todoPreview.map((item, index) => `${index + 1}. ${item.content ?? ''}`).join('\n')}
                </PreviewBlock>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--hairline)', background: 'rgba(0,0,0,.18)' }}>
          <span className="text-[11.5px]" style={{ color: 'var(--fg-dim)' }}>保存后可在新话题中选择一个或多个 SOP。</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)' }}>
              取消
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => onSave(draft, id)}
              className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold"
              style={{
                background: canSave ? 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)' : 'var(--glass-2)',
                color: canSave ? '#fff' : 'var(--fg-dim)',
                boxShadow: canSave ? 'inset 0 1px 0 rgba(255,255,255,0.26), 0 6px 16px rgba(10,132,255,0.38)' : 'none',
              }}
            >
              保存 SOP
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--fg-dim)' }}>{label}{required ? ' *' : ''}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl px-3 text-sm outline-none"
        style={{ background: 'rgba(0,0,0,.24)', border: '1px solid var(--hairline-2)', color: 'var(--fg-regular)' }}
      />
    </label>
  )
}

function TextArea({ label, value, onChange, rows, required, error }: { label: string; value: string; onChange: (value: string) => void; rows: number; required?: boolean; error?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--fg-dim)' }}>{label}{required ? ' *' : ''}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'rgba(0,0,0,.24)', border: `1px solid ${error ? 'rgba(255,69,58,.55)' : 'var(--hairline-2)'}`, color: 'var(--fg-regular)' }}
      />
      {error && <span className="mt-1 block text-[12px]" style={{ color: '#FF8B82' }}>{error}</span>}
    </label>
  )
}

function PreviewBlock({ title, children }: { title: string; children: string }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--fg-strong)' }}>{title}</h3>
      <pre className="whitespace-pre-wrap rounded-xl p-3 text-[12px] leading-5" style={{ background: 'rgba(0,0,0,.24)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)', fontFamily: 'var(--font-mono)' }}>{children}</pre>
    </section>
  )
}
