'use client'

import { useState } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useArtifactStore } from '@/stores/artifact-store'

const EMPTY_ARTIFACTS: import('@agent-chat/protocol').Artifact[] = []

export function InspectorPanel() {
  const [tab, setTab] = useState<'info' | 'artifacts'>('info')
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const artifacts = useArtifactStore((s) =>
    activeTopicId ? (s.byTopic[activeTopicId] ?? EMPTY_ARTIFACTS) : EMPTY_ARTIFACTS,
  )

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex border-b"
        style={{ borderBottom: '1px solid var(--divider)' }}
      >
        <TabButton active={tab === 'info'} onClick={() => setTab('info')}>
          Info
        </TabButton>
        <TabButton active={tab === 'artifacts'} onClick={() => setTab('artifacts')}>
          产物 {artifacts.length > 0 && <span className="ml-1 rounded-full px-1.5 text-[10px]" style={{ background: 'var(--role-user)', color: '#fff' }}>{artifacts.length}</span>}
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'info' && <InfoTab />}
        {tab === 'artifacts' && <ArtifactsTab artifacts={artifacts} />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 px-3 py-2.5 text-xs font-medium transition-colors"
      style={{
        color: active ? 'var(--fg-strong)' : 'var(--fg-dim)',
        borderBottom: active ? '2px solid var(--role-user)' : '2px solid transparent',
      }}
    >
      {children}
    </button>
  )
}

function InfoTab() {
  return (
    <div className="flex items-center justify-center p-4" style={{ color: 'var(--fg-dim)' }}>
      <p className="text-sm">Select a message to view details</p>
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
        <div
          key={a.id}
          className="rounded-lg p-3"
          style={{ background: 'var(--surface-secondary)', border: '1px solid var(--divider)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--fg-dim)' }}>
              {mimeIcon(a.mime)}
            </span>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--fg-strong)' }}>
              {a.name}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            {a.mime && (
              <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>
                {a.mime}
              </span>
            )}
            {a.size_bytes != null && (
              <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>
                {formatSize(a.size_bytes)}
              </span>
            )}
            <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'var(--surface-tertiary)', color: 'var(--fg-dim)' }}>
              {a.source === 'generated' ? '生成' : '上传'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
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
