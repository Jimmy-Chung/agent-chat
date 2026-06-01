'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { useWsStore } from '@/stores/ws-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { useToastStore } from '@/stores/toast-store'
import { TopicItem } from './TopicItem'
import { DeleteTopicModal } from '@/components/chat/DeleteTopicModal'
import { Tooltip } from '@/components/ui/Tooltip'
import { getWsClient } from '@/lib/ws-client'
import { requestPushPermission } from '@/components/PushSetup'
import { ConnectionConfigModal, PI_WSS_URL_KEY, PI_TOKEN_KEY } from '@/components/ConnectionConfigModal'
import { ProviderConfigModal } from '@/components/ProviderConfigModal'
import { sendProviderRpc } from '@/lib/ws-client'
import { getServerBase } from '@/lib/server-url'
import { getWorkspaceDirMatches, resolveWorkspaceCwd, type WorkspaceBrowseResponse } from '@/lib/workspace-path'
import { getActiveProviderIdForExtension, getActiveProviderIdForGroup } from '@/lib/provider-selection'
import type { AdapterLinkState, ProviderConfig } from '@/stores/ws-store'
import { resolvePiBadgeState } from '@/lib/connection-status'

function normalizeCwd(cwd: string): string {
  return cwd.trim().replace(/\/+$/, '') || '/'
}

