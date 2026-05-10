'use client'

import { Component, useEffect, type ReactNode } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useMessageStore } from '@/stores/message-store'
import { useUiStore } from '@/stores/ui-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useCronStore } from '@/stores/cron-store'
import { useSopTemplateStore } from '@/stores/sop-template-store'
import { EmptyState } from './EmptyState'
import { MessageInput } from './MessageInput'
import { MessageList } from '@/components/chat/MessageList'
import { getWsClient } from '@/lib/ws-client'

class TopicErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
          <h3 className="text-sm font-semibold" style={{ color: '#f87171' }}>TopicPanel Error</h3>
          <pre className="max-h-64 max-w-lg overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap" style={{ background: 'var(--surface-secondary)', color: 'var(--fg-regular)' }}>
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

  const byTopic = useMessageStore((s) => s.byTopic)
  const partsByMessage = useMessageStore((s) => s.partsByMessage)

  const activeTopic = topics.find((t) => t.id === activeTopicId)

  // Notify server when active topic changes (for artifact/cron/template lists)
  useEffect(() => {
    if (activeTopicId) {
      getWsClient().send({ type: 'topic.select', data: { topicId: activeTopicId } })
    }
  }, [activeTopicId])

  if (!activeTopic) {
    return <EmptyState onToggleSidebar={toggleSidebar} />
  }

  return (
    <TopicErrorBoundary>
      <TopicPanelContent activeTopic={activeTopic} toggleSidebar={toggleSidebar} byTopic={byTopic} partsByMessage={partsByMessage} />
    </TopicErrorBoundary>
  )
}

function TopicPanelContent({ activeTopic, toggleSidebar, byTopic, partsByMessage }: {
  activeTopic: NonNullable<ReturnType<typeof useTopicStore.getState>['topics'][0]>
  toggleSidebar: () => void
  byTopic: Record<string, ReturnType<typeof useMessageStore.getState>['byTopic'][string]>
  partsByMessage: Record<string, ReturnType<typeof useMessageStore.getState>['partsByMessage'][string]>
}) {
  const usageByMessage = useMessageStore((s) => s.usageByMessage)
  // System topic views
  if (activeTopic.kind === 'system_artifact_pool') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar}><ArtifactPoolView /></SystemTopicLayout>
  }
  if (activeTopic.kind === 'system_cron_admin') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar}><CronAdminView /></SystemTopicLayout>
  }
  if (activeTopic.kind === 'system_sop_library') {
    return <SystemTopicLayout name={activeTopic.name} toggleSidebar={toggleSidebar}><SopLibraryView /></SystemTopicLayout>
  }

  // Normal topic — chat view
  const messages = byTopic[activeTopic.id] ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
        <button onClick={toggleSidebar} className="rounded-md p-1 lg:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Toggle sidebar">
          <MenuIcon />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--fg-strong)' }}>{activeTopic.name}</h2>
          <p className="text-xs" style={{ color: 'var(--fg-dim)' }}>{activeTopic.agent_type} / {activeTopic.current_model ?? 'default'}</p>
        </div>
      </div>

      <MessageList messages={messages} partsByMessage={partsByMessage} toolResults={{}} usageByMessage={usageByMessage} approvalsByMessage={{}} cronByMessage={{}} />
      <MessageInput topicId={activeTopic.id} />
    </div>
  )
}

function SystemTopicLayout({ name, toggleSidebar, children }: { name: string; toggleSidebar: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--divider)' }}>
        <button onClick={toggleSidebar} className="rounded-md p-1 lg:hidden" style={{ color: 'var(--fg-dim)' }} aria-label="Toggle sidebar">
          <MenuIcon />
        </button>
        <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--fg-strong)' }}>{name}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  )
}

