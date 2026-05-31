'use client'

import { useEffect, useState, useCallback } from 'react'
import { useWsStore, MODEL_ALIASES, type ModelAlias } from '@/stores/ws-store'
import type { ProviderConfig, ModelMapping } from '@/stores/ws-store'
import { useToastStore } from '@/stores/toast-store'
import { sendProviderRpc } from '@/lib/ws-client'
import { buildModelMappingPayload } from '@/lib/model-mapping'

type ViewMode = 'list' | 'add' | 'edit'

const GROUPS = ['claude-code', 'codex', 'pi-agent'] as const

export const GROUP_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'pi-agent': 'PI Agent',
}

export const GROUP_SHORT: Record<string, string> = {
  'claude-code': 'CC',
  'codex': 'Codex',
  'pi-agent': 'PI',
}

export const GROUP_ICONS: Record<string, React.ReactNode> = {
  'claude-code': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" />
    </svg>
  ),
  'codex': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" /><polyline points="3 7 12 13 21 7" /><path d="m9 11-3 3 3 3" /><path d="m15 11 3 3-3 3" />
    </svg>
  ),
  'pi-agent': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.95 16.95l2.15 2.15M4.9 19.1l2.1-2.1M16.95 7.05l2.15-2.15" />
    </svg>
  ),
}

function maskApiKey(key: string): string {
  if (key.length <= 4) return '••••'
  return `••••${key.slice(-4)}`
}

