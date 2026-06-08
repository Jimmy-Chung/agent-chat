'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTopicStore } from '@/stores/topic-store'
import { useWsStore } from '@/stores/ws-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { useCronStore } from '@/stores/cron-store'
import { useToastStore } from '@/stores/toast-store'
import { useMessageStore } from '@/stores/message-store'
import { TopicItem } from './TopicItem'
import { DeleteTopicModal } from '@/components/chat/DeleteTopicModal'
import { Tooltip } from '@/components/ui/Tooltip'
import { HelmLogo, HelmWordmark } from '@/components/ui/HelmLogo'
import { getWsClient } from '@/lib/ws-client'
import { requestPushPermission } from '@/components/PushSetup'
import { PI_WSS_URL_KEY, PI_TOKEN_KEY } from '@/components/ConnectionConfigModal'
import { AdapterConnectionModal } from '@/components/AdapterConnectionModal'
import { ProviderConfigModal } from '@/components/ProviderConfigModal'
import { sendProviderRpc } from '@/lib/ws-client'
import { getServerBase } from '@/lib/server-url'
import { getTopicCwd, getTopicDirectoryLabel, getWorkspaceDirMatches, getWorkspaceRelativePath, joinWorkspacePath, normalizeCwd, resolveWorkspaceCwd, type WorkspaceBrowseResponse } from '@/lib/workspace-path'
import { getActiveProviderForGroup, getActiveProviderIdForExtension, getActiveProviderIdForGroup, getProviderGroup, type ProviderGroup } from '@/lib/provider-selection'
import type { AdapterLinkState, ProviderConfig } from '@/stores/ws-store'
import { resolvePiBadgeState } from '@/lib/connection-status'
import type { SopTemplate } from '@/stores/sop-template-store'

function findTopicByCwd(topics: import('@agent-chat/protocol').Topic[], cwd: string) {
  const normalized = normalizeCwd(cwd)
  return topics.find((topic) => getTopicCwd(topic) === normalized)
}

function formatOccupiedTopic(topic: import('@agent-chat/protocol').Topic): string {
  return `${topic.name} · ${topic.id}`
}

function buildCreateTopicToast(input: {
  code: 'DUPLICATE_NAME' | 'DUPLICATE_CWD'
  occupiedTopic?: import('@agent-chat/protocol').Topic
}) {
  if (input.code === 'DUPLICATE_NAME') {
    return {
      tone: 'warning' as const,
      title: '同名话题已存在',
      description: '请更换话题名称后再创建。',
    }
  }

  return {
    tone: 'warning' as const,
    title: '已有同目录话题',
    description: input.occupiedTopic
      ? formatOccupiedTopic(input.occupiedTopic)
      : '请选择其他工作目录后再创建。',
  }
}

function validateCreateTopic(input: {
  topics: import('@agent-chat/protocol').Topic[]
  name: string
  agentType: AgentType
  cwd: string
}): ReturnType<typeof buildCreateTopicToast> | null {
  const name = input.name.trim()
  if (input.topics.some((topic) => !topic.archived && topic.name === name)) {
    return buildCreateTopicToast({ code: 'DUPLICATE_NAME' })
  }

  if (input.cwd.trim()) {
    const occupiedTopic = findTopicByCwd(input.topics, input.cwd)
    if (occupiedTopic) {
      return buildCreateTopicToast({ code: 'DUPLICATE_CWD', occupiedTopic })
    }
  }

  return null
}

function usePushTopicCreateToast() {
  return useToastStore((s) => s.pushToast)
}