function ArtifactPoolView() {
  const poolArtifacts = useArtifactStore((s) => s.poolArtifacts)

  if (poolArtifacts.length === 0) {
    return <p className="text-center py-8 text-sm" style={{ color: 'var(--fg-dim)' }}>产物池为空</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {poolArtifacts.map((a) => (
        <div key={a.id} className="rounded-lg p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--divider)' }}>
          <div className="text-xs font-medium truncate" style={{ color: 'var(--fg-strong)' }}>{a.name}</div>
          {a.mime && <div className="text-xs mt-1" style={{ color: 'var(--fg-dim)' }}>{a.mime}</div>}
          {a.size_bytes && <div className="text-xs" style={{ color: 'var(--fg-dim)' }}>{(a.size_bytes / 1024).toFixed(1)} KB</div>}
        </div>
      ))}
    </div>
  )
}

function CronAdminView() {
  const crons = useCronStore((s) => s.crons)
  const wsClient = getWsClient()

  const statusColor: Record<string, string> = {
    active: '#4ade80',
    paused: '#9ca3af',
    error: '#f87171',
  }

  const statusLabel: Record<string, string> = {
    active: '运行中',
    paused: '已暂停',
    error: '错误',
  }

  if (crons.length === 0) {
    return <p className="text-center py-8 text-sm" style={{ color: 'var(--fg-dim)' }}>暂无定时任务</p>
  }

  return (
    <div className="space-y-3">
      {crons.map((c) => (
        <div key={c.cronId} className="rounded-lg p-4" style={{ background: 'var(--surface-secondary)', borderLeft: `4px solid ${statusColor[c.status] ?? 'var(--fg-dim)'}` }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{c.prompt}</div>
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: statusColor[c.status] + '22', color: statusColor[c.status] }}>{statusLabel[c.status]}</span>
          </div>
          <div className="text-xs mt-2" style={{ color: 'var(--fg-dim)' }}>
            表达式: {c.cronExpr}
          </div>
          <div className="flex gap-2 mt-3">
            {c.status === 'active' && (
              <button
                onClick={() => wsClient.send({ type: 'cron.pause', data: { cronId: c.cronId } })}
                className="rounded px-2 py-1 text-xs" style={{ background: 'var(--surface-tertiary)', color: 'var(--fg-dim)' }}
              >暂停</button>
            )}
            <button
              onClick={() => { wsClient.send({ type: 'cron.delete', data: { cronId: c.cronId } }) }}
              className="rounded px-2 py-1 text-xs" style={{ background: '#f8717122', color: '#f87171' }}
            >删除</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function SopLibraryView() {
  const templates = useSopTemplateStore((s) => s.templates)
  const builtinTemplates = templates.filter((t) => t.builtin)
  const userTemplates = templates.filter((t) => !t.builtin)

  return (
    <div className="space-y-6">
      {builtinTemplates.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--fg-dim)' }}>内置模板</h3>
          <div className="grid grid-cols-2 gap-3">
            {builtinTemplates.map((t) => (
              <SopTemplateCard key={t.id} template={t} />
            ))}
          </div>
        </section>
      )}
      {userTemplates.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--fg-dim)' }}>我的模板</h3>
          <div className="grid grid-cols-2 gap-3">
            {userTemplates.map((t) => (
              <SopTemplateCard key={t.id} template={t} />
            ))}
          </div>
        </section>
      )}
      {templates.length === 0 && (
        <p className="text-center py-8 text-sm" style={{ color: 'var(--fg-dim)' }}>暂无模板</p>
      )}
    </div>
  )
}

function SopTemplateCard({ template }: { template: { id: string; name: string; icon: string | null; description: string | null; agent_type: string } }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--divider)' }}>
      <div className="flex items-center gap-2">
        {template.icon && <span>{template.icon}</span>}
        <span className="text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{template.name}</span>
      </div>
      {template.description && <p className="text-xs mt-2" style={{ color: 'var(--fg-dim)' }}>{template.description}</p>}
      <span className="inline-block mt-2 rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--surface-tertiary)', color: 'var(--fg-dim)' }}>{template.agent_type}</span>
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 5H15M3 9H15M3 13H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
