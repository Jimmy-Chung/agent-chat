'use client'

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTopicStore } from '@/stores/topic-store'
import { useMessageStore } from '@/stores/message-store'
import { useUiStore } from '@/stores/ui-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useCronStore } from '@/stores/cron-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { useWsStore } from '@/stores/ws-store'
import { EmptyState } from './EmptyState'
import { MessageList } from '@/components/chat/MessageList'
import { MessageInput } from '@/components/chat/MessageInput'
import { DeleteTopicModal } from '@/components/chat/DeleteTopicModal'
import { McpSettingsModal } from '@/components/McpSettingsModal'
import { AttentionDrawer } from '@/components/attention/AttentionDrawer'
import { Tooltip } from '@/components/ui/Tooltip'
import { SopEditorModal } from '@/components/sop/SopEditorModal'
import { getWsClient } from '@/lib/ws-client'
import type { Message } from '@agent-chat/protocol'
import type { SopTemplate, SopTemplateDraft } from '@/stores/sop-template-store'
import type { ToolResultInfo } from '@/components/chat/ToolCard'
import { resolvePiBadgeState, resolveTopicSessionDotState } from '@/lib/connection-status'
import { getTopicCwd, getTopicDirectoryLabel } from '@/lib/workspace-path'

class TopicErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
          <h3 className="text-sm font-semibold" style={{ color: '#f87171' }}>TopicPanel Error</h3>
          <pre className="max-h-64 max-w-lg overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap" style={{ background: 'var(--bg-1)', color: 'var(--fg-regular)' }}>
            {this.state.error.message}\n\n{this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} className="rounded-lg px-3 py-1.5 text-xs" style={{ background: 'var(--role-user)', color: '#fff' }}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

export function TopicPanel() {
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const topics = useTopicStore((s) => s.topics)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const isMobile = useUiStore((s) => s.isMobile)
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar)
  const toggleMobileInspector = useUiStore((s) => s.toggleMobileInspector)
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen)

  const byTopic = useMessageStore((s) => s.byTopic)
  const partsByMessage = useMessageStore((s) => s.partsByMessage)

  const activeTopic = topics.find((t) => t.id === activeTopicId)

  useEffect(() => {
    if (activeTopicId && isMobile) {
      setMobileSidebarOpen(false)
    }
  }, [activeTopicId, isMobile, setMobileSidebarOpen])

  const handleToggleSidebar = () => {
    if (isMobile) toggleMobileSidebar()
    else toggleSidebar()
  }

  if (!activeTopic) {
    return <EmptyState onToggleSidebar={handleToggleSidebar} />
  }

  return (
    <TopicErrorBoundary>
      <TopicPanelContent activeTopic={activeTopic} toggleSidebar={handleToggleSidebar} toggleMobileInspector={toggleMobileInspector} byTopic={byTopic} partsByMessage={partsByMessage} />
    </TopicErrorBoundary>
  )
}