async function fetchWorkspaceBrowse(): Promise<WorkspaceBrowseResponse> {
  const serverUrl = getServerBase()
  const wssUrl = localStorage.getItem(PI_WSS_URL_KEY) || ''
  const piToken = localStorage.getItem(PI_TOKEN_KEY) || ''
  const params = new URLSearchParams()
  if (wssUrl) params.set('wssUrl', wssUrl)
  if (piToken) params.set('piToken', piToken)
  // Include paired device credential so server can sign a JIT JWT for the
  // HTTP proxy call — without this, /workspace fails on the paired path
  // once the pairing-time JWT (TTL=300s) expires.
  try {
    const paired = localStorage.getItem('AGENT_CHAT_PAIRED_DEVICE')
    if (paired) {
      const { deviceCredential, adapterInstanceId } = JSON.parse(paired) as { deviceCredential?: string; adapterInstanceId?: string }
      if (deviceCredential) params.set('deviceCredential', deviceCredential)
      if (adapterInstanceId) params.set('adapterInstanceId', adapterInstanceId)
    }
  } catch { /* ignore */ }

  const agentChatToken = localStorage.getItem('AGENT_CHAT_TOKEN') || ''
  const headers: Record<string, string> = {}
  if (agentChatToken) headers['Authorization'] = `Bearer ${agentChatToken}`

  const res = await fetch(`${serverUrl}/api/agent-chat/v1/workspace?${params}`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error(`workspace browse failed: HTTP ${res.status}`)
  return res.json()
}


type PermissionTier = 'yolo' | 'normal'

type AgentType = 'general' | 'programming'
type ExtensionType = 'claude-code' | 'codex'

const PROVIDER_TAB_DEFS = [
  {
    key: 'claude-code' as const,
    label: 'Claude',
    activeColor: '#7CB6FF',
    countBg: 'rgba(10,132,255,.18)',
    emptyColor: '#7CB6FF',
    emptyBg: 'rgba(10,132,255,.06)',
    emptyBorder: 'rgba(10,132,255,.28)',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/>
      </svg>
    ),
  },
  {
    key: 'codex' as const,
    label: 'Codex',
    activeColor: '#6CD7E8',
    countBg: 'rgba(48,176,199,.18)',
    emptyColor: '#6CD7E8',
    emptyBg: 'rgba(48,176,199,.06)',
    emptyBorder: 'rgba(48,176,199,.28)',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><polyline points="3 7 12 13 21 7"/>
        <path d="m9 11-3 3 3 3"/><path d="m15 11 3 3-3 3"/>
      </svg>
    ),
  },
  {
    key: 'pi-agent' as const,
    label: 'PI',
    activeColor: 'var(--cron-gold)',
    countBg: 'rgba(247,194,107,.18)',
    emptyColor: 'var(--cron-gold)',
    emptyBg: 'rgba(247,194,107,.06)',
    emptyBorder: 'rgba(247,194,107,.32)',
    icon: (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.95 16.95l2.15 2.15M4.9 19.1l2.1-2.1M16.95 7.05l2.15-2.15"/>
      </svg>
    ),
  },
]


// ── Bottom resource bar helpers ────────────────────────────────────────────

function SystemIconButton({
  label,
  badgeCount,
  active,
  kind,
  onClick,
}: {
  label: string
  badgeCount: number
  active: boolean
  kind: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const isCron = kind === 'system_cron_admin'
  const isArtifact = kind === 'system_artifact_pool'
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex items-center gap-1.5 rounded-md px-1.5 py-1"
      style={{
        height: 28,
        background: active ? 'rgba(10,132,255,0.13)' : hovered ? 'var(--glass-1)' : 'transparent',
        border: active ? '1px solid rgba(10,132,255,0.35)' : '1px solid transparent',
        borderRadius: 7,
        transition: 'background 120ms ease',
      }}
      title={label}
    >
      <span style={{
        display: 'inline-flex', width: 14, height: 14,
        color: active ? '#6cb1ff' : isCron ? 'var(--cron-gold)' : isArtifact ? '#B8B6FF' : 'var(--fg-dim)',
      }}>
        {isCron ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/><path d="M12 2v3"/>
          </svg>
        ) : isArtifact ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        )}
      </span>
      {badgeCount > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, lineHeight: '14px',
          color: isCron ? 'var(--cron-gold)' : 'var(--fg-dim)',
          background: active ? 'rgba(10,132,255,0.14)' : 'var(--glass-1)',
          padding: '0 4px', borderRadius: 4, letterSpacing: 0,
        }}>{badgeCount}</span>
      )}
    </button>
  )
}

