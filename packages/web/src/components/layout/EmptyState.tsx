'use client'

import { HelmLogo, HelmWordmark } from '@/components/ui/HelmLogo'

interface EmptyStateProps {
  onToggleSidebar: () => void
}

export function EmptyState({ onToggleSidebar }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: 'radial-gradient(130% 120% at 30% 18%, #3AA0FF 0%, #0A84FF 42%, #0050C8 100%)',
          boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.30), inset 0 -8px 22px rgba(0,40,110,0.5), 0 8px 22px rgba(0,0,0,0.4)',
          color: '#fff',
        }}
      >
        <HelmLogo size={36} accentColor="#FFD98A" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,30,90,0.45))' }} />
      </div>
      <div className="text-center">
        <h2 className="text-lg">
          <HelmWordmark fontSize={20} />
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-dim)' }}>
          选择或创建一个话题开始对话
        </p>
      </div>
      <button
        onClick={onToggleSidebar}
        className="mt-2 rounded-lg px-4 py-2 text-sm font-medium lg:hidden"
        style={{
          background: 'var(--glass-2)',
          color: 'var(--fg-regular)',
        }}
      >
        浏览话题
      </button>
    </div>
  )
}
