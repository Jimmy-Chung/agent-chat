'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { useWsStore } from '@/stores/ws-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { TopicItem } from './TopicItem'
import { DeleteTopicModal } from '@/components/chat/DeleteTopicModal'
import { getWsClient } from '@/lib/ws-client'
import { requestPushPermission } from '@/components/PushSetup'
import { ConnectionConfigModal, PI_WSS_URL_KEY, PI_TOKEN_KEY } from '@/components/ConnectionConfigModal'

type PermissionTier = 'yolo' | 'normal'

type AgentType = 'general' | 'programming'
type ExtensionType = 'claude-code' | 'codex'

const EMPTY_ARTIFACTS: import('@agent-chat/protocol').Artifact[] = []

export function Sidebar() {
  const topics = useTopicStore((s) => s.topics)
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const selectTopic = useTopicStore((s) => s.selectTopic)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [search, setSearch] = useState('')
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicAgent, setNewTopicAgent] = useState<AgentType>('general')
  const [extension, setExtension] = useState<ExtensionType>('claude-code')
  const [cwd, setCwd] = useState('')
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('normal')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [deletingTopic, setDeletingTopic] = useState<{ id: string; name: string } | null>(null)
  const [showConnConfig, setShowConnConfig] = useState(false)
  const templates = useSopTemplateStore((s) => s.templates)
  const wsStatus = useWsStore((s) => s.status)
  const sessionHealthByTopic = useWsStore((s) => s.sessionHealthByTopic)
  const artifactsByTopic = useArtifactStore((s) => s.byTopic)
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)

  const programmingTemplates = useMemo(
    () => templates.filter((t) => t.agent_type === 'any' || t.agent_type === newTopicAgent),
    [templates, newTopicAgent],
  )

  const closeNewTopicModal = () => {
    setShowNewTopic(false)
    setNewTopicName('')
    setNewTopicAgent('general')
    setExtension('claude-code')
    setPermissionTier('normal')
    setCwd('')
    setSelectedTemplateId('')
  }

  const handleCreateTopic = () => {
    const name = newTopicName.trim()
    if (!name) return

    const permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' =
      permissionTier === 'yolo' ? 'bypassPermissions' : 'default'

    getWsClient().send({
      type: 'topic.create',
      data: {
        name,
        agentType: newTopicAgent,
        sopTemplateId: selectedTemplateId || undefined,
        ...(newTopicAgent === 'programming'
          ? {
              programming: {
                extension,
                yolo: permissionTier === 'yolo',
                ...(cwd ? { cwd } : {}),
                permissionMode,
              },
            }
          : {}),
      },
    })

    closeNewTopicModal()
  }

  const systemTopics = topics.filter((t) => t.kind !== 'normal')
  const normalTopics = topics.filter((t) => t.kind === 'normal')

  const filteredNormal = search
    ? normalTopics.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : normalTopics

  return (
    <>
      <div
        className="flex h-full flex-col"
        style={{
          background: 'rgba(21,23,28,0.55)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          borderRight: '1px solid var(--hairline)',
        }}
      >
        <div
          className="flex h-14 shrink-0 items-center gap-2.5 px-3.5"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, #4f5bd5, #962fbf 60%, #d62976)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
            }}
          >
            AC
          </div>
          <span className="flex-1 text-[13.5px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>
            agent-chat
          </span>
          <button
            onClick={toggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-80"
            style={{ color: 'var(--fg-dim)' }}
            aria-label="收起侧边栏"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 px-3 pt-3">
          <button
            onClick={() => setShowNewTopic(true)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold"
            style={{
              background: 'linear-gradient(180deg, #2090FF 0%, #0A84FF 50%, #0064D8 100%)',
              color: '#fff',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.15), 0 4px 14px rgba(10,132,255,0.35)',
              letterSpacing: '-0.01em',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            新建话题
          </button>
        </div>

        {systemTopics.length > 0 && (
          <>
            <div className="shrink-0 px-4 pt-4 pb-1.5">
              <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.10em' }}>
                System
              </span>
            </div>
            <div className="shrink-0 px-1.5 flex flex-col gap-px">
              {systemTopics.map((topic) => {
                const badgeCount = topic.kind === 'system_artifact_pool'
                  ? poolArtifacts.length
                  : 0
                return (
                  <TopicItem
                    key={topic.id}
                    topic={topic}
                    active={topic.id === activeTopicId}
                    onClick={() => selectTopic(topic.id)}
                    badgeCount={badgeCount}
                  />
                )
              })}
            </div>
            <div className="mx-4 my-2 shrink-0" style={{ height: 1, background: 'var(--hairline)' }} />
          </>
        )}

        {deletingTopic && createPortal(
          <DeleteTopicModal
            topicId={deletingTopic.id}
            topicName={deletingTopic.name}
            onClose={() => setDeletingTopic(null)}
          />,
          document.body,
        )}

        <div className="shrink-0 px-4 pb-1.5 pt-1">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.10em' }}>
            Topics
          </span>
        </div>

        <div className="shrink-0 px-3 pb-2">
          <input
            type="text"
            placeholder="搜索话题..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 text-sm outline-none"
            style={{
              backgroundColor: 'var(--glass-1)',
              color: 'var(--fg-regular)',
              border: '1px solid var(--hairline)',
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-1.5">
          {filteredNormal.length === 0 && (
            <p className="px-3 py-4 text-center text-xs" style={{ color: 'var(--fg-dim)' }}>
              暂无话题
            </p>
          )}
          {filteredNormal.map((topic) => (
            <TopicItem
              key={topic.id}
              topic={topic}
              active={topic.id === activeTopicId}
              onClick={() => selectTopic(topic.id)}
              onDelete={(id, name) => setDeletingTopic({ id, name })}
              badgeCount={(artifactsByTopic[topic.id] ?? EMPTY_ARTIFACTS).length}
            />
          ))}
        </div>

        <div
          className="flex shrink-0 items-center gap-2 px-3.5 py-2.5 text-xs"
          style={{ borderTop: '1px solid var(--hairline)', color: 'var(--fg-dim)' }}
        >
          <PiStatusBadge
            piState={activeTopicId ? sessionHealthByTopic[activeTopicId]?.state : undefined}
            wsStatus={wsStatus}
            onClick={() => setShowConnConfig(true)}
          />
          <NotificationBell />
          <span className="ml-auto text-[11px]" style={{ fontFeatureSettings: '"tnum"' }}>v1.5.0</span>
        </div>
      </div>

      {showNewTopic && typeof document !== 'undefined'
        ? createPortal(
            <CreateTopicModal
              name={newTopicName}
              agentType={newTopicAgent}
              extension={extension}
              cwd={cwd}
              permissionTier={permissionTier}
              selectedTemplateId={selectedTemplateId}
              templates={programmingTemplates}
              onClose={closeNewTopicModal}
              onSubmit={handleCreateTopic}
              onNameChange={setNewTopicName}
              onAgentTypeChange={setNewTopicAgent}
              onExtensionChange={setExtension}
              onPermissionTierChange={setPermissionTier}
              onSelectedTemplateIdChange={setSelectedTemplateId}
              onCwdChange={setCwd}
            />,
            document.body,
          )
        : null}

      {showConnConfig && typeof document !== 'undefined'
        ? createPortal(
            <ConnectionConfigModal
              initialWssUrl={typeof window !== 'undefined' ? localStorage.getItem(PI_WSS_URL_KEY) ?? '' : ''}
              initialToken={typeof window !== 'undefined' ? localStorage.getItem(PI_TOKEN_KEY) ?? '' : ''}
              onConfirm={(config) => {
                setShowConnConfig(false)
                window.dispatchEvent(new CustomEvent('agent-chat:pi-config-changed', { detail: config }))
              }}
              onClose={() => setShowConnConfig(false)}
            />,
            document.body,
          )
        : null}
    </>
  )
}

function CreateTopicModal({
  name,
  agentType,
  extension,
  cwd,
  permissionTier,
  selectedTemplateId,
  templates,
  onClose,
  onSubmit,
  onNameChange,
  onAgentTypeChange,
  onExtensionChange,
  onPermissionTierChange,
  onSelectedTemplateIdChange,
  onCwdChange,
}: {
  name: string
  agentType: AgentType
  extension: ExtensionType
  cwd: string
  permissionTier: PermissionTier
  selectedTemplateId: string
  templates: Array<{
    id: string
    name: string
    icon: string | null
    description: string | null
    agent_type: 'programming' | 'general' | 'any'
    workflow_mode: 'lazy' | 'eager' | 'off'
    builtin: boolean
    created_at: number
    updated_at: number
  }>
  onClose: () => void
  onSubmit: () => void
  onNameChange: (value: string) => void
  onAgentTypeChange: (value: AgentType) => void
  onExtensionChange: (value: ExtensionType) => void
  onPermissionTierChange: (value: PermissionTier) => void
  onSelectedTemplateIdChange: (value: string) => void
  onCwdChange: (value: string) => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && !e.shiftKey) onSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onSubmit])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(3, 5, 10, 0.52)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] flex-col overflow-hidden"
        style={{
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
        }}
      >
        <div className="border-b px-6 py-5" style={{ borderColor: 'var(--hairline)' }}>
          <div className="text-[18px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.018em' }}>
            创建新话题
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-dim)' }}>
            选择 Agent 类型与运行方式，创建一个新的工作上下文。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <Field label="话题名称">
              <input
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                autoFocus
                placeholder="例如：优化移动端布局"
                className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                style={{
                  background: 'rgba(0,0,0,.28)',
                  color: 'var(--fg-strong)',
                  border: '1px solid var(--hairline-2)',
                }}
              />
            </Field>

            <Field label="Agent 类型">
              <div className="grid grid-cols-2 gap-2 rounded-2xl p-1" style={{ background: 'rgba(0,0,0,.24)', border: '1px solid var(--hairline)' }}>
                <SegmentedOption
                  active={agentType === 'general'}
                  title="General"
                  description="通用对话与轻任务"
                  onClick={() => onAgentTypeChange('general')}
                />
                <SegmentedOption
                  active={agentType === 'programming'}
                  title="Programming"
                  description="代码、终端与工作目录"
                  onClick={() => onAgentTypeChange('programming')}
                />
              </div>
            </Field>

            {templates.length > 0 && (
              <Field label="SOP 模板">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => onSelectedTemplateIdChange(e.target.value)}
                  className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                  style={{
                    background: 'rgba(0,0,0,.28)',
                    color: 'var(--fg-regular)',
                    border: '1px solid var(--hairline-2)',
                  }}
                >
                  <option value="">不使用模板</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.icon ? `${t.icon} ` : ''}
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {agentType === 'programming' && (
              <div className="space-y-5 rounded-[20px] p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--hairline)' }}>
                <Field label="Extension">
                  <div className="grid grid-cols-2 gap-2">
                    <SegmentedPill active={extension === 'claude-code'} onClick={() => onExtensionChange('claude-code')}>
                      Claude Code
                    </SegmentedPill>
                    <SegmentedPill active={extension === 'codex'} onClick={() => onExtensionChange('codex')}>
                      Codex
                    </SegmentedPill>
                  </div>
                </Field>

                <Field label="YOLO 模式">
                  <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3" style={{ background: 'rgba(0,0,0,.22)', border: '1px solid var(--hairline)' }}>
                    <Switch checked={permissionTier === 'yolo'} onChange={(checked) => onPermissionTierChange(checked ? 'yolo' : 'normal')} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>YOLO</div>
                      <div className="text-[12px] leading-5" style={{ color: 'var(--fg-dim)' }}>
                        {permissionTier === 'yolo'
                          ? '跳过所有权限检查，Agent 可自由操作。'
                          : '关闭后，Agent 修改文件时需要你逐一确认。'}
                      </div>
                    </div>
                  </div>
                </Field>

                <Field label="Permission Mode">
                  <div className="space-y-2">
                    <RadioCard
                      active={permissionTier === 'normal'}
                      title="普通"
                      description="Agent 修改文件时需逐一确认。"
                      onClick={() => onPermissionTierChange('normal')}
                    />
                    <RadioCard
                      active={permissionTier === 'yolo'}
                      tone="danger"
                      title="YOLO"
                      description="跳过所有权限检查，适合你愿意完全放权时使用。"
                      onClick={() => onPermissionTierChange('yolo')}
                    />
                  </div>
                </Field>

                <Field label="Working Directory">
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-sm"
                      style={{
                        background: 'rgba(0,0,0,.22)',
                        border: '1px solid var(--hairline-2)',
                        color: cwd ? 'var(--fg-strong)' : 'var(--fg-dim)',
                      }}
                    >
                      <span className="truncate">{cwd || '留空则自动创建工作目录'}</span>
                      <span className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>Folder</span>
                    </button>
                    <input
                      type="text"
                      value={cwd}
                      onChange={(e) => onCwdChange(e.target.value)}
                      placeholder="可选：手动输入工作目录"
                      className="h-10 w-full rounded-xl px-3.5 text-sm outline-none"
                      style={{
                        background: 'rgba(0,0,0,.20)',
                        color: 'var(--fg-regular)',
                        border: '1px solid var(--hairline)',
                      }}
                    />
                  </div>
                </Field>
              </div>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-3 border-t px-5 py-4"
          style={{ borderColor: 'var(--hairline)', background: 'rgba(0,0,0,0.18)' }}
        >
          <span className="text-[11.5px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>Esc</kbd>
            {' '}关闭
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)' }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!name.trim()}
              className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold"
              style={{
                background: name.trim() ? 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)' : 'var(--glass-2)',
                color: name.trim() ? '#fff' : 'var(--fg-dim)',
                boxShadow: name.trim() ? 'inset 0 1px 0 rgba(255,255,255,0.26), 0 6px 16px rgba(10,132,255,0.38)' : 'none',
              }}
            >
              创建话题
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] font-medium" style={{ color: 'var(--fg-dim)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function SegmentedOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[14px] px-3 py-3 text-left transition-all"
      style={{
        background: active ? 'linear-gradient(180deg, rgba(32,144,255,.28), rgba(10,132,255,.18))' : 'transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-dim)',
        boxShadow: active ? 'inset 0 0 0 1px rgba(108,177,255,.38), 0 0 18px rgba(10,132,255,.18)' : 'inset 0 0 0 1px transparent',
      }}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-[12px] leading-5">{description}</div>
    </button>
  )
}

function SegmentedPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 rounded-xl px-3 text-sm font-medium transition-all"
      style={{
        background: active ? 'rgba(10,132,255,.18)' : 'rgba(0,0,0,.18)',
        color: active ? '#8bc3ff' : 'var(--fg-dim)',
        border: active ? '1px solid rgba(108,177,255,.34)' : '1px solid var(--hairline)',
        boxShadow: active ? '0 0 16px rgba(10,132,255,.16)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function RadioCard({
  active,
  title,
  description,
  onClick,
  tone = 'default',
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  const activeColor = tone === 'danger' ? '#FF8B82' : '#7CB6FF'
  const activeBorder = tone === 'danger' ? 'rgba(255,69,58,.34)' : 'rgba(108,177,255,.34)'
  const activeBg = tone === 'danger' ? 'rgba(255,69,58,.10)' : 'rgba(10,132,255,.12)'

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition-all"
      style={{
        background: active ? activeBg : 'rgba(0,0,0,.18)',
        border: active ? `1px solid ${activeBorder}` : '1px solid var(--hairline)',
      }}
    >
      <span
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{
          border: `1px solid ${active ? activeColor : 'var(--hairline-2)'}`,
          background: active ? activeColor : 'transparent',
          boxShadow: active ? `0 0 12px ${activeColor}33` : 'none',
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? '#fff' : 'transparent' }} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: active ? 'var(--fg-strong)' : 'var(--fg-regular)' }}>{title}</span>
        <span className="mt-1 block text-[12px] leading-5" style={{ color: 'var(--fg-dim)' }}>{description}</span>
      </span>
    </button>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-7 w-12 shrink-0 rounded-full transition-all"
      style={{
        background: checked ? 'linear-gradient(180deg, #38d073, #22c55e)' : 'rgba(255,255,255,.14)',
        boxShadow: checked ? '0 0 16px rgba(34,197,94,.25)' : 'inset 0 0 0 1px var(--hairline)',
      }}
    >
      <span
        className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all"
        style={{ left: checked ? 22 : 2, boxShadow: '0 3px 10px rgba(0,0,0,.24)' }}
      />
    </button>
  )
}