function PluginMgmtButton({
  activeProviderTab,
  setActiveProviderTab,
  providerConfigs,
  switchingId,
  onSwitch,
  onManage,
}: {
  activeProviderTab: ProviderGroup
  setActiveProviderTab: (tab: ProviderGroup) => void
  providerConfigs: ProviderConfig[]
  switchingId: string | null
  onSwitch: (id: string) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeProvider = getActiveProviderForGroup(providerConfigs, activeProviderTab)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-1.5 py-1"
        style={{
          height: 28,
          background: open ? 'var(--glass-1)' : 'transparent',
          border: open ? '1px solid var(--hairline)' : '1px solid transparent',
          borderRadius: 7,
          color: open ? 'var(--fg-regular)' : 'var(--fg-dim)',
          transition: 'background 120ms ease',
        }}
        title="插件管理"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/><line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
        {activeProvider && (
          <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            {activeProvider.models?.[0] ?? activeProvider.provider}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2"
          style={{
            width: 220,
            background: 'rgba(20,22,27,0.92)',
            backdropFilter: 'blur(60px) saturate(200%)',
            WebkitBackdropFilter: 'blur(60px) saturate(200%)',
            border: '1px solid var(--hairline-strong)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
            zIndex: 40,
          }}
        >
          {/* Tab strip inside popover */}
          <div
            className="mx-2.5 mt-2.5"
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, padding: 3,
              background: 'rgba(0,0,0,0.32)', border: '1px solid var(--hairline)',
              borderRadius: 9, height: 32,
            }}
          >
            {PROVIDER_TAB_DEFS.map(({ key, label, icon, activeColor, countBg }) => {
              const count = providerConfigs.filter((c) => getProviderGroup(c) === key).length
              const isActive = activeProviderTab === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveProviderTab(key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    borderRadius: 7, border: 'none', cursor: 'default', fontSize: 11, fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--fg-strong)' : 'var(--fg-dim)',
                    background: isActive ? 'var(--glass-2)' : 'transparent',
                    boxShadow: isActive ? 'inset 0 0 0 1px var(--hairline-strong), inset 0 1px 0 rgba(255,255,255,0.06)' : 'none',
                    letterSpacing: '-0.005em', fontFamily: 'var(--font-ui)',
                  }}
                >
                  <span style={{ display: 'inline-flex', color: isActive ? activeColor : 'var(--fg-dim)', fontSize: 11 }}>{icon}</span>
                  <span style={{ fontSize: 10.5 }}>{label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 600,
                    color: isActive ? activeColor : 'var(--fg-dim)',
                    background: isActive ? countBg : 'rgba(255,255,255,0.06)',
                    padding: '0 3px', height: 13, borderRadius: 3,
                    display: 'inline-flex', alignItems: 'center', letterSpacing: 0,
                  }}>{count}</span>
                </button>
              )
            })}
          </div>
          {/* Provider list in popover */}
          <div className="mx-2 my-1.5 flex flex-col gap-px max-h-[160px] overflow-y-auto">
            {providerConfigs
              .filter((c) => getProviderGroup(c) === activeProviderTab)
              .map((p) => {
                const isSelected = p.isActive
                const isSwitching = switchingId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isSwitching}
                    onClick={() => { if (!isSelected) { onSwitch(p.id); setOpen(false) } }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5"
                    style={{
                      background: isSelected ? 'rgba(10,132,255,.13)' : 'transparent',
                      border: 'none', cursor: 'default',
                      opacity: isSwitching ? 0.6 : 1,
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--ok-green)', boxShadow: '0 0 6px var(--ok-green)',
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-strong)', flex: 1, textAlign: 'left' }}>
                      {p.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-dim)' }}>
                      {p.models?.[0] ?? ''}
                    </span>
                  </button>
                )
              })}
          </div>
          {/* Manage link */}
          <button
            type="button"
            onClick={() => { onManage(); setOpen(false) }}
            className="w-full flex items-center gap-2 rounded-b-lg px-3 py-2 text-[11px]"
            style={{
              borderTop: '1px solid var(--hairline)',
              color: 'var(--fg-regular)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--glass-1)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            管理 Provider…
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const topics = useTopicStore((s) => s.topics)
  const pushToast = usePushTopicCreateToast()
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const selectTopic = useTopicStore((s) => s.selectTopic)
  const [search, setSearch] = useState('')
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicAgent, setNewTopicAgent] = useState<AgentType>('general')
  const [extension, setExtension] = useState<ExtensionType>('claude-code')
  const [cwd, setCwd] = useState('')
  const [workspace, setWorkspace] = useState<WorkspaceBrowseResponse | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const workspaceLoadInFlight = useRef(false)
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('normal')
  const [selectedSopIds, setSelectedSopIds] = useState<string[]>([])
  const [deletingTopic, setDeletingTopic] = useState<{ id: string; name: string } | null>(null)
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [showProviderConfig, setShowProviderConfig] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const templates = useSopTemplateStore((s) => s.templates)
  const wsStatus = useWsStore((s) => s.status)
  const adapterLink = useWsStore((s) => s.adapterLink)

  // Adapter version — fetch on hover, cache 60s
  const [adapterVersion, setAdapterVersion] = useState<string | null>(null)
  const adapterFetchedAt = useRef(0)
  const fetchAdapterVersion = useCallback(async () => {
    if (adapterVersion !== null && Date.now() - adapterFetchedAt.current < 60_000) return
    try {
      const serverUrl = getServerBase()
      // PI adapter config comes from frontend localStorage (same source as WsProvider)
      const wssUrl = localStorage.getItem(PI_WSS_URL_KEY) || ''
      const piToken = localStorage.getItem(PI_TOKEN_KEY) || ''
      const params = new URLSearchParams()
      if (wssUrl) params.set('wssUrl', wssUrl)
      if (piToken) params.set('piToken', piToken)
      const res = await fetch(`${serverUrl}/api/agent-chat/v1/adapter-status?${params}`, { signal: AbortSignal.timeout(5_000) })
      const data = await res.json()
      setAdapterVersion(data.version ?? 'unknown')
      adapterFetchedAt.current = Date.now()
    } catch {
      setAdapterVersion('unreachable')
    }
  }, [adapterVersion])
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)
  const cronRunCount = useCronStore((s) => s.crons.filter((c) => c.status === 'active').length)
  const unreadByTopic = useMessageStore((s) => s.unreadByTopic)
  const providerConfigs = useWsStore((s) => s.providerConfigs)
  const providerConfigsLoading = useWsStore((s) => s.providerConfigsLoading)
  const [activeProviderTab, setActiveProviderTab] = useState<ProviderGroup>('claude-code')
  const workspacePath = useWsStore((s) => s.workspacePath)
  const workspacePathStatus = useWsStore((s) => s.workspacePathStatus)
  const setWorkspacePath = useWsStore((s) => s.setWorkspacePath)
  const setWorkspacePathStatus = useWsStore((s) => s.setWorkspacePathStatus)

  // Fetch workspace root path once connected for footer display
  useEffect(() => {
    if (wsStatus !== 'connected') return
    setWorkspacePathStatus('loading')
    fetchWorkspaceBrowse()
      .then((w) => setWorkspacePath(w.workspacePath ?? null))
      .catch(() => setWorkspacePath(null))
  }, [wsStatus, setWorkspacePath, setWorkspacePathStatus])

  useEffect(() => {
    if (wsStatus !== 'connected') return
    if (providerConfigs.length > 0) return
    if (providerConfigsLoading) return
    useWsStore.getState().setProviderConfigsLoading(true)
    sendProviderRpc('listProviderConfigs', {})
      .then((result) => {
        useWsStore.getState().setProviderConfigs((result as ProviderConfig[]) ?? [])
      })
      .catch(() => {})
      .finally(() => {
        useWsStore.getState().setProviderConfigsLoading(false)
      })
  }, [wsStatus, providerConfigs.length, providerConfigsLoading])

  const handleSwitchProvider = async (providerId: string) => {
    const target = providerConfigs.find((c) => c.id === providerId)
    const targetName = target?.name ?? providerId
    setSwitchingId(providerId)
    try {
      // Preserve the provider's group: the adapter replaces the record and would
      // otherwise reset an omitted group to the default (claude-code).
      await sendProviderRpc('updateProviderConfig', {
        id: providerId,
        isActive: true,
        ...(target?.group ? { group: target.group } : {}),
      })
      const result = await sendProviderRpc('listProviderConfigs', {}) as ProviderConfig[]
      useWsStore.getState().setProviderConfigs(result ?? [])
      useToastStore.getState().pushToast({
        tone: 'success',
        title: `已切换至 ${targetName}`,
        description: '新创建的会话将默认使用该 Provider。已打开的会话不受影响。',
        durationMs: 5000,
      })
    } catch {
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

  const programmingTemplates = useMemo(
    () => templates.filter((t) => t.agent_type === 'any' || t.agent_type === newTopicAgent),
    [templates, newTopicAgent],
  )

  const loadWorkspace = useCallback(async () => {
    if (workspaceLoadInFlight.current) return
    workspaceLoadInFlight.current = true
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      setWorkspace(await fetchWorkspaceBrowse())
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    } finally {
      workspaceLoadInFlight.current = false
      setWorkspaceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showNewTopic) return
    if (!cwd.trim().startsWith('/')) return
    if (workspace || workspaceLoading || workspaceError) return
    void loadWorkspace()
  }, [showNewTopic, newTopicAgent, cwd, workspace, workspaceLoading, workspaceError, loadWorkspace])

  const closeNewTopicModal = () => {
    setShowNewTopic(false)
    setNewTopicName('')
    setNewTopicAgent('general')
    setExtension('claude-code')
    setPermissionTier('normal')
    setCwd('')
    setWorkspace(null)
    setWorkspaceError(null)
    setSelectedSopIds([])
  }

  const handleCreateTopic = async () => {
    const name = newTopicName.trim()
    if (!name) return
    if (name.startsWith('/')) return
    let currentWorkspace = workspace
    if (newTopicAgent === 'programming' && cwd.trim().startsWith('/') && !currentWorkspace) {
      setWorkspaceLoading(true)
      setWorkspaceError(null)
      try {
        currentWorkspace = await fetchWorkspaceBrowse()
        setWorkspace(currentWorkspace)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setWorkspaceError(message)
        setWorkspaceLoading(false)
        pushToast({
          tone: 'error',
          title: '无法读取工作区',
          description: '请确认 Adapter 已连接后再选择工作区目录。',
        })
        return
      }
      setWorkspaceLoading(false)
    }
    const resolvedCwd = resolveWorkspaceCwd(cwd, currentWorkspace)

    const validationError = validateCreateTopic({
      topics,
      name,
      agentType: newTopicAgent,
      cwd: resolvedCwd,
    })
    if (validationError) {
      pushToast(validationError)
      return
    }

    const permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' =
      permissionTier === 'yolo' ? 'bypassPermissions' : 'default'

    const activeProviderId = newTopicAgent === 'programming'
      ? getActiveProviderIdForExtension(providerConfigs, extension)
      : getActiveProviderIdForGroup(providerConfigs, 'pi-agent')
    const activeProvider = activeProviderId
      ? providerConfigs.find((provider) => provider.id === activeProviderId)
      : undefined
    const initialModel = activeProvider?.models?.[0]
    if (newTopicAgent === 'programming' && extension === 'codex' && activeProviderId && !initialModel) {
      pushToast({
        tone: 'warning',
        title: 'Provider 缺少模型',
        description: '当前 Codex Provider 没有可用模型。请在 Provider 设置里编辑该 Provider，补充模型后再创建话题。',
      })
      return
    }

    getWsClient().send({
      type: 'topic.create',
      data: {
        name,
        agentType: newTopicAgent,
        sopIds: selectedSopIds.length > 0 ? selectedSopIds : undefined,
        ...(activeProviderId ? { providerId: activeProviderId } : {}),
        ...(initialModel ? { model: initialModel } : {}),
        ...(newTopicAgent === 'programming'
          ? {
              programming: {
                extension,
                yolo: permissionTier === 'yolo',
                ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
                permissionMode,
              },
            }
          : resolvedCwd
            ? {
                general: {
                  cwd: resolvedCwd,
                },
              }
            : {}),
      },
    })

    closeNewTopicModal()
  }

  const systemTopics = topics.filter((t) => t.kind !== 'normal')
  const normalTopics = topics.filter((t) => t.kind === 'normal')
  const trimmedSearch = search.trim()
  const lowerSearch = trimmedSearch.toLowerCase()

  const filteredNormal = trimmedSearch
    ? normalTopics.filter((topic) => {
        if (trimmedSearch.startsWith('/')) {
          const directory = getTopicDirectoryLabel(topic, workspacePath)
          return directory ? directory.toLowerCase().includes(lowerSearch) : false
        }
        return topic.name.toLowerCase().includes(lowerSearch)
      })
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: 'radial-gradient(130% 120% at 30% 18%, #3AA0FF 0%, #0A84FF 42%, #0050C8 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -4px 12px rgba(0,40,110,0.5), 0 2px 6px rgba(0,0,0,0.3)',
              color: '#fff',
            }}
          >
            <HelmLogo size={17} accentColor="#FFD98A" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,30,90,0.45))' }} />
          </div>
          <span className="flex-1 text-[14px]" style={{ letterSpacing: '-0.02em' }}>
            <HelmWordmark fontSize={14} />
          </span>
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

        {/* System topic delete modal (if deleting a system topic) */}
        {deletingTopic && createPortal(
          <DeleteTopicModal
            topicId={deletingTopic.id}
            topicName={deletingTopic.name}
            onClose={() => setDeletingTopic(null)}
          />,
          document.body,
        )}

        {/* ── Topic area (flex:1) ── */}
        <div className="shrink-0 px-3 pb-2 pt-1">
          <input
            type="text"
            placeholder="搜索话题或目录"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg px-2.5 text-[12.5px] outline-none"
            style={{
              height: 32,
              backgroundColor: 'rgba(0,0,0,0.30)',
              color: 'var(--fg-regular)',
              border: '1px solid var(--hairline)',
              letterSpacing: '-0.005em',
            }}
          />
        </div>

        <div className="shrink-0 flex items-center gap-2 px-[18px] pb-1.5">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.10em' }}>话题</span>
          <span
            className="text-[10px]"
            style={{
              fontFamily: 'var(--font-mono)', letterSpacing: 0,
              color: 'var(--fg-dim)', background: 'var(--glass-1)',
              border: '1px solid var(--hairline)', borderRadius: 8,
              padding: '0 5px',
            }}
          >{normalTopics.length}</span>
        </div>

        <div
          className="flex-1 overflow-y-auto px-1.5"
          style={{
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
          }}
        >
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
              badgeCount={unreadByTopic[topic.id] ?? 0}
              workspaceRoot={workspacePath}
            />
          ))}
        </div>

        {/* ── Bottom resource bar ── */}
        <div className="relative shrink-0">
          <div className="flex items-center gap-0.5 px-2 py-1.5">
            {/* System entry icons */}
            {systemTopics.map((topic) => {
              const isActive = topic.id === activeTopicId
              const badgeCount = topic.kind === 'system_artifact_pool' ? poolArtifacts.length
                : topic.kind === 'system_cron_admin' ? cronRunCount
                : 0
              return (
                <SystemIconButton
                  key={topic.id}
                  label={topic.name}
                  badgeCount={badgeCount}
                  active={isActive}
                  kind={topic.kind}
                  onClick={() => selectTopic(topic.id)}
                />
              )
            })}
            {systemTopics.length > 0 && (
              <span style={{ width: 1, height: 18, background: 'var(--hairline)', margin: '0 2px' }} />
            )}
            {/* Plugin management button */}
            <PluginMgmtButton
              activeProviderTab={activeProviderTab}
              setActiveProviderTab={setActiveProviderTab}
              providerConfigs={providerConfigs}
              switchingId={switchingId}
              onSwitch={handleSwitchProvider}
              onManage={() => setShowProviderConfig(true)}
            />
          </div>
        </div>

        {/* ProviderConfigModal portal */}
        {showProviderConfig && typeof document !== 'undefined'
          ? createPortal(
              <ProviderConfigModal
                onClose={() => setShowProviderConfig(false)}
              />,
              document.body,
            )
          : null}

        <div
          className="flex shrink-0 flex-col gap-1.5 px-3.5 py-2.5 text-xs"
          style={{ borderTop: '1px solid var(--hairline)', color: 'var(--fg-dim)' }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[10.5px]" style={{ color: 'var(--fg-dim)' }}>工作区目录：</span>
            <Tooltip
              content={workspacePath || (workspacePathStatus === 'loading' ? '正在读取工作区目录' : '未能读取工作区目录')}
              side="top"
              delayMs={200}
              className="min-w-0"
            >
              <span
                className="block max-w-full truncate text-[10.5px]"
                style={{
                  color: workspacePath ? 'var(--fg-regular)' : 'var(--fg-muted)',
                  fontFamily: workspacePath ? 'var(--font-mono)' : 'inherit',
                }}
              >
                {workspacePath || (workspacePathStatus === 'loading' ? '读取中…' : '未连接')}
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <PiStatusBadge
              wsStatus={wsStatus}
              adapterLink={adapterLink}
              onClick={() => setShowConnectionModal(true)}
            />
            <NotificationBell />
            <div className="ml-auto">
              <Tooltip
                variant="info"
                side="top"
                content={
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, whiteSpace: 'nowrap' }}>
                    <div>helm: <span style={{ color: '#fff' }}>v1.10.31</span></div>
                    <div>agent-adapter: <span style={{ color: '#fff' }}>{adapterVersion ?? '…'}</span></div>
                  </div>
                }
                delayMs={200}
                onShow={fetchAdapterVersion}
              >
                <span className="text-[11px] cursor-default" style={{ fontFeatureSettings: '"tnum"' }}>v1.10.31</span>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {showNewTopic && typeof document !== 'undefined'
        ? createPortal(
            <CreateTopicModal
              name={newTopicName}
              agentType={newTopicAgent}
              extension={extension}
              cwd={cwd}
              workspace={workspace}
              workspaceLoading={workspaceLoading}
              workspaceError={workspaceError}
              permissionTier={permissionTier}
              selectedSopIds={selectedSopIds}
              templates={programmingTemplates}
              onClose={closeNewTopicModal}
              onSubmit={handleCreateTopic}
              onNameChange={setNewTopicName}
              onAgentTypeChange={setNewTopicAgent}
              onExtensionChange={setExtension}
              onPermissionTierChange={setPermissionTier}
              onSelectedSopIdsChange={setSelectedSopIds}
              onCwdChange={setCwd}
              onLoadWorkspace={loadWorkspace}
            />,
            document.body,
          )
        : null}

      {showConnectionModal && typeof document !== 'undefined'
        ? createPortal(
            <AdapterConnectionModal
              wsStatus={wsStatus}
              adapterLink={adapterLink}
              adapterVersion={adapterVersion}
              onClose={() => setShowConnectionModal(false)}
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
  workspace,
  workspaceLoading,
  workspaceError,
  permissionTier,
  selectedSopIds,
  templates,
  onClose,
  onSubmit,
  onNameChange,
  onAgentTypeChange,
  onExtensionChange,
  onPermissionTierChange,
  onSelectedSopIdsChange,
  onCwdChange,
  onLoadWorkspace,
}: {
  name: string
  agentType: AgentType
  extension: ExtensionType
  cwd: string
  workspace: WorkspaceBrowseResponse | null
  workspaceLoading: boolean
  workspaceError: string | null
  permissionTier: PermissionTier
  selectedSopIds: string[]
  templates: SopTemplate[]
  onClose: () => void
  onSubmit: () => void
  onNameChange: (value: string) => void
  onAgentTypeChange: (value: AgentType) => void
  onExtensionChange: (value: ExtensionType) => void
  onPermissionTierChange: (value: PermissionTier) => void
  onSelectedSopIdsChange: (value: string[]) => void
  onCwdChange: (value: string) => void
  onLoadWorkspace: () => void
}) {
  const trimmedName = name.trim()
  const nameStartsWithSlash = trimmedName.startsWith('/')
  const canSubmit = Boolean(trimmedName) && !nameStartsWithSlash
  const [draggedSopId, setDraggedSopId] = useState<string | null>(null)
  const selectedSops = useMemo(
    () => selectedSopIds
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is SopTemplate => Boolean(template)),
    [selectedSopIds, templates],
  )
  const availableSops = useMemo(
    () => templates.filter((template) => !selectedSopIds.includes(template.id)),
    [selectedSopIds, templates],
  )
  const moveSop = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const next = [...selectedSopIds]
    const from = next.indexOf(sourceId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, sourceId)
    onSelectedSopIdsChange(next)
  }, [onSelectedSopIdsChange, selectedSopIds])
  const cwdMatches = useMemo(
    () => workspace ? getWorkspaceDirMatches(cwd, workspace.subDirList).slice(0, 8) : [],
    [cwd, workspace],
  )
  const showWorkspacePicker = workspace && cwd.trim().startsWith('/')
  const cwdPreview = useMemo(() => {
    const trimmed = cwd.trim()
    if (!trimmed) return ''
    if (workspace && trimmed.startsWith('/')) {
      return getWorkspaceRelativePath(joinWorkspacePath(workspace.workspacePath, trimmed), workspace.workspacePath)
    }
    return trimmed
  }, [cwd, workspace])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && !e.shiftKey && canSubmit) onSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canSubmit, onClose, onSubmit])

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
                aria-invalid={nameStartsWithSlash}
                className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                style={{
                  background: 'rgba(0,0,0,.28)',
                  color: 'var(--fg-strong)',
                  border: nameStartsWithSlash ? '1px solid rgba(255,69,58,.55)' : '1px solid var(--hairline-2)',
                }}
              />
              {nameStartsWithSlash && (
                <p className="mt-2 text-[12px]" style={{ color: '#FF8B82' }}>
                  话题名不能以 / 开头。按目录创建请填写下方工作目录。
                </p>
              )}
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
              <Field label="SOP 工作流">
                <div className="space-y-2">
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      onSelectedSopIdsChange([...selectedSopIds, e.target.value])
                    }}
                    className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                    style={{
                      background: 'rgba(0,0,0,.28)',
                      color: 'var(--fg-regular)',
                      border: '1px solid var(--hairline-2)',
                    }}
                  >
                    <option value="">添加 SOP</option>
                    {availableSops.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {selectedSops.length > 0 && (
                    <div className="space-y-1.5">
                      {selectedSops.map((template, index) => (
                        <div
                          key={template.id}
                          draggable
                          onDragStart={() => setDraggedSopId(template.id)}
                          onDragEnd={() => setDraggedSopId(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (draggedSopId) moveSop(draggedSopId, template.id)
                            setDraggedSopId(null)
                          }}
                          className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-2"
                          style={{
                            background: draggedSopId === template.id ? 'rgba(10,132,255,.12)' : 'rgba(0,0,0,.20)',
                            border: '1px solid var(--hairline)',
                            color: 'var(--fg-regular)',
                          }}
                        >
                          <span className="shrink-0 text-[11px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{template.name}</span>
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>{template.agent_type}</span>
                          <button
                            type="button"
                            onClick={() => onSelectedSopIdsChange(selectedSopIds.filter((id) => id !== template.id))}
                            className="shrink-0 rounded-md px-2 py-1 text-[12px]"
                            style={{ color: 'var(--fg-dim)' }}
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            )}

            {agentType === 'programming' && (
              <>
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
              </>
            )}

            <Field label="工作目录">
              <div className="space-y-2">
                <input
                  type="text"
                  value={cwd}
                  onFocus={() => {
                    if (!workspace) onLoadWorkspace()
                  }}
                  onChange={(e) => {
                    onCwdChange(e.target.value)
                    if (!workspace) onLoadWorkspace()
                  }}
                  placeholder="/path/to/project"
                  className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                  style={{
                    background: 'rgba(0,0,0,.20)',
                    color: 'var(--fg-regular)',
                    border: '1px solid var(--hairline-2)',
                  }}
                />
                <p className="text-[11.5px]" style={{ color: 'var(--fg-dim)' }}>
                  {cwd.trim()
                    ? `将使用「${cwdPreview}」作为工作目录`
                    : '留空则自动创建以话题名命名的独立工作目录'}
                </p>
                {showWorkspacePicker && (
                  <div
                    className="overflow-hidden rounded-xl"
                    style={{
                      background: 'rgba(0,0,0,.22)',
                      border: '1px solid var(--hairline)',
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-3 py-2 text-[11.5px]"
                      style={{ color: 'var(--fg-dim)', borderBottom: '1px solid var(--hairline)' }}
                    >
                      <span className="truncate">
                        {workspace?.workspacePath ?? (workspaceLoading ? '正在读取工作区...' : '工作区目录')}
                      </span>
                      {workspaceError && (
                        <button
                          type="button"
                          onClick={onLoadWorkspace}
                          className="shrink-0"
                          style={{ color: '#ff9f7a' }}
                        >
                          重试
                        </button>
                      )}
                    </div>
                    {cwdMatches.length > 0 ? (
                      <div className="max-h-44 overflow-y-auto py-1">
                        {cwdMatches.map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() => onCwdChange(`/${dir}`)}
                            className="flex h-8 w-full items-center gap-2 px-3 text-left text-[13px]"
                            style={{ color: 'var(--fg-regular)' }}
                          >
                            <span style={{ color: 'var(--fg-dim)' }}>/</span>
                            <span className="truncate">{dir}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--fg-dim)' }}>
                        {workspaceLoading
                          ? '读取中...'
                          : workspaceError
                            ? '无法读取工作区目录，请重试后再创建。'
                            : '没有匹配目录，创建时会按输入在工作区下使用新目录。'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Field>
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
              disabled={!canSubmit}
              className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold"
              style={{
                background: canSubmit ? 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)' : 'var(--glass-2)',
                color: canSubmit ? '#fff' : 'var(--fg-dim)',
                boxShadow: canSubmit ? 'inset 0 1px 0 rgba(255,255,255,0.26), 0 6px 16px rgba(10,132,255,0.38)' : 'none',
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

function PiStatusBadge({ wsStatus, adapterLink, onClick }: {
  wsStatus: string
  adapterLink: AdapterLinkState
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'span'
  const interactive = onClick ? 'cursor-pointer transition-opacity hover:opacity-80' : ''
  const state = resolvePiBadgeState(wsStatus as 'connecting' | 'connected' | 'disconnected', adapterLink)
  const palette = state.tone === 'ok'
    ? { bg: 'rgba(48,209,88,0.10)', fg: '#6FE39A', border: '1px solid rgba(48,209,88,0.22)', dot: 'var(--state-ok)', shadow: '0 0 8px var(--state-ok)' }
    : state.tone === 'warning'
      ? { bg: 'rgba(255,159,10,0.12)', fg: '#FFB340', border: '1px solid rgba(255,159,10,0.28)', dot: '#FFB340', shadow: 'none' }
      : state.tone === 'danger'
        ? { bg: 'rgba(255,69,58,0.10)', fg: '#FF6B6B', border: '1px solid rgba(255,69,58,0.22)', dot: 'var(--state-danger)', shadow: 'none' }
        : { bg: 'rgba(255,255,255,0.08)', fg: 'var(--fg-dim)', border: '1px solid var(--hairline)', dot: 'var(--fg-dim)', shadow: 'none' }
  return (
    <Tag
      {...(onClick ? { onClick, title: state.tone === 'ok' ? '查看 Agent 连接状态' : '重新配对 Agent' } : {})}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${interactive}`}
      style={{
        height: 22,
        background: palette.bg,
        color: palette.fg,
        border: palette.border,
      }}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full${state.pulse ? ' animate-pulse' : ''}`}
        style={{ backgroundColor: palette.dot, boxShadow: palette.shadow }}
      />
      {state.label}
    </Tag>
  )
}
