'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useArtifactStore } from '@/stores/artifact-store'
import { useMessageStore } from '@/stores/message-store'
import { useUiStore } from '@/stores/ui-store'
import { useCronStore } from '@/stores/cron-store'
import { getWsClient } from '@/lib/ws-client'
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer'

const EMPTY_ARTIFACTS: import('@agent-chat/protocol').Artifact[] = []

type TabId = 'todo' | 'plan' | 'artifacts' | 'cron'

export function InspectorPanel() {
  const [tab, setTab] = useState<TabId>('todo')
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const artifacts = useArtifactStore((s) =>
    activeTopicId ? (s.byTopic[activeTopicId] ?? EMPTY_ARTIFACTS) : EMPTY_ARTIFACTS,
  )
  const todosByTopic = useMessageStore((s) => s.todosByTopic)
  const planByTopic = useMessageStore((s) => s.planByTopic)
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const inspectorCollapsed = useUiStore((s) => s.inspectorCollapsed)

  const todos = activeTopicId ? (todosByTopic[activeTopicId] ?? []) : []
  const plan = activeTopicId ? planByTopic[activeTopicId] : null
  const allCrons = useCronStore((s) => s.crons)
  const crons = useMemo(
    () => (activeTopicId ? allCrons.filter((cron) => cron.originTopicId === activeTopicId) : []),
    [activeTopicId, allCrons],
  )
  const hasContent = todos.length > 0 || !!plan || artifacts.length > 0 || crons.length > 0

  if (inspectorCollapsed && !hasContent) {
    return (
      <div
        className="flex h-full flex-col items-center gap-2 py-3"
        style={{
          width: 40,
          borderLeft: '1px solid var(--hairline)',
          background: 'rgba(21,23,28,0.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
        }}
      >
        <StripIcon label="Todo" active={tab === 'todo'} onClick={() => { setTab('todo'); toggleInspector?.() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </StripIcon>
        <StripIcon label="Plan" active={tab === 'plan'} onClick={() => { setTab('plan'); toggleInspector?.() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11h6M9 7h6M9 15h4" /><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
        </StripIcon>
        <StripIcon label="Artifacts" active={tab === 'artifacts'} onClick={() => { setTab('artifacts'); toggleInspector?.() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>
        </StripIcon>
        <StripIcon label="Cron" active={tab === 'cron'} onClick={() => { setTab('cron'); toggleInspector?.() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2" /></svg>
        </StripIcon>
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{
        borderLeft: '1px solid var(--hairline)',
        background: 'rgba(21,23,28,0.5)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        backdropFilter: 'blur(40px) saturate(180%)',
      }}
    >
      <div
        className="flex items-center px-1.5"
        style={{ height: 44, borderBottom: '1px solid var(--hairline)' }}
      >
        <TabBtn active={tab === 'todo'} onClick={() => setTab('todo')} count={todos.length}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          Todo
        </TabBtn>
        <TabBtn active={tab === 'plan'} onClick={() => setTab('plan')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11h6M9 7h6M9 15h4" /><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
          Plan
        </TabBtn>
        <TabBtn active={tab === 'artifacts'} onClick={() => setTab('artifacts')} count={artifacts.length}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>
          Artifacts
        </TabBtn>
        <TabBtn active={tab === 'cron'} onClick={() => setTab('cron')} count={crons.length}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2" /></svg>
          Cron
        </TabBtn>
        <button
          onClick={() => toggleInspector?.()}
          className="ml-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center"
          style={{ color: 'var(--fg-dim)' }}
          title="折叠"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {tab === 'todo' && <TodoTab todos={todos} />}
        {tab === 'plan' && <PlanTab plan={plan} />}
        {tab === 'artifacts' && <ArtifactsTab artifacts={artifacts} />}
        {tab === 'cron' && <CronTab topicId={activeTopicId} />}
      </div>
    </div>
  )
}

function StripIcon({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center justify-center rounded-md p-1.5 transition-colors"
      style={{ color: active ? 'var(--fg-strong)' : 'var(--fg-dim)', background: active ? 'var(--glass-1)' : 'transparent' }}
    >
      {children}
    </button>
  )
}

function TabBtn({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors"
      style={{
        height: 26,
        color: active ? 'var(--fg-strong)' : 'var(--fg-dim)',
        background: active ? 'var(--glass-2)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--hairline)' : 'none',
        letterSpacing: '-0.005em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      {count !== undefined && count > 0 && active && (
        <span
          className="grid h-4 place-items-center rounded-full px-1.5 text-[10px]"
          style={{
            background: active ? 'rgba(10,132,255,0.25)' : 'rgba(255,255,255,0.10)',
            color: active ? '#6cb1ff' : 'var(--fg-regular)',
            fontFeatureSettings: '"tnum"',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function TodoTab({
  todos,
  defaultShowCompleted = false,
}: {
  todos: Array<{ id: string; content: string; status: string; activeForm?: string }>
  defaultShowCompleted?: boolean
}) {
  const [showCompleted, setShowCompleted] = useState(defaultShowCompleted)

  if (todos.length === 0) {
    return (
      <div className="flex items-center justify-center p-6" style={{ color: 'var(--fg-dim)' }}>
        <p className="text-sm">暂无 Todo</p>
      </div>
    )
  }

  const activeTodos = todos.filter((todo) => todo.status !== 'completed')
  const completedTodos = todos.filter((todo) => todo.status === 'completed')

  return (
    <div className="p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.08em' }}>Plan · Todo</p>
      <div className="space-y-2.5">
        {activeTodos.map((todo) => (
          <TodoCard key={todo.id} todo={todo} />
        ))}

        {completedTodos.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowCompleted((value) => !value)}
              className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left"
              style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)', color: 'var(--fg-dim)' }}
              aria-expanded={showCompleted}
              aria-controls="completed-todos"
            >
              <span className="text-[12px] font-medium">已完成 {completedTodos.length}</span>
              <span className="text-[12px]">{showCompleted ? '收起' : '展开'}</span>
            </button>

            {showCompleted && (
              <div id="completed-todos" className="space-y-2">
                {completedTodos.map((todo) => (
                  <TodoCard key={todo.id} todo={todo} completed />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TodoCard({ todo, completed = false }: {
  todo: { id: string; content: string; status: string; activeForm?: string }
  completed?: boolean
}) {
  return (
    <div className="rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)' }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 inline-block h-2 w-2 rounded-full" style={{ background: todo.status === 'completed' ? '#6FE39A' : todo.status === 'in_progress' ? '#7CB6FF' : 'var(--fg-dim)' }} />
        <div className="min-w-0 flex-1">
          <div className="text-sm" style={{ color: completed ? 'var(--fg-dim)' : 'var(--fg-regular)', textDecoration: completed ? 'line-through' : 'none' }}>{todo.content}</div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--fg-dim)' }}>{todo.activeForm ?? todo.status}</div>
        </div>
      </div>
    </div>
  )
}

export { TodoTab }

function PlanTab({ plan }: { plan: string | null | undefined }) {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({})

  const checklist = useMemo(() => {
    if (!plan) return []
    return plan
      .split('\n')
      .map((line, index) => ({
        id: `${index}-${line}`,
        text: line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, '').trim(),
        checked: /^\s*[-*]\s+\[[xX]\]\s+/.test(line),
      }))
      .filter((item) => item.text.length > 0 && /^\s*[-*]\s+\[[ xX]\]\s+/.test(plan.split('\n')[Number(item.id.split('-')[0])]!))
  }, [plan])

  const effectiveChecklist = checklist.map((item) => ({
    ...item,
    checked: checkedItems[item.id] ?? item.checked,
  }))

  const completedCount = effectiveChecklist.filter((item) => item.checked).length
  const progress = effectiveChecklist.length > 0 ? Math.round((completedCount / effectiveChecklist.length) * 100) : 0
  const estimatedMinutes = effectiveChecklist.length > 0 ? effectiveChecklist.length * 8 : null

  if (!plan) {
    return (
      <div className="flex items-center justify-center p-6" style={{ color: 'var(--fg-dim)' }}>
        <p className="text-sm">暂无 Plan</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)' }}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium" style={{ color: 'var(--fg-strong)' }}>进度追踪</span>
          <span className="text-[12px]" style={{ color: 'var(--fg-dim)', fontFeatureSettings: '"tnum"' }}>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #4DA3FF, #7CB6FF)' }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: 'var(--fg-dim)' }}>
          <span>{completedCount}/{effectiveChecklist.length || 0} 项完成</span>
          <span>{estimatedMinutes ? `est. ${estimatedMinutes} min` : 'est. —'}</span>
        </div>
      </div>

      {effectiveChecklist.length > 0 && (
        <div className="space-y-2">
          {effectiveChecklist.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCheckedItems((prev) => ({ ...prev, [item.id]: !item.checked }))}
              className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left"
              style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)' }}
            >
              <span
                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded"
                style={{
                  background: item.checked ? 'rgba(48,209,88,.18)' : 'transparent',
                  border: `1px solid ${item.checked ? 'rgba(48,209,88,.32)' : 'var(--hairline-2)'}`,
                  color: '#6FE39A',
                }}
              >
                {item.checked ? '✓' : ''}
              </span>
              <span className="text-sm" style={{ color: item.checked ? 'var(--fg-dim)' : 'var(--fg-regular)', textDecoration: item.checked ? 'line-through' : 'none' }}>
                {item.text}
              </span>
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-dim)', letterSpacing: '0.08em' }}>Plan</p>
        <div className="rounded-2xl p-3.5 overflow-hidden" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)' }}>
          <MarkdownRenderer content={plan} />
        </div>
      </div>
    </div>
  )
}

function ArtifactsTab({ artifacts }: { artifacts: import('@agent-chat/protocol').Artifact[] }) {
  if (artifacts.length === 0) {
    return (
      <div className="flex items-center justify-center p-6" style={{ color: 'var(--fg-dim)' }}>
        <p className="text-sm">当前话题暂无产物</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3">
      {artifacts.map((a) => (
        <div key={a.id} className="glass-1 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--fg-dim)' }}>{mimeIcon(a.mime)}</span>
            <span className="truncate text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{a.name}</span>
          </div>
          {artifactPath(a) && (
            <div className="mt-1.5 truncate text-[11px]" style={{ color: 'var(--fg-code)', fontFamily: 'var(--font-mono)' }}>
              {artifactPath(a)}
            </div>
          )}
          {(a.upload_status ?? 'uploaded') === 'upload_failed' && (
            <div className="mt-1.5 text-[11px]" style={{ color: '#ff6b6b' }}>
              上传失败{a.failure_message ? `: ${a.failure_message}` : ''}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {a.mime && <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>{a.mime}</span>}
            {a.size_bytes != null && <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>{formatSize(a.size_bytes)}</span>}
            <span
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={artifactSourceStyle(a.source)}
            >
              {a.source === 'generated' ? '生成' : '上传'}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <ArtifactAccessButton artifact={a} mode="preview" />
              <ArtifactAccessButton artifact={a} mode="download" />
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ArtifactAccessButton({ artifact, mode }: { artifact: import('@agent-chat/protocol').Artifact; mode: 'preview' | 'download' }) {
  const disabled = (artifact.upload_status ?? 'uploaded') !== 'uploaded'
  const requestAccess = () => {
    if (disabled) return
    const url = mode === 'preview' ? artifact.preview_url ?? artifact.download_url : artifact.download_url
    if (url && !url.startsWith('/api/artifacts/')) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }

    // Pre-open window synchronously on user click so popup blockers don't interfere.
    // The URL is filled in asynchronously once the server returns a signed URL.
    const newWindow = window.open('about:blank', '_blank')

    const cleanup = () => {
      window.removeEventListener('agent-chat:artifact-download-ready', onReady)
      window.removeEventListener('agent-chat:error', onError)
    }
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent).detail as { artifactId: string; downloadUrl: string; previewUrl?: string }
      if (detail.artifactId !== artifact.id) return
      cleanup()
      const targetUrl = mode === 'preview' ? detail.previewUrl ?? detail.downloadUrl : detail.downloadUrl
      if (newWindow && !newWindow.closed) {
        newWindow.location.href = targetUrl
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer')
      }
    }
    const onError = (event: Event) => {
      const detail = (event as CustomEvent).detail as { code?: string }
      if (detail.code !== 'ARTIFACT_DOWNLOAD_UNAVAILABLE') return
      cleanup()
      if (newWindow && !newWindow.closed) newWindow.close()
      alert('该产物暂不支持预览（文件尚未上传到云端）')
    }
    window.addEventListener('agent-chat:artifact-download-ready', onReady)
    window.addEventListener('agent-chat:error', onError)
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

function artifactSourceStyle(source: import('@agent-chat/protocol').Artifact['source']): React.CSSProperties {
  return source === 'generated'
    ? { background: 'rgba(247, 194, 107, 0.16)', color: '#d89b32', border: '1px solid rgba(247, 194, 107, 0.28)' }
    : { background: 'rgba(48, 209, 88, 0.14)', color: '#2ea85b', border: '1px solid rgba(48, 209, 88, 0.26)' }
}

function CronTab({ topicId }: { topicId: string | null }) {
  const allCrons = useCronStore((s) => s.crons)
  const crons = useMemo(
    () => (topicId ? allCrons.filter((cron) => cron.originTopicId === topicId) : []),
    [topicId, allCrons],
  )
  const runs = useCronStore((s) => s.runs)

  useEffect(() => {
    getWsClient().send({ type: 'cron.sync', data: {} })
  }, [topicId])

  if (crons.length === 0) {
    return (
      <div className="flex items-center justify-center p-6" style={{ color: 'var(--fg-dim)' }}>
        <p className="text-sm">暂无 Cron</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3">
      {crons.map((cron) => {
        const latestRun = runs
          .filter((run) => run.cronId === cron.cronId)
          .sort((a, b) => (b.completedAt ?? b.firedAt) - (a.completedAt ?? a.firedAt))[0]

        return (
          <div key={cron.cronId} className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--hairline)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>{cron.prompt}</div>
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'rgba(255,255,255,.08)', color: 'var(--fg-dim)' }}>{cron.status}</span>
            </div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{cron.cronExpr}</div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--fg-dim)' }}>
              最近结果：{latestRun?.summary ?? formatRunStatus(latestRun?.status)}
            </div>
          </div>
        )
      })}
    </div>
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

function mimeIcon(mime: string | null): string {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.includes('csv') || mime.includes('sheet')) return '📊'
  if (mime.includes('json')) return '📋'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('markdown') || mime.includes('text/')) return '📝'
  return '📄'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRunStatus(status?: string): string {
  if (!status) return '进行中'
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'timeout') return '超时'
  if (status === 'running') return '进行中'
  return status
}