function NotificationBell() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'denied',
  )

  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return null
  if (permission === 'denied') return null

  const granted = permission === 'granted'

  const handleClick = async () => {
    if (granted) return
    const ok = await requestPushPermission()
    if (ok) setPermission('granted')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={granted ? '推送通知已开启' : '开启推送通知'}
      className="inline-flex items-center justify-center rounded-full transition-opacity"
      style={{
        width: 22,
        height: 22,
        background: granted ? 'rgba(48,209,88,0.12)' : 'rgba(255,255,255,0.06)',
        border: granted ? '1px solid rgba(48,209,88,0.28)' : '1px solid var(--hairline)',
        color: granted ? '#6FE39A' : 'var(--fg-dim)',
        cursor: granted ? 'default' : 'pointer',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
      </svg>
    </button>
  )
}

function PiStatusBadge({ piState, wsStatus, onClick }: {
  piState: string | undefined
  wsStatus: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'span'
  const interactive = onClick ? 'cursor-pointer transition-opacity hover:opacity-80' : ''

  // PI adapter connected
  if (piState === 'connected') {
    return (
      <Tag
        {...(onClick ? { onClick, title: '点击配置 PI Adapter 连接' } : {})}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${interactive}`}
        style={{ height: 22, background: 'rgba(48,209,88,0.10)', color: '#6FE39A', border: '1px solid rgba(48,209,88,0.22)' }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--state-ok)', boxShadow: '0 0 8px var(--state-ok)' }} />
        PI 已连接
      </Tag>
    )
  }
  // PI adapter reconnecting
  if (piState === 'reconnecting') {
    return (
      <Tag
        {...(onClick ? { onClick, title: '点击配置 PI Adapter 连接' } : {})}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${interactive}`}
        style={{ height: 22, background: 'rgba(255,159,10,0.12)', color: '#FFB340', border: '1px solid rgba(255,159,10,0.28)' }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#FFB340' }} />
        重连中...
      </Tag>
    )
  }
  // PI adapter explicitly disconnected
  if (piState === 'disconnected') {
    return (
      <Tag
        {...(onClick ? { onClick, title: '点击配置 PI Adapter 连接' } : {})}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${interactive}`}
        style={{ height: 22, background: 'rgba(255,69,58,0.10)', color: '#FF6B6B', border: '1px solid rgba(255,69,58,0.22)' }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--state-danger)' }} />
        PI 已断开
      </Tag>
    )
  }
  // No PI session yet — fall back to server WS status
  const ok = wsStatus === 'connected'
  return (
    <Tag
      {...(onClick ? { onClick, title: '点击配置 PI Adapter 连接' } : {})}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${interactive}`}
      style={{
        height: 22,
        background: ok ? 'rgba(48,209,88,0.10)' : 'rgba(255,69,58,0.10)',
        color: ok ? '#6FE39A' : '#FF6B6B',
        border: ok ? '1px solid rgba(48,209,88,0.22)' : '1px solid rgba(255,69,58,0.22)',
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: ok ? 'var(--state-ok)' : 'var(--state-danger)', boxShadow: ok ? '0 0 8px var(--state-ok)' : 'none' }}
      />
      {ok ? '已连接' : wsStatus === 'connecting' ? '连接中...' : '已断开'}
    </Tag>
  )
}