export function ProviderConfigModal({
  onClose,
}: {
  onClose: () => void
}) {
  const providerConfigs = useWsStore((s) => s.providerConfigs)
  const setProviderConfigs = useWsStore((s) => s.setProviderConfigs)
  const [view, setView] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Form state
  const [formName, setFormName] = useState('')
  const [formGroup, setFormGroup] = useState<string>('claude-code')
  const [formApiKey, setFormApiKey] = useState('')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formModels, setFormModels] = useState<string[]>([])
  const [lockedModels, setLockedModels] = useState<string[]>([])
  const [modelInput, setModelInput] = useState('')
  // claude-code 别名→真实模型映射（opus/sonnet/haiku）
  const [formModelMapping, setFormModelMapping] = useState<Record<ModelAlias, string>>({
    opus: '', sonnet: '', haiku: '',
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    useWsStore.getState().setProviderConfigsLoading(true)
    try {
      const result = await sendProviderRpc('listProviderConfigs', {}) as ProviderConfig[]
      setProviderConfigs(result ?? [])
      useWsStore.getState().setProviderConfigs(result ?? [])
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false)
      useWsStore.getState().setProviderConfigsLoading(false)
    }
  }, [setProviderConfigs])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  const grouped = (() => {
    const map: Record<string, ProviderConfig[]> = {}
    for (const g of GROUPS) map[g] = []
    for (const c of providerConfigs) {
      const g = c.group ?? 'pi-agent'
      if (map[g]) map[g].push(c)
      else map[g] = [c]
    }
    return map
  })()

  const totalCount = providerConfigs.length
  const groupCount = GROUPS.filter((g) => grouped[g]?.length > 0).length
  const isEmpty = totalCount === 0 && !loading

  const openAdd = (group?: string) => {
    setView('add')
    setEditingId(null)
    setFormName('')
    setFormGroup(group ?? 'claude-code')
    setFormApiKey('')
    setFormBaseUrl('')
    setFormModels([])
    setLockedModels([])
    setModelInput('')
    setFormModelMapping({ opus: '', sonnet: '', haiku: '' })
    setShowApiKey(false)
    setError('')
  }

  const openEdit = (cfg: ProviderConfig) => {
    setView('edit')
    setEditingId(cfg.id)
    setFormName(cfg.name)
    setFormGroup(cfg.group ?? 'pi-agent')
    setFormApiKey('')
    setFormBaseUrl(cfg.baseUrl ?? '')
    setFormModels(cfg.models ?? [])
    // isDefault providers: lock built-in models so they can't be removed
    setLockedModels(cfg.isDefault ? (cfg.models ?? []) : [])
    setModelInput('')
    setFormModelMapping({
      opus: cfg.modelMapping?.opus ?? '',
      sonnet: cfg.modelMapping?.sonnet ?? '',
      haiku: cfg.modelMapping?.haiku ?? '',
    })
    setShowApiKey(false)
    setError('')
  }

  const backToList = () => {
    setView('list')
    setEditingId(null)
    setError('')
    setDeletingId(null)
  }

  const handleSave = async () => {
    if (!formName.trim()) { setError('名称不能为空'); return }
    if (!formGroup) { setError('请选择分组'); return }
    if (view === 'add' && !formApiKey.trim()) { setError('API Key 不能为空'); return }

    // claude-code 的模型固定为别名 opus/sonnet/haiku（下拉选项），真实模型走 modelMapping；
    // 其它分组沿用自由录入的 models。
    const isClaudeCode = formGroup === 'claude-code'
    const models = isClaudeCode ? [...MODEL_ALIASES] : formModels
    if (!isClaudeCode && models.length === 0) { setError('至少需要一个模型'); return }
    const mapping = isClaudeCode ? buildModelMappingPayload(formModelMapping) : {}

    setSaving(true)
    setError('')
    try {
      if (view === 'add') {
        await sendProviderRpc('addProviderConfig', {
          name: formName.trim(),
          provider: formName.trim(),
          apiKey: formApiKey.trim(),
          models,
          group: formGroup,
          ...(formBaseUrl.trim() ? { baseUrl: formBaseUrl.trim() } : {}),
          ...(isClaudeCode ? { modelMapping: mapping } : {}),
        })
      } else if (editingId) {
        const params: Record<string, unknown> = {}
        params.id = editingId
        if (formName.trim()) params.name = formName.trim()
        if (formName.trim()) params.provider = formName.trim()
        if (formApiKey.trim()) params.apiKey = formApiKey.trim()
        params.models = models
        if (formGroup) params.group = formGroup
        if (formBaseUrl.trim()) params.baseUrl = formBaseUrl.trim()
        // 传入即覆盖；空对象清除全部别名映射（契约 AIT-200）
        if (isClaudeCode) params.modelMapping = mapping
        await sendProviderRpc('updateProviderConfig', params)
      }
      await fetchConfigs()
      backToList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setSaving(true)
    setError('')
    try {
      await sendProviderRpc('removeProviderConfig', { id })
      await fetchConfigs()
      setDeletingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (id: string, name: string) => {
    setSwitchingId(id)
    const prev = useWsStore.getState().providerConfigs
    // Preserve the provider's group: the adapter replaces the record and would
    // otherwise reset an omitted group to the default (claude-code).
    const target = prev.find((c) => c.id === id)
    useWsStore.getState().setProviderConfigs(
      prev.map((c) => ({ ...c, isActive: c.id === id }))
    )
    try {
      await sendProviderRpc('updateProviderConfig', {
        id,
        isActive: true,
        ...(target?.group ? { group: target.group } : {}),
      })
      await fetchConfigs()
      useToastStore.getState().pushToast({
        tone: 'success',
        title: `已切换至 ${name}`,
        description: '新创建的会话将默认使用该 Provider。已打开的会话不受影响。',
        durationMs: 5000,
      })
    } catch {
      useWsStore.getState().setProviderConfigs(prev)
      useToastStore.getState().pushToast({
        tone: 'error',
        title: '切换失败',
        description: '请稍后重试',
        durationMs: 3000,
      })
    } finally {
      setSwitchingId(null)
    }
  }

  const addModel = () => {
    const name = modelInput.trim()
    if (name && !formModels.includes(name)) {
      setFormModels([...formModels, name])
    }
    setModelInput('')
  }

  const removeModel = (name: string) => {
    if (lockedModels.includes(name)) return
    setFormModels(formModels.filter((m) => m !== name))
  }

  const handleModelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addModel()
    } else if (e.key === 'Backspace' && !modelInput && formModels.length > 0) {
      setFormModels(formModels.slice(0, -1))
    }
  }

  const isListView = view === 'list'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden"
        style={{
          width: 560,
          maxHeight: 'min(680px, calc(100vh - 32px))',
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.012em' }}>
              {isListView ? 'Provider 配置' : view === 'add' ? '新增 Provider' : '编辑 Provider'}
            </h2>
            {isListView && (
              <p className="mt-1 text-[12px]" style={{ color: 'var(--fg-dim)', letterSpacing: '-0.005em', lineHeight: 1.45 }}>
                管理 AI 模型供应商，配置后可在话题中选择使用。
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition-colors"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5" style={{ minHeight: 0 }}>
          {/* Error banner */}
          {error && (
            <div
              className="mb-3 rounded-lg px-3 py-2 text-[12px]"
              style={{ background: 'rgba(255,69,58,0.08)', color: '#FF8B82', border: '1px solid rgba(255,69,58,0.20)' }}
            >
              {error}
            </div>
          )}

          {isListView ? (
            /* ══════════ LIST VIEW ══════════ */
            <div className="flex flex-col gap-3">
              {isEmpty ? (
                /* Empty State */
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-3.5">
                  <div
                    className="flex h-[84px] w-[84px] items-center justify-center rounded-[22px]"
                    style={{
                      background: 'linear-gradient(180deg, rgba(247,194,107,0.18), rgba(247,194,107,0.06))',
                      border: '1px solid rgba(247,194,107,0.32)',
                      color: 'var(--role-cron, #F7C26B)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), 0 0 30px rgba(247,194,107,.22)',
                    }}
                  >
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </div>
                  <div className="text-[16px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.012em' }}>
                    尚未配置任何 Provider
                  </div>
                  <p className="text-[12.5px] max-w-[280px]" style={{ color: 'var(--fg-dim)', lineHeight: 1.55, letterSpacing: '-0.005em' }}>
                    添加第一个 Provider 后才能开始新话题。支持三类：<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4, color: 'var(--fg-code)' }}>claude-code</code> · <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4, color: 'var(--fg-code)' }}>codex</code> · <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4, color: 'var(--fg-code)' }}>pi-agent</code>。
                  </p>
                  <div className="flex gap-1.5 mt-1.5">
                    {GROUPS.map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[10.5px]"
                        style={{
                          background: 'var(--glass-1)',
                          border: '1px solid var(--hairline)',
                          color: 'var(--fg-regular)',
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--fg-dim)' }} />
                        {g} · 0
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                /* Group Cards */
                GROUPS.map((group) => {
                  const configs = grouped[group] ?? []
                  return (
                    <div
                      key={group}
                      className="overflow-hidden"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--hairline)',
                        borderRadius: 12,
                      }}
                    >
                      {/* Group Header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2"
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          borderBottom: configs.length > 0 ? '1px solid var(--hairline)' : 'none',
                          fontSize: 11,
                          color: 'var(--fg-dim)',
                          letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                        }}
                      >
                        <span className="inline-flex">{GROUP_ICONS[group]}</span>
                        {GROUP_LABELS[group]}
                        <span className="text-[10.5px] normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
                          {configs.length === 0 ? 'empty' : `${configs.length}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => openAdd(group)}
                          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] font-semibold normal-case transition-opacity hover:opacity-80"
                          style={{
                            letterSpacing: '-0.005em', textTransform: 'none',
                            background: 'rgba(10,132,255,.12)', color: '#6cb1ff',
                            border: '1px solid rgba(10,132,255,.25)',
                          }}
                        >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                          新增
                        </button>
                      </div>

                      {configs.length === 0 ? (
                        <div className="px-3 py-3.5 text-center text-[11.5px]" style={{ color: 'var(--fg-dim)', letterSpacing: '-0.005em' }}>
                          暂无自定义 Provider · <b style={{ color: 'var(--fg-regular)', fontWeight: 500 }}>+ 新增</b> 后即可使用
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          {configs.map((cfg) => {
                            const isConfirmingDelete = deletingId === cfg.id
                            return (
                              <div
                                key={cfg.id}
                                className="group flex items-center justify-between gap-3 px-3 py-2.5"
                                style={{ borderTop: '1px solid var(--hairline)' }}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: 'var(--state-ok, #30D158)', boxShadow: '0 0 5px var(--state-ok, #30D158)' }} />
                                    <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.005em' }}>
                                      {cfg.name}
                                    </span>
                                    {cfg.isActive && (
                                      <span
                                        className="shrink-0 rounded-md px-1.5 py-px text-[9.5px] font-semibold uppercase"
                                        style={{
                                          background: 'rgba(247,194,107,0.16)',
                                          color: 'var(--role-cron, #F7C26B)',
                                          border: '1px solid rgba(247,194,107,0.30)',
                                          fontFamily: 'var(--font-mono)',
                                          letterSpacing: '0.06em',
                                        }}
                                      >
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className="mt-1 flex items-center gap-1.5 text-[11px]"
                                    style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"', letterSpacing: 0 }}
                                  >
                                    <span style={{ color: 'var(--fg-regular)' }}>apiKey</span>
                                    <span style={{ color: 'var(--fg-strong)', letterSpacing: '0.06em' }}>{maskApiKey(cfg.apiKey ?? '')}</span>
                                    {cfg.baseUrl && (
                                      <>
                                        <span style={{ opacity: 0.4 }}>·</span>
                                        <span className="truncate">{cfg.baseUrl}</span>
                                      </>
                                    )}
                                  </div>
                                  {cfg.models && cfg.models.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {cfg.models.map((m) => {
                                        const real = cfg.modelMapping?.[m as keyof ModelMapping]
                                        return (
                                          <span
                                            key={m}
                                            className="inline-block rounded-md px-1.5 py-px text-[10.5px]"
                                            style={{
                                              background: 'rgba(10,132,255,0.10)',
                                              color: '#7CB6FF',
                                              border: '1px solid rgba(10,132,255,0.26)',
                                              fontFamily: 'var(--font-mono)',
                                            }}
                                          >
                                            {real ? `${m} → ${real}` : m}
                                          </span>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* Actions */}
                                {switchingId === cfg.id ? (
                                  <span className="shrink-0 inline-flex">
                                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none">
                                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
                                      <path d="M8 2a6 6 0 0 1 5.3 3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                  </span>
                                ) : isConfirmingDelete ? (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      onClick={() => handleDelete(cfg.id)}
                                      className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80"
                                      style={{ background: 'rgba(255,69,58,0.15)', color: '#FF8B82' }}
                                    >
                                      确认删除
                                    </button>
                                    <button
                                      onClick={() => setDeletingId(null)}
                                      className="rounded-md px-2 py-1 text-[11px] transition-colors hover:opacity-80"
                                      style={{ color: 'var(--fg-dim)', background: 'var(--glass-1)' }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!cfg.isActive && (
                                      <button
                                        onClick={() => handleActivate(cfg.id, cfg.name)}
                                        className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                                        style={{ color: '#6cb1ff', background: 'rgba(10,132,255,.12)', border: '1px solid rgba(10,132,255,.22)' }}
                                        title="切换为活跃"
                                      >
                                        切换
                                      </button>
                                    )}
                                    <button
                                      onClick={() => openEdit(cfg)}
                                      className="flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:opacity-80"
                                      style={{ color: 'var(--fg-dim)' }}
                                      title="编辑"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                                      </svg>
                                    </button>
                                    {!cfg.isDefault && (
                                      <button
                                        onClick={() => setDeletingId(cfg.id)}
                                        className="flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:opacity-80"
                                        style={{ color: 'var(--state-danger, #FF453A)' }}
                                        title="删除"
                                      >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 6" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            /* ══════════ FORM VIEW ══════════ */
            <div className="flex flex-col gap-3.5">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  名称 <span style={{ color: 'var(--state-danger, #FF453A)' }}>*</span>
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5"
                  style={{
                    height: 34,
                    background: 'rgba(0,0,0,.32)',
                    border: '1px solid rgba(10,132,255,.55)',
                    boxShadow: '0 0 0 3px rgba(10,132,255,.14)',
                  }}
                >
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    autoFocus
                    placeholder="如 anthropic、openai"
                    className="flex-1 bg-transparent text-[13px] outline-none"
                    style={{ color: 'var(--fg-strong)', letterSpacing: '-0.005em' }}
                  />
                </div>
              </div>

              {/* Group - Segmented Control */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  分组 <span style={{ color: 'var(--state-danger, #FF453A)' }}>*</span>
                  {view === 'edit' && (
                    <span className="ml-auto text-[10px] font-medium normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>编辑时锁定</span>
                  )}
                </label>
                <div
                  className="grid gap-[3px] p-[3px] rounded-lg"
                  style={{
                    gridTemplateColumns: `repeat(${GROUPS.length}, 1fr)`,
                    height: 34,
                    background: 'rgba(0,0,0,.32)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {GROUPS.map((g) => {
                    const isActive = formGroup === g
                    return (
                      <button
                        key={g}
                        type="button"
                        disabled={view === 'edit'}
                        onClick={() => setFormGroup(g)}
                        className="flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{
                          background: isActive ? 'rgba(10,132,255,.18)' : 'transparent',
                          color: isActive ? '#fff' : 'var(--fg-regular)',
                          boxShadow: isActive ? 'inset 0 0 0 1px rgba(10,132,255,.55), 0 0 12px rgba(10,132,255,.18), inset 0 1px 0 rgba(255,255,255,.10)' : 'none',
                          fontWeight: isActive ? 600 : 500,
                          letterSpacing: '-0.005em',
                          opacity: view === 'edit' && !isActive ? 0.4 : 1,
                        }}
                      >
                        <span style={{ color: isActive ? '#6cb1ff' : 'var(--fg-dim)' }} className="inline-flex">
                          {GROUP_ICONS[g]}
                        </span>
                        {GROUP_SHORT[g]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* API Key */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  API Key <span style={{ color: 'var(--state-danger, #FF453A)' }}>*</span>
                  <span className="ml-auto text-[10px] font-medium normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>仅本地</span>
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5"
                  style={{
                    height: 34,
                    background: 'rgba(0,0,0,.32)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  <span className="inline-flex shrink-0" style={{ color: 'var(--fg-dim)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder={view === 'edit' ? '留空则不修改' : 'sk-...'}
                    className="flex-1 bg-transparent outline-none"
                    style={{
                      color: 'var(--fg-code)',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-md shrink-0 transition-colors"
                    style={{ color: 'var(--fg-dim)' }}
                    title={showApiKey ? '隐藏' : '显示'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  Base URL
                  <span className="ml-auto text-[10px] font-medium normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>选填</span>
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5"
                  style={{
                    height: 34,
                    background: 'rgba(0,0,0,.32)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  <span className="inline-flex shrink-0" style={{ color: 'var(--fg-dim)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={formBaseUrl}
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="flex-1 bg-transparent outline-none"
                    style={{
                      color: 'var(--fg-code)',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
              </div>

              {/* claude-code: 别名→真实模型映射；其它分组：自由录入模型列表 */}
              {formGroup === 'claude-code' ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  模型别名映射
                  <span className="ml-auto text-[10px] font-medium normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>留空=官方默认</span>
                </label>
                <div className="flex flex-col gap-1.5 rounded-lg p-2" style={{ background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)' }}>
                  {MODEL_ALIASES.map((alias) => (
                    <div key={alias} className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center rounded-md text-[11px] shrink-0"
                        style={{ width: 64, height: 26, background: 'rgba(10,132,255,.14)', border: '1px solid rgba(10,132,255,.32)', color: '#7CB6FF', fontFamily: 'var(--font-mono)' }}
                      >
                        {alias}
                      </span>
                      <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>→</span>
                      <input
                        type="text"
                        value={formModelMapping[alias]}
                        onChange={(e) => setFormModelMapping((prev) => ({ ...prev, [alias]: e.target.value }))}
                        placeholder="真实模型，如 glm-4.6（留空用官方）"
                        className="flex-1 bg-transparent outline-none rounded-md px-2"
                        style={{ height: 26, color: 'var(--fg-code)', fontSize: 12, fontFamily: 'var(--font-mono)', border: '1px solid var(--hairline)' }}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10.5px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0, lineHeight: 1.45 }}>
                  话题内下拉用别名 <code style={{ fontFamily: 'inherit', background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4, color: 'var(--fg-code)' }}>opus/sonnet/haiku</code>；配了映射则显示「别名 → 真实模型」，传给 adapter 的仍是别名。
                </p>
              </div>
              ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10.5px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--fg-regular)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  模型列表 <span style={{ color: 'var(--state-danger, #FF453A)' }}>*</span>
                  <span className="ml-auto text-[10px] font-medium normal-case tracking-normal" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>回车添加</span>
                </label>
                <div
                  className="flex flex-wrap gap-1.5 items-center rounded-lg p-2"
                  style={{
                    minHeight: 60,
                    background: 'rgba(0,0,0,.32)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {formModels.map((m) => {
                    const isLocked = lockedModels.includes(m)
                    return (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-md pl-2 text-[11px]"
                        style={{
                          height: 22,
                          paddingRight: isLocked ? 6 : 4,
                          background: isLocked ? 'rgba(255,255,255,.06)' : 'rgba(10,132,255,.14)',
                          border: isLocked ? '1px solid var(--hairline)' : '1px solid rgba(10,132,255,.32)',
                          color: isLocked ? 'var(--fg-dim)' : '#7CB6FF',
                          fontFamily: 'var(--font-mono)',
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {isLocked && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        )}
                        {m}
                        {!isLocked && (
                          <button
                            onClick={() => removeModel(m)}
                            className="flex h-[14px] w-[14px] items-center justify-center rounded transition-opacity hover:opacity-100"
                            style={{ color: '#7CB6FF', opacity: 0.7 }}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                            </svg>
                          </button>
                        )}
                      </span>
                    )
                  })}
                  <input
                    type="text"
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    onKeyDown={handleModelKeyDown}
                    placeholder={formModels.length === 0 ? '输入模型名，回车添加' : ''}
                    className="flex-1 bg-transparent outline-none text-[12.5px]"
                    style={{
                      minWidth: 80,
                      height: 22,
                      color: 'var(--fg-dim)',
                      letterSpacing: '-0.005em',
                    }}
                  />
                </div>
                <p className="text-[10.5px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', letterSpacing: 0, lineHeight: 1.45 }}>
                  使用 <code style={{ fontFamily: 'inherit', background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4, color: 'var(--fg-code)' }}>↑↓</code> 调整顺序；第一个为该 Provider 默认模型。
                </p>
              </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2.5 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--hairline)', background: 'rgba(0,0,0,0.18)' }}
        >
          {isListView ? (
            <>
              <span className="text-[11px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
                {loading ? '加载中...' : `${totalCount} provider${totalCount !== 1 ? 's' : ''} · ${groupCount} group${groupCount !== 1 ? 's' : ''}`}
              </span>
              <span className="ml-auto">
                <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: 4, color: 'var(--fg-regular)' }}>Esc</kbd>
              </span>
              {!isEmpty && (
                <button
                  onClick={() => openAdd()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 h-[32px] text-[12px] font-semibold transition-colors hover:opacity-90"
                  style={{
                    background: 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)',
                    color: '#fff',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.15), 0 4px 14px rgba(10,132,255,.42)',
                    letterSpacing: '-0.005em',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  新增 Provider
                </button>
              )}
            </>
          ) : (
            <>
              <span>
                <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: 4, color: 'var(--fg-regular)' }}>Esc</kbd>
              </span>
              <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>取消</span>
              <button
                onClick={backToList}
                className="ml-auto inline-flex items-center rounded-lg px-3 h-[32px] text-[12.5px] font-semibold transition-colors"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--fg-regular)',
                  letterSpacing: '-0.005em',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 h-[32px] text-[12.5px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)',
                  color: '#fff',
                  border: 'none',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.15), 0 4px 14px rgba(10,132,255,.42)',
                  letterSpacing: '-0.005em',
                }}
              >
                {saving ? '保存中...' : '保存'}
                <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, background: 'rgba(255,255,255,.18)', padding: '1px 5px', borderRadius: 4, color: 'rgba(255,255,255,.85)', letterSpacing: 0, fontWeight: 500 }}>⌘↩</kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
