'use client'

import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { Sidebar } from './Sidebar'
import { TopicPanel } from './TopicPanel'
import { InspectorPanel } from './InspectorPanel'

export function ChatLayout() {
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)

  return (
    <div className="flex h-dvh w-full overflow-hidden" style={{ backgroundColor: 'var(--bg-0)' }}>
      {/* Sidebar */}
      <aside
        className={`shrink-0 transition-all duration-200 ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
        }`}
        style={{ borderRight: '1px solid var(--divider)' }}
      >
        <Sidebar />
      </aside>

      {/* Main topic panel */}
      <main className="flex-1 min-w-0 flex flex-col" style={{ backgroundColor: 'var(--bg-1)' }}>
        <TopicPanel />
      </main>

      {/* Inspector panel */}
      {activeTopicId && (
        <aside
          className="hidden lg:flex w-80 shrink-0 flex-col"
          style={{
            backgroundColor: 'var(--bg-1)',
            borderLeft: '1px solid var(--divider)',
          }}
        >
          <InspectorPanel />
        </aside>
      )}
    </div>
  )
}