function TopicPanelContent({ activeTopic, toggleSidebar, toggleMobileInspector, byTopic, partsByMessage }: {
  activeTopic: NonNullable<ReturnType<typeof useTopicStore.getState>['topics'][0]>
  toggleSidebar: () => void
  toggleMobileInspector: () => void
  byTopic: Record<string, ReturnType<typeof useMessageStore.getState>['byTopic'][string]>
  partsByMessage: Record<string, ReturnType<typeof useMessageStore.getState>['partsByMessage'][string]>
}) {
  const usageByMessage = useMessageStore((s) => s.usageByMessage)
  const interactions = useMessageStore((s) => s.interactions)
  const agentStatus = useMessageStore((s) => s.agentStatusByTopic[activeTopic.id] ?? 'idle')
  const sessionHealth = useWsStore((s) => s.sessionHealthByTopic[activeTopic.id])
  const wsStatus = useWsStore((s) => s.status)
  const adapterLink = useWsStore((s) => s.adapterLink)
  const planMode = activeTopic.plan_mode ?? false
  const togglePlanMode = useCallback(() => {
    getWsClient().send({
      type: 'topic.setPlanMode',
      data: { id: activeTopic.id, planMode: !planMode },
    })
  }, [activeTopic.id, planMode])
  const [menuOpen, setMenuOpen] = useState(false)
  const [deletingTopic, setDeletingTopic] = useState<{ id: string; name: string } | null>(null)
  const [renamingTopic, setRenamingTopic] = useState<{ id: string; name: string } | null>(null)
  const [showMcpSettings, setShowMcpSettings] = useState(false)
  const [showAttention, setShowAttention] = useState(false)
  const generatedDraft = useSopTemplateStore((s) => s.generatedDraft)
  const setGeneratedDraft = useSopTemplateStore((s) => s.setGeneratedDraft)
  const menuRef = useRef<HTMLDivElement>(null)

  const saveSopDraft = useCallback((draft: SopTemplateDraft, id?: string) => {
    getWsClient().send({
      type: id ? 'sop_template.update' : 'sop_template.create',
      data: {
        ...(id ? { id } : {}),
        ...draft,
      },
    })
    setGeneratedDraft(null)
  }, [setGeneratedDraft])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const toolResults = useMemo(() => {
    const map: Record<string, ToolResultInfo> = {}
    for (const parts of Object.values(partsByMessage)) {
      for (const part of parts) {
        if (part.kind === 'tool_result') {
          try {
            const data = JSON.parse(part.content_json) as { toolUseId: string; output: unknown; isError: boolean }
            map[data.toolUseId] = { toolUseId: data.toolUseId, output: data.output, isError: data.isError }
          } catch {}
        }
      }
    }
    return map
  }, [partsByMessage])

  const activeExtension = useMemo(() => {
    if (!activeTopic.programming_spec_json) return 'claude-code' as const
    try { return (JSON.parse(activeTopic.programming_spec_json).extension as 'claude-code' | 'codex') ?? 'claude-code' } catch { return 'claude-code' as const }
  }, [activeTopic.programming_spec_json])

  const workspacePath = useWsStore((s) => s.workspacePath)

  const projectDir = useMemo(() => getTopicCwd(activeTopic) ?? undefined, [activeTopic])
  const projectDirDisplay = useMemo(() => getTopicDirectoryLabel(activeTopic, workspacePath) ?? undefined, [activeTopic, workspacePath])

  const approvalsByMessage = useMemo(() => {
    const map: Record<string, { interactionId: string; interactionKind: string; prompt: string; options?: string[]; status: 'pending' | 'resolved' | 'timeout'; response?: string }> = {}
    for (const inter of Object.values(interactions)) {
      if (inter.messageId) {
        map[inter.messageId] = {
          interactionId: inter.interactionId,
          interactionKind: inter.interactionKind,
          prompt: inter.prompt,
          options: inter.options,
          status: inter.status ?? 'pending',
          response: inter.response,
        }
      }
    }
    return map
  }, [interactions])

  // Interactions without messageId, or whose message doesn't exist locally — render standalone at bottom of message list
  const orphanInteractions = useMemo(() => {
    const topicMessageIds = new Set((byTopic[activeTopic.id] ?? []).map((m) => m.id))
    return Object.values(interactions)
      .filter((inter) => {
        if (inter.topicId !== activeTopic.id) return false
        if (!inter.messageId) return true
        return !topicMessageIds.has(inter.messageId)
      })
      .map((inter) => ({
        interactionId: inter.interactionId,
        interactionKind: inter.interactionKind as 'approval' | 'choice',
        prompt: inter.prompt,
        options: inter.options,
        status: inter.status ?? 'pending',
        response: inter.response,
        defaultTimeoutMs: inter.defaultTimeoutMs,
      }))
  }, [interactions, activeTopic.id, byTopic])

  if (activeTopic.kind === 'system_artifact_pool') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar} toggleMobileInspector={toggleMobileInspector}><ArtifactPoolView /></SystemTopicLayout>
  }
  if (activeTopic.kind === 'system_cron_admin') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar} toggleMobileInspector={toggleMobileInspector}><CronAdminView /></SystemTopicLayout>
  }
  if (activeTopic.kind === 'system_sop_library') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar} toggleMobileInspector={toggleMobileInspector}><SopLibraryView /></SystemTopicLayout>
  }

  const messages = byTopic[activeTopic.id] ?? EMPTY_MESSAGES
  const globalLinkHealthy = resolvePiBadgeState(wsStatus, adapterLink).tone === 'ok'
  const sessionDotState = globalLinkHealthy
    ? resolveTopicSessionDotState(sessionHealth?.state)
    : 'hidden'

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-14 shrink-0 items-center gap-2.5 px-4 md:px-6"
        style={{
          background: 'rgba(11,12,15,0.45)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <button onClick={toggleSidebar} className="flex h-7 w-7 items-center justify-center rounded-md lg:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Toggle sidebar">
          <MenuIcon />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[15px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.012em' }}>
            {activeTopic.name}
          </h2>
          {projectDirDisplay && (
            <Tooltip content={projectDirDisplay} side="top" delayMs={200} className="hidden min-w-0 shrink sm:inline-block">
              <span
                className="block min-w-0 max-w-[220px] truncate rounded-md px-1.5 text-[11px] font-medium"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--fg-dim)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '19px',
                }}
              >
                {projectDirDisplay}
              </span>
            </Tooltip>
          )}
          {sessionDotState !== 'hidden' && (
            <span
              title={sessionDotState === 'healthy' ? '当前话题链路健康' : '当前话题链路异常'}
              className={sessionDotState === 'unhealthy' ? 'animate-pulse' : ''}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: sessionDotState === 'healthy' ? '#6FE39A' : '#FF6B6B',
                boxShadow: sessionDotState === 'healthy' ? '0 0 8px rgba(48,209,88,.9)' : '0 0 8px rgba(255,69,58,.7)',
              }}
            />
          )}
        </div>

        {activeTopic.agent_type === 'programming' && (
          <ToolsMenu planMode={planMode} onTogglePlan={togglePlanMode} onOpenMcp={() => setShowMcpSettings(true)} />
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeTopic.agent_type === 'programming' ? (
            <ExtensionChip extension={activeExtension} />
          ) : (
            <Chip>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
              普通
            </Chip>
          )}
          <button
            onClick={() => setShowAttention(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:opacity-80 lg:hidden"
            style={{ color: 'var(--fg-dim)' }}
            aria-label="注意力"
            title="注意力 — 决策轨迹"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
          </button>
          <button onClick={toggleMobileInspector} className="flex h-7 w-7 items-center justify-center rounded-md md:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Inspector">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: 'var(--fg-dim)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl"
                style={{
                  background: 'var(--glass-modal)',
                  WebkitBackdropFilter: 'blur(60px) saturate(200%)',
                  backdropFilter: 'blur(60px) saturate(200%)',
                  border: '1px solid var(--hairline-2)',
                  boxShadow: '0 16px 40px rgba(0,0,0,.5)',
                }}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setRenamingTopic({ id: activeTopic.id, name: activeTopic.name })
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:opacity-80"
                  style={{ color: 'var(--fg-regular)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  重命名话题
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    getWsClient().send({ type: 'sop_template.generate', data: { topicId: activeTopic.id } })
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:opacity-80"
                  style={{ color: 'var(--fg-regular)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  生成 SOP
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setDeletingTopic({ id: activeTopic.id, name: activeTopic.name })
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:opacity-80"
                  style={{ color: 'var(--state-danger)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  删除话题
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <AgentStatusBar
        topicId={activeTopic.id}
        state={agentStatus}
        sessionState={sessionHealth?.state}
        sessionError={sessionHealth?.lastError}
      />

      <MessageList messages={messages} partsByMessage={partsByMessage} toolResults={toolResults} usageByMessage={usageByMessage} approvalsByMessage={approvalsByMessage} cronByMessage={{}} orphanInteractions={orphanInteractions} topicId={activeTopic.id} />
      <MessageInput topicId={activeTopic.id} />

      {deletingTopic && createPortal(
        <DeleteTopicModal
          topicId={deletingTopic.id}
          topicName={deletingTopic.name}
          onClose={() => setDeletingTopic(null)}
        />,
        document.body,
      )}

      {renamingTopic && createPortal(
        <RenameTopicModal
          topicId={renamingTopic.id}
          currentName={renamingTopic.name}
          onClose={() => setRenamingTopic(null)}
        />,
        document.body,
      )}

      {showMcpSettings && typeof document !== 'undefined' && createPortal(
        <McpSettingsModal
          onClose={() => setShowMcpSettings(false)}
          projectDir={projectDir}
          topicName={activeTopic.name}
        />,
        document.body,
      )}

      {showAttention && (
        <AttentionDrawer topicId={activeTopic.id} onClose={() => setShowAttention(false)} />
      )}

      {generatedDraft && typeof document !== 'undefined' && createPortal(
        <SopEditorModal
          title="从会话生成 SOP"
          initial={generatedDraft}
          onClose={() => setGeneratedDraft(null)}
          onSave={saveSopDraft}
        />,
        document.body,
      )}
    </div>
  )
}

function Chip({ variant, children }: { variant?: 'programming' | 'model'; children: React.ReactNode }) {
  const isProg = variant === 'programming'
  const isModel = variant === 'model'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={{
        height: 22,
        background: isProg ? 'rgba(10,132,255,0.10)' : 'var(--glass-1)',
        border: isProg ? '1px solid rgba(10,132,255,0.30)' : '1px solid var(--hairline)',
        color: isProg ? '#6cb1ff' : isModel ? 'var(--fg-regular)' : 'var(--fg-regular)',
        letterSpacing: '-0.005em',
      }}
    >
      {children}
    </span>
  )
}

const EMPTY_MESSAGES: Message[] = []

function AgentStatusBar({ topicId, state, sessionState, sessionError }: { topicId: string; state: string; sessionState?: string; sessionError?: string }) {
  const messages = useMessageStore((s) => s.byTopic[topicId] ?? EMPTY_MESSAGES)
  const progress = useMessageStore((s) => s.progressByTopic[topicId])
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const hasPendingUser = lastMsg?.role === 'user' && lastMsg?.status === 'pending'
  const isActive = state === 'processing' || state === 'aborting' || hasPendingUser
  const latestStreaming = [...messages].reverse().find((m) => m.role === 'assistant' && m.status === 'streaming')
  const activeSinceRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!isActive) {
      activeSinceRef.current = null
      setElapsedMs(0)
      return
    }

    const startedAt = latestStreaming?.started_at ?? activeSinceRef.current ?? Date.now()
    activeSinceRef.current = startedAt
    const tick = () => setElapsedMs(Date.now() - startedAt)
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [isActive, latestStreaming?.started_at, state])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        getWsClient().send({ type: 'user.action', data: { topicId, action: 'abort' } })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [topicId])

  const sessionLabelMap: Record<string, string> = {
    connected: '已连接',
    reconnecting: '重连中',
    disconnected: '已断开',
  }

  const showProgress = isActive && !!progress
  // Only show when agent is active or session is unhealthy — idle + connected is
  // redundant with the green topic dot already visible in the sidebar/topic panel.
  const showBar = isActive || sessionState === 'reconnecting' || sessionState === 'disconnected' || !!sessionError

  if (!showBar) return null

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 md:px-6"
      style={{
        borderBottom: '1px solid var(--hairline)',
        background: 'linear-gradient(180deg, rgba(255,214,10,0.07), rgba(255,214,10,0.02) 55%, transparent)',
      }}
    >
      <span className="inline-flex items-center rounded-full px-2 py-1" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--hairline)' }} aria-label={isActive ? 'Agent active' : 'Agent idle'}>
        <span
          className={isActive ? 'animate-pulse' : ''}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: isActive ? '#F7C26B' : 'var(--fg-dim)',
            boxShadow: isActive ? '0 0 12px rgba(247,194,107,.55)' : 'none',
          }}
        />
      </span>

      {isActive && (
        <span className="text-[12px]" style={{ color: 'var(--fg-dim)', fontFeatureSettings: '"tnum"' }}>
          {formatElapsed(elapsedMs)}
        </span>
      )}

      {showProgress && (
        <span
          className="inline-flex items-center gap-1.5 truncate text-[11.5px]"
          style={{
            color: 'var(--fg-dim)',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--hairline)',
            borderRadius: 999,
            padding: '2px 8px',
            maxWidth: 360,
          }}
          title={`${progress.phase} — ${progress.message}`}
        >
          <span style={{ color: 'var(--fg-regular)', fontWeight: 500 }}>{progress.phase}</span>
          <span className="truncate">{progress.message}</span>
        </span>
      )}

      {sessionState && (
        <span className="text-[12px]" style={{ color: sessionState === 'disconnected' ? '#FF8B82' : 'var(--fg-dim)' }}>
          {sessionLabelMap[sessionState] ?? sessionState}
        </span>
      )}

      {sessionError && (
        <span className="truncate text-[12px]" style={{ color: '#FF8B82', maxWidth: 280 }} title={sessionError}>
          {sessionError}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={!isActive}
          onClick={() => getWsClient().send({ type: 'user.action', data: { topicId, action: 'abort' } })}
          className="inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium"
          style={{
            background: isActive ? 'rgba(255,69,58,0.14)' : 'rgba(255,255,255,0.04)',
            color: isActive ? '#FF8B82' : 'var(--fg-dim)',
            border: `1px solid ${isActive ? 'rgba(255,69,58,0.22)' : 'var(--hairline)'}`,
          }}
        >
          Stop
        </button>
      </div>
    </div>
  )
}