function getTopicCwd(topic: import('@agent-chat/protocol').Topic): string | null {
  if (!topic.programming_spec_json) return null
  try {
    const parsed = JSON.parse(topic.programming_spec_json) as { cwd?: string }
    return parsed.cwd ? normalizeCwd(parsed.cwd) : null
  } catch {
    return null
  }
}

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

  if (input.agentType === 'programming' && input.cwd.trim()) {
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

const EMPTY_ARTIFACTS: import('@agent-chat/protocol').Artifact[] = []

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

function ProviderTabContent({
  providers,
  tabKey,
  switchingId,
  onSwitch,
  onManage,
}: {
  providers: ProviderConfig[]
  tabKey: 'claude-code' | 'codex' | 'pi-agent'
  switchingId: string | null
  onSwitch: (id: string) => void
  onManage: () => void
}) {
  const tabDef = PROVIDER_TAB_DEFS.find((t) => t.key === tabKey)!

  if (providers.length === 0) {
    return (
      <div
        className="shrink-0 mx-2.5 mb-2 flex flex-col items-center gap-2 text-center"
        style={{
          padding: '16px 14px',
          borderRadius: 11,
          background: tabDef.emptyBg,
          border: `1px dashed ${tabDef.emptyBorder}`,
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${tabDef.emptyBg}`,
          border: `1px solid ${tabDef.emptyBorder}`,
          color: tabDef.emptyColor,
          display: 'grid', placeItems: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.95 16.95l2.15 2.15M4.9 19.1l2.1-2.1M16.95 7.05l2.15-2.15"/>
          </svg>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-regular)', fontWeight: 500, letterSpacing: '-0.005em' }}>
          尚未配置 {tabDef.label} Provider
        </div>
        <button
          type="button"
          onClick={onManage}
          style={{
            marginTop: 2, height: 26, padding: '0 10px', borderRadius: 7,
            background: `${tabDef.emptyBg}`,
            color: tabDef.emptyColor,
            border: `1px solid ${tabDef.emptyBorder}`,
            fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
            letterSpacing: '-0.005em', fontFamily: 'var(--font-ui)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          新增 Provider
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 mx-2.5 mb-1 flex flex-col gap-px">
      {providers.map((p) => {
        const isSwitching = switchingId === p.id
        const isSelected = p.isActive
        return (
          <button
            key={p.id}
            type="button"
            disabled={isSwitching}
            onClick={() => { if (!isSelected) onSwitch(p.id) }}
            className="w-full"
            style={{
              display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', columnGap: 8,
              padding: '8px 10px', borderRadius: 8,
              background: isSelected ? 'rgba(10,132,255,.13)' : 'transparent',
              boxShadow: isSelected ? 'inset 0 0 0 1px rgba(10,132,255,.45)' : 'none',
              opacity: isSwitching ? 0.6 : 1,
              cursor: isSelected ? 'default' : 'default', border: 'none',
              transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--glass-1)' }}
            onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: 'var(--ok-green)', boxShadow: '0 0 6px var(--ok-green)',
              }} />
              <span style={{
                fontSize: 13, fontWeight: isSelected ? 600 : 500, color: 'var(--fg-strong)',
                letterSpacing: '-0.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{p.name}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-dim)',
                flexShrink: 0, letterSpacing: 0,
              }}>{p.models?.[0] ?? p.provider}</span>
            </div>
            {isSwitching ? (
              <svg className="animate-spin" width="10" height="10" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2"/>
                <path d="M8 2a6 6 0 0 1 5.3 3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : p.isDefault ? (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 5, fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
                background: 'rgba(247,194,107,.16)', color: 'var(--cron-gold)',
                border: '1px solid rgba(247,194,107,.30)', flexShrink: 0,
              }}>Default</span>
            ) : isSelected ? (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 5, fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
                background: 'rgba(10,132,255,.16)', color: '#7CB6FF',
                border: '1px solid rgba(10,132,255,.30)', flexShrink: 0,
              }}>Active</span>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--fg-dim)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18"/>
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Sidebar() {
  const topics = useTopicStore((s) => s.topics)
  const pushToast = usePushTopicCreateToast()
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const selectTopic = useTopicStore((s) => s.selectTopic)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [deletingTopic, setDeletingTopic] = useState<{ id: string; name: string } | null>(null)
  const [showConnConfig, setShowConnConfig] = useState(false)
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
  const artifactsByTopic = useArtifactStore((s) => s.byTopic)
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)
  const providerConfigs = useWsStore((s) => s.providerConfigs)
  const providerConfigsLoading = useWsStore((s) => s.providerConfigsLoading)
  const [activeProviderTab, setActiveProviderTab] = useState<'claude-code' | 'codex' | 'pi-agent'>('claude-code')

  // Auto-select the tab that contains the currently active provider
  useEffect(() => {
    const active = providerConfigs.find((c) => c.isActive)
    if (active?.group) setActiveProviderTab(active.group as 'claude-code' | 'codex' | 'pi-agent')
  }, [providerConfigs])

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
    if (!showNewTopic || newTopicAgent !== 'programming') return
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
    setSelectedTemplateId('')
  }

  const handleCreateTopic = async () => {
    const name = newTopicName.trim()
    if (!name) return
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
      : getActiveProviderIdForGroup(providerConfigs, activeProviderTab)

    getWsClient().send({
      type: 'topic.create',
      data: {
        name,
        agentType: newTopicAgent,
        sopTemplateId: selectedTemplateId || undefined,
        ...(activeProviderId ? { providerId: activeProviderId } : {}),
        ...(newTopicAgent === 'programming'
          ? {
              programming: {
                extension,
                yolo: permissionTier === 'yolo',
                ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
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

        {/* Provider section */}
        <div className="shrink-0 px-4 pb-1.5 pt-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.10em' }}>Provider</span>
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            {providerConfigs.length > 0 ? providerConfigs.length : ''}
          </span>
        </div>

        {/* 3-segment tab strip */}
        <div
          className="shrink-0 mx-2.5 mb-2"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, padding: 3,
            background: 'rgba(0,0,0,0.32)', border: '1px solid var(--hairline)',
            borderRadius: 9, height: 32,
          }}
        >
          {PROVIDER_TAB_DEFS.map(({ key, label, icon, activeColor, countBg }) => {
            const count = providerConfigs.filter((c) => (c.group ?? 'claude-code') === key).length
            const isActive = activeProviderTab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveProviderTab(key)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  borderRadius: 7, border: 'none', cursor: 'default', fontSize: 11.5, fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--fg-strong)' : 'var(--fg-dim)',
                  background: isActive ? 'var(--glass-2)' : 'transparent',
                  boxShadow: isActive ? 'inset 0 0 0 1px var(--hairline-strong), inset 0 1px 0 rgba(255,255,255,0.06)' : 'none',
                  letterSpacing: '-0.005em', fontFamily: 'var(--font-ui)',
                }}
              >
                <span style={{ display: 'inline-flex', color: isActive ? activeColor : 'var(--fg-dim)' }}>{icon}</span>
                <span>{label}</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
                  color: isActive ? activeColor : 'var(--fg-dim)',
                  background: isActive ? countBg : 'rgba(255,255,255,0.06)',
                  padding: '0 4px', height: 14, borderRadius: 4,
                  display: 'inline-flex', alignItems: 'center', letterSpacing: 0,
                }}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Provider list for active tab */}
        <ProviderTabContent
          providers={providerConfigs.filter((c) => (c.group ?? 'claude-code') === activeProviderTab)}
          tabKey={activeProviderTab}
          switchingId={switchingId}
          onSwitch={handleSwitchProvider}
          onManage={() => setShowProviderConfig(true)}
        />

        {/* Manage row */}
        <div className="shrink-0 mx-2.5 mb-1">
          <button
            type="button"
            onClick={() => setShowProviderConfig(true)}
            className="w-full flex items-center gap-2 rounded-lg text-[12px] transition-colors"
            style={{ padding: '8px 10px', color: 'var(--fg-regular)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--glass-1)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-strong)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-regular)' }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--fg-dim)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            <span>管理 Provider…</span>
            <span className="ml-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-dim)' }}>
              {providerConfigs.length || ''}
            </span>
          </button>
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

        <div className="mx-4 my-2 shrink-0" style={{ height: 1, background: 'var(--hairline)' }} />

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
            wsStatus={wsStatus}
            adapterLink={adapterLink}
            onClick={() => setShowConnConfig(true)}
          />
          <NotificationBell />
          <div className="ml-auto">
            <Tooltip
              variant="info"
              side="top"
              content={
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, whiteSpace: 'nowrap' }}>
                  <div>agent-chat: <span style={{ color: '#fff' }}>v1.8.1</span></div>
                  <div>agent-adapter: <span style={{ color: '#fff' }}>{adapterVersion ?? '…'}</span></div>
                </div>
              }
              delayMs={200}
              onShow={fetchAdapterVersion}
            >
              <span className="text-[11px] cursor-default" style={{ fontFeatureSettings: '"tnum"' }}>v1.8.1</span>
            </Tooltip>
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
              onLoadWorkspace={loadWorkspace}
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
  workspace,
  workspaceLoading,
  workspaceError,
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
  onLoadWorkspace: () => void
}) {
  const cwdMatches = useMemo(
    () => workspace ? getWorkspaceDirMatches(cwd, workspace.subDirList).slice(0, 8) : [],
    [cwd, workspace],
  )
  const resolvedCwd = useMemo(() => resolveWorkspaceCwd(cwd, workspace), [cwd, workspace])
  const showWorkspacePicker = agentType === 'programming' && cwd.trim().startsWith('/')

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
                      <span className="truncate">{resolvedCwd || '留空则自动创建工作目录'}</span>
                      <span className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>Folder</span>
                    </button>
                    <input
                      type="text"
                      value={cwd}
                      onFocus={() => {
                        if (cwd.trim().startsWith('/') && !workspace) onLoadWorkspace()
                      }}
                      onChange={(e) => {
                        onCwdChange(e.target.value)
                        if (e.target.value.trim().startsWith('/') && !workspace) onLoadWorkspace()
                      }}
                      placeholder="输入 / 选择工作区目录，或输入新目录名"
                      className="h-10 w-full rounded-xl px-3.5 text-sm outline-none"
                      style={{
                        background: 'rgba(0,0,0,.20)',
                        color: 'var(--fg-regular)',
                        border: '1px solid var(--hairline)',
                      }}
                    />
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
      {...(onClick ? { onClick, title: '点击配置 PI Adapter 连接' } : {})}
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
