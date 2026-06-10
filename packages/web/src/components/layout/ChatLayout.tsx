'use client'

import { useEffect } from 'react'
import { useTopicStore } from '@/stores/topic-store'
import { useUiStore } from '@/stores/ui-store'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { Sidebar } from './Sidebar'
import { TopicPanel } from './TopicPanel'
import { InspectorPanel } from './InspectorPanel'
import { SleepReminder } from '../SleepReminder'

export function ChatLayout() {
  const activeTopicId = useTopicStore((s) => s.activeTopicId)
  const activeTopic = useTopicStore((s) => s.topics.find((topic) => topic.id === s.activeTopicId))
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const inspectorCollapsed = useUiStore((s) => s.inspectorCollapsed)
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen)
  const mobileInspectorOpen = useUiStore((s) => s.mobileInspectorOpen)
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen)
  const setMobileInspectorOpen = useUiStore((s) => s.setMobileInspectorOpen)

  const isMobile = useIsMobile()
  const setMobile = useUiStore((s) => s.setMobile)
  const showInspector = activeTopic?.kind === 'normal'

  useEffect(() => { setMobile(isMobile) }, [isMobile, setMobile])

  if (isMobile) {
    return (
      <div
        className="relative h-dvh w-full overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-0)',
          paddingTop: 'var(--safe-top)',
          paddingBottom: 'var(--safe-bottom)',
        }}
      >
        {/* Full-screen topic panel */}
        <TopicPanel />

        {/* Sidebar drawer overlay */}
        {mobileSidebarOpen && (
          <MobileSidebarOverlay
            onClose={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Inspector bottom sheet */}
        {showInspector && mobileInspectorOpen && (
          <MobileInspectorSheet
            onClose={() => setMobileInspectorOpen(false)}
          />
        )}

        <SleepReminder />
      </div>
    )
  }

  // Desktop: existing 3-column grid
  const inspectorWidth = showInspector ? (inspectorCollapsed ? '40px' : '320px') : '0px'

  return (
    <div
      className="relative h-dvh w-full overflow-hidden"
      style={{ backgroundColor: 'var(--bg-0)' }}
    >
      {/* Ambient color blobs for glass refraction */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="ambient-blob-blue" style={{ width: 720, height: 720, left: -180, top: -240 }} />
        <div className="ambient-blob-purple" style={{ width: 600, height: 600, right: -160, top: -140 }} />
        <div className="ambient-blob-gold" style={{ width: 520, height: 520, right: 240, bottom: -210 }} />
        <div className="ambient-blob-teal" style={{ width: 520, height: 520, left: 320, bottom: -180 }} />
      </div>

      {/* Shell */}
      <div
        className="relative z-[1] grid h-full"
        style={{
          gridTemplateColumns: sidebarCollapsed
            ? `0px 1fr ${inspectorWidth}`
            : `240px 1fr ${inspectorWidth}`,
          transition: 'grid-template-columns 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Sidebar */}
        <aside className="overflow-hidden">
          <Sidebar />
        </aside>

        {/* Main topic panel */}
        <main className="isolate min-w-0 overflow-hidden">
          <TopicPanel />
        </main>

        {/* Inspector panel */}
        <aside className="relative z-[5] hidden overflow-visible lg:block">
          {activeTopicId && showInspector && <InspectorPanel />}
        </aside>
      </div>

      <SleepReminder />
    </div>
  )
}

/* ── Mobile sidebar drawer ── */

function MobileSidebarOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" style={{ paddingTop: 'var(--safe-top)' }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className="absolute left-0 top-0 bottom-0 z-50 w-[280px] overflow-hidden"
        style={{
          background: 'rgba(21,23,28,0.92)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          borderRight: '1px solid var(--hairline)',
          boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.06), 20px 0 60px rgba(0,0,0,0.5)',
          animation: 'slideInLeft 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <Sidebar />
      </div>
    </div>
  )
}

/* ── Mobile inspector bottom sheet ── */

function MobileInspectorSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          height: '60vh',
          borderRadius: '20px 20px 0 0',
          background: 'rgba(21,23,28,0.92)',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2)',
          borderBottom: 'none',
          boxShadow: '0 -10px 60px rgba(0,0,0,0.5)',
          animation: 'slideUp 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'var(--safe-bottom)',
        }}
      >
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <InspectorPanel />
        </div>
      </div>
    </div>
  )
}