function RenameTopicModal({ topicId, currentName, onClose }: { topicId: string; currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName)
  const renameTopic = useTopicStore((s) => s.renameTopic)

  const handleConfirm = useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) { onClose(); return }
    renameTopic(topicId, trimmed)
    onClose()
  }, [name, topicId, currentName, renameTopic, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') handleConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleConfirm, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden"
        style={{
          width: 'min(400px, calc(100vw - 32px))',
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ padding: '22px 24px 14px' }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--fg-strong)' }}>
            重命名话题
          </div>
          <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--fg-regular)', letterSpacing: '-0.005em' }}>
            为 <b style={{ color: 'var(--fg-strong)' }}>「{currentName}」</b> 设置新名称
          </div>
        </div>

        <div style={{ padding: '4px 24px 8px' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-transparent text-sm outline-none"
            style={{
              height: 42,
              padding: '0 14px',
              borderRadius: 10,
              background: 'rgba(0,0,0,.32)',
              border: '1px solid var(--hairline-2)',
              color: 'var(--fg-strong)',
              letterSpacing: '-0.005em',
            }}
          />
        </div>

        <div
          className="flex items-center gap-2.5"
          style={{
            marginTop: 14,
            padding: '14px 20px',
            borderTop: '1px solid var(--hairline)',
            background: 'rgba(0,0,0,0.20)',
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>Esc</kbd>
            {' '}取消
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center"
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                background: 'var(--glass-1)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!name.trim()}
              className="inline-flex items-center"
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                background: name.trim() ? 'linear-gradient(180deg, #2090FF, #0A84FF 60%, #0064D8)' : 'var(--glass-2)',
                color: name.trim() ? '#fff' : 'var(--fg-dim)',
                border: 'none',
                cursor: name.trim() ? 'pointer' : 'default',
                boxShadow: name.trim() ? 'inset 0 1px 0 rgba(255,255,255,0.30), 0 4px 12px rgba(10,132,255,0.45)' : 'none',
              }}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SystemTopicLayout({ name, toggleSidebar, toggleMobileInspector, children }: { name: string; toggleSidebar: () => void; toggleMobileInspector: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-14 shrink-0 items-center gap-3 px-4 md:px-6"
        style={{
          background: 'rgba(11,12,15,0.45)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <button onClick={toggleSidebar} className="flex h-7 w-7 items-center justify-center rounded-md lg:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Toggle sidebar">
          <MenuIcon />
        </button>
        <h2 className="truncate text-[15px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.012em' }}>{name}</h2>
        <button onClick={toggleMobileInspector} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md md:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Inspector">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
    </div>
  )
}

function ArtifactPoolView() {
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)

  if (poolArtifacts.length === 0) {
    return <p className="py-8 text-center text-sm" style={{ color: 'var(--fg-dim)' }}>产物池为空</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {poolArtifacts.map((a) => (
        <div key={a.id} className="glass-1 p-3">
          <div className="truncate text-xs font-medium" style={{ color: 'var(--fg-strong)' }}>{a.name}</div>
          {artifactPath(a) && <div className="mt-1 truncate text-xs" style={{ color: 'var(--fg-code)', fontFamily: 'var(--font-mono)' }}>{artifactPath(a)}</div>}
          {a.mime && <div className="mt-1 text-xs" style={{ color: 'var(--fg-dim)' }}>{a.mime}</div>}
          {a.size_bytes && <div className="text-xs" style={{ color: 'var(--fg-dim)' }}>{(a.size_bytes / 1024).toFixed(1)} KB</div>}
          {(a.upload_status ?? 'uploaded') === 'upload_failed' && (
            <div className="mt-1 text-xs" style={{ color: '#ff6b6b' }}>
              上传失败{a.failure_message ? `: ${a.failure_message}` : ''}
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            <ArtifactAccessButton artifact={a} mode="preview" />
            <ArtifactAccessButton artifact={a} mode="download" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ArtifactAccessButton({ artifact, mode }: { artifact: import('@agent-chat/protocol').Artifact; mode: 'preview' | 'download' }) {
  const disabled = (artifact.upload_status ?? 'uploaded') !== 'uploaded' || !artifact.r2_key
  const requestAccess = () => {
    if (disabled) return
    const url = mode === 'preview' ? artifact.preview_url ?? artifact.download_url : artifact.download_url
    if (url && !url.startsWith('/api/artifacts/')) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent).detail as { artifactId: string; downloadUrl: string; previewUrl?: string }
      if (detail.artifactId !== artifact.id) return
      window.removeEventListener('agent-chat:artifact-download-ready', onReady)
      window.open(mode === 'preview' ? detail.previewUrl ?? detail.downloadUrl : detail.downloadUrl, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('agent-chat:artifact-download-ready', onReady)
    getWsClient().send({ type: 'artifact.download.init', data: { artifactId: artifact.id } })
  }

  return (
    <button
      onClick={requestAccess}
      disabled={disabled}
      className="rounded px-1.5 py-0.5 text-[11px]"
      style={{ background: 'var(--glass-1)', color: disabled ? 'var(--fg-dim)' : 'var(--fg-regular)', border: '1px solid var(--hairline)', opacity: disabled ? 0.55 : 1 }}
    >
      {mode === 'preview' ? '预览' : '下载'}
    </button>
  )
}

function artifactPath(artifact: import('@agent-chat/protocol').Artifact): string | null {
  if (!artifact.metadata_json) return null
  try {
    const metadata = JSON.parse(artifact.metadata_json) as { path?: unknown }
    return typeof metadata.path === 'string' ? metadata.path : null
  } catch {
    return null
  }
}

function CronAdminView() {
  const crons = useCronStore((s) => s.crons)
  const runs = useCronStore((s) => s.runs)
  const topics = useTopicStore((s) => s.topics)
  const wsClient = getWsClient()
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'error'>('all')
  const [query, setQuery] = useState('')

  const statusColor: Record<string, string> = {
    active: 'var(--state-ok)',
    paused: 'var(--state-paused)',
    error: 'var(--state-danger)',
  }

  const statusLabel: Record<string, string> = {
    active: '运行中',
    paused: '已暂停',
    error: '错误',
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredCrons = crons.filter((cron) => {
    if (filter !== 'all' && cron.status !== filter) return false
    if (!normalizedQuery) return true
    const topicName = cron.originTopicId ? topics.find((t) => t.id === cron.originTopicId)?.name ?? '' : ''
    const haystack = [cron.prompt, cron.cronExpr, cron.originTopicId ?? '', topicName, ...(cron.tags ?? [])]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })

  if (crons.length === 0) {
    return <p className="py-8 text-center text-sm" style={{ color: 'var(--fg-dim)' }}>暂无定时任务</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标签、表达式、任务名"
          className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-sm outline-none"
          style={{
            background: 'rgba(255,255,255,.04)',
            color: 'var(--fg-strong)',
            border: '1px solid var(--hairline)',
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: '全部' },
          { id: 'active', label: 'Active' },
          { id: 'paused', label: 'Paused' },
          { id: 'error', label: 'Error' },
        ].map((item) => {
          const active = filter === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id as typeof filter)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
              style={{
                background: active ? 'rgba(10,132,255,.16)' : 'rgba(255,255,255,.05)',
                color: active ? '#7CB6FF' : 'var(--fg-dim)',
                border: active ? '1px solid rgba(108,177,255,.32)' : '1px solid var(--hairline)',
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {filteredCrons.length === 0 && (
        <div className="rounded-2xl px-4 py-6 text-center text-sm" style={{ background: 'rgba(255,255,255,.04)', color: 'var(--fg-dim)', border: '1px solid var(--hairline)' }}>
          当前筛选下暂无任务。
        </div>
      )}

      {filteredCrons.map((c) => {
        const latestRun = runs
          .filter((run) => run.cronId === c.cronId)
          .sort((a, b) => (b.completedAt ?? b.firedAt) - (a.completedAt ?? a.firedAt))[0]
        const topic = c.originTopicId ? topics.find((t) => t.id === c.originTopicId) : undefined
        const errorSummary = c.status === 'error' ? latestRun?.summary ?? '最近一次执行失败，请检查话题上下文与 Agent 输出。' : null

        return (
          <div
            key={c.cronId}
            className="glass-1 p-4 transition-all hover:translate-y-[-1px]"
            style={{
              border: '1px solid rgba(108,177,255,0.18)',
              boxShadow: '0 0 0 1px rgba(108,177,255,0.03), 0 10px 32px rgba(0,0,0,.18)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{c.prompt}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--fg-dim)' }}>
                  <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid var(--hairline)' }}>
                    {topic?.name ?? (c.originTopicId ? '原话题已删除' : '无原话题')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{c.cronExpr}</span>
                  {c.tags?.map((tag) => (
                    <span key={tag} className="rounded-full px-2 py-0.5" style={{ background: 'rgba(10,132,255,.10)', border: '1px solid rgba(10,132,255,.22)', color: '#7CB6FF' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: `${statusColor[c.status] ?? 'var(--fg-dim)'}22`, color: statusColor[c.status] ?? 'var(--fg-dim)' }}
              >
                {statusLabel[c.status]}
              </span>
            </div>

            <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2" style={{ color: 'var(--fg-dim)' }}>
              <div>上次执行：{formatDateTime(c.lastRunAt)}</div>
              <div>下次执行：{formatDateTime(c.nextRunAt)}</div>
            </div>

            {errorSummary && (
              <div
                className="mt-3 rounded-2xl px-3 py-2.5 text-[12px] leading-5"
                style={{
                  background: 'rgba(255,69,58,.10)',
                  color: '#FFB0AA',
                  border: '1px solid rgba(255,69,58,.18)',
                }}
              >
                <div className="mb-1 font-medium">错误详情</div>
                <div>{errorSummary}</div>
              </div>
            )}

            {latestRun && (
              <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2" style={{ color: 'var(--fg-dim)' }}>
                <div>最近结果：{formatRunStatus(latestRun.status)}</div>
                <div>耗时：{formatDuration(latestRun.duration)}</div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {c.status === 'active' && (
                <ActionBtn onClick={() => wsClient.send({ type: 'cron.pause', data: { cronId: c.cronId } })}>
                  Pause
                </ActionBtn>
              )}
              {c.status === 'paused' && (
                <ActionBtn onClick={() => wsClient.send({ type: 'cron.resume', data: { cronId: c.cronId } })}>
                  Resume
                </ActionBtn>
              )}
              {c.status === 'error' && (
                <ActionBtn onClick={() => wsClient.send({ type: 'cron.resume', data: { cronId: c.cronId } })}>
                  Retry
                </ActionBtn>
              )}
              <ActionBtn danger onClick={() => wsClient.send({ type: 'cron.delete', data: { cronId: c.cronId } })}>
                删除
              </ActionBtn>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SopLibraryView() {
  const templates = useSopTemplateStore((s) => s.templates)
  const [editing, setEditing] = useState<SopTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  const handleSave = useCallback((draft: SopTemplateDraft, id?: string) => {
    getWsClient().send({
      type: id ? 'sop_template.update' : 'sop_template.create',
      data: {
        ...(id ? { id } : {}),
        ...draft,
      },
    })
    setEditing(null)
    setCreating(false)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--fg-strong)' }}>SOP 中心</h3>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--fg-dim)' }}>创建可复用 SOP，并在新话题中组合为工作流。</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold"
          style={{ background: 'rgba(10,132,255,.18)', border: '1px solid rgba(10,132,255,.32)', color: '#8fc6ff' }}
        >
          新建 SOP
        </button>
      </div>

      {templates.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {templates.map((template) => (
            <SopTemplateCard
              key={template.id}
              template={template}
              onEdit={() => setEditing(template)}
              onDelete={() => getWsClient().send({ type: 'sop_template.delete', data: { id: template.id } })}
            />
          ))}
        </div>
      )}
      {templates.length === 0 && (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--fg-dim)' }}>暂无 SOP</p>
      )}

      {(creating || editing) && typeof document !== 'undefined' && createPortal(
        <SopEditorModal
          title={editing ? '编辑 SOP' : '新建 SOP'}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSave={handleSave}
        />,
        document.body,
      )}
    </div>
  )
}

function SopTemplateCard({ template, onEdit, onDelete }: { template: SopTemplate; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="glass-1 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {template.icon && <span>{template.icon}</span>}
            <span className="truncate text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{template.name}</span>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>{template.agent_type}</span>
          </div>
          {template.description && <p className="mt-2 line-clamp-2 text-xs" style={{ color: 'var(--fg-dim)' }}>{template.description}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onEdit} className="rounded-lg px-2 py-1 text-[12px]" style={{ color: 'var(--fg-regular)', background: 'rgba(255,255,255,.06)', border: '1px solid var(--hairline)' }}>
            编辑
          </button>
          <button type="button" onClick={onDelete} className="rounded-lg px-2 py-1 text-[12px]" style={{ color: 'var(--state-danger)', background: 'rgba(255,69,58,.10)', border: '1px solid rgba(255,69,58,.20)' }}>
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
    <div className="min-w-0 rounded-lg px-2 py-1.5" style={{ background: 'rgba(0,0,0,.18)', border: '1px solid var(--hairline)' }}>
      <span className="mr-1" style={{ color: 'var(--fg-dim)' }}>{label}</span>
      <span className="truncate" style={{ color: 'var(--fg-regular)' }}>{value}</span>
    </div>
  )
}

function ActionBtn({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-3 py-1.5 text-[12px] font-medium"
      style={{
        background: danger ? 'rgba(255,69,58,0.14)' : 'rgba(255,255,255,0.06)',
        color: danger ? 'var(--state-danger)' : 'var(--fg-regular)',
        border: `1px solid ${danger ? 'rgba(255,69,58,0.22)' : 'var(--hairline)'}`,
      }}
    >
      {children}
    </button>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 5H15M3 9H15M3 13H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatDateTime(ts?: number): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

function formatDuration(duration?: number | null): string {
  if (duration == null) return '—'
  if (duration < 1000) return `${duration} ms`
  return `${(duration / 1000).toFixed(1)} s`
}

function formatRunStatus(status?: string): string {
  if (!status) return '进行中'
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'timeout') return '超时'
  if (status === 'running') return '进行中'
  return status
}

function ExtensionChip({ extension }: { extension: 'claude-code' | 'codex' }) {
  const isCodex = extension === 'codex'
  const label = isCodex ? 'Codex' : 'Claude Code'
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={{ height: 22, background: 'rgba(10,132,255,0.10)', border: '1px solid rgba(10,132,255,0.30)', color: '#6cb1ff', letterSpacing: '-0.005em' }}
    >
      {isCodex ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" /><polyline points="3 7 12 13 21 7" /><path d="m9 11-3 3 3 3" /><path d="m15 11 3 3-3 3" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></svg>
      )}
      {label}
    </span>
  )
}

function ToolsMenu({ planMode, onTogglePlan, onOpenMcp }: { planMode: boolean; onTogglePlan: () => void; onOpenMcp: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative z-[120] shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium transition-all"
        style={{
          height: 22,
          background: planMode ? 'rgba(255,214,10,0.12)' : 'var(--glass-1)',
          border: planMode ? '1px solid rgba(255,214,10,0.30)' : '1px solid var(--hairline)',
          color: planMode ? '#F7C26B' : 'var(--fg-dim)',
          letterSpacing: '-0.005em',
        }}
        title="模式与工具"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-[120] mt-1 w-44 overflow-hidden rounded-xl"
          style={{
            background: 'var(--glass-modal)',
            WebkitBackdropFilter: 'blur(60px) saturate(200%)',
            backdropFilter: 'blur(60px) saturate(200%)',
            border: '1px solid var(--hairline-2)',
            boxShadow: '0 16px 40px rgba(0,0,0,.5)',
          }}
        >
          <button
            onClick={onTogglePlan}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm transition-colors hover:opacity-80"
            style={{ color: planMode ? '#F7C26B' : 'var(--fg-regular)' }}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11h6M9 7h6M9 15h4" /><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
              Plan 模式
            </span>
            <span
              className="rounded-full px-1.5 text-[10px] font-semibold"
              style={{
                background: planMode ? 'rgba(255,214,10,0.18)' : 'var(--glass-1)',
                border: planMode ? '1px solid rgba(255,214,10,0.30)' : '1px solid var(--hairline)',
                color: planMode ? '#F7C26B' : 'var(--fg-dim)',
              }}
            >
              {planMode ? 'ON' : 'OFF'}
            </span>
          </button>
          <button
            onClick={() => { onOpenMcp(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm transition-colors hover:opacity-80"
            style={{ color: 'var(--fg-regular)', borderTop: '1px solid var(--hairline)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
            MCP 设置
          </button>
        </div>
      )}
    </div>
  )
}
