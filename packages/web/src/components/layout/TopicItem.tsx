'use client'

import type { Topic } from '@agent-chat/protocol'

interface TopicItemProps {
  topic: Topic
  active: boolean
  onClick: () => void
}

export function TopicItem({ topic, active, onClick }: TopicItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
      style={{
        backgroundColor: active ? 'var(--glass-2)' : 'transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-regular)',
      }}
    >
      <div className="flex items-center gap-2">
        <KindBadge kind={topic.kind} />
        <span className="truncate">{topic.name}</span>
      </div>
    </button>
  )
}

function KindBadge({ kind }: { kind: Topic['kind'] }) {
  const labels: Record<Topic['kind'], string> = {
    normal: 'C',
    system_cron_admin: 'CR',
    system_artifact_pool: 'A',
    system_sop_library: 'S',
  }
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
      style={{
        backgroundColor: kind === 'normal' ? 'var(--glass-2)' : 'var(--role-cron)',
        color: kind === 'normal' ? 'var(--fg-dim)' : 'var(--bg-0)',
      }}
    >
      {labels[kind]}
    </span>
  )
}
