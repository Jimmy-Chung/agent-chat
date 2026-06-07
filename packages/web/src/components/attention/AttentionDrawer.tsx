'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAttentionTrace } from '@/lib/attention'
import { AttentionXPanel } from './AttentionXPanel'

export function AttentionDrawer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const attention = useAttentionTrace(topicId)
  const { nodes, goalAnchor, planItems, rawEvents, isAnalyzing, llmUnavailable } = attention
  const fitViewCallbackRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(3,5,10,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[1268px] flex-col"
        style={{
          background: 'var(--bg-0, #0B0C0F)',
          borderLeft: '1px solid var(--hairline-2)',
          borderRadius: '18px 0 0 18px',
          boxShadow: '-30px 0 80px rgba(0,0,0,.55), inset 1px 0 0 rgba(255,255,255,.05)',
          overflow: 'hidden',
          animation: 'attn-panel-slidein .32s cubic-bezier(.22,1,.36,1) both',
        }}
      >
        {/* Grip handle */}
        <div style={{ position: 'absolute', left: 5, top: '50%', transform: 'translateY(-50%)', width: 4, height: 46, borderRadius: 3, background: 'rgba(255,255,255,.18)', zIndex: 10, pointerEvents: 'none' }} />

        {/* Top bar */}
        <header
          className="flex h-[52px] shrink-0 items-center gap-[11px] px-[18px]"
          style={{
            borderBottom: '1px solid var(--hairline)',
            background: 'rgba(13,16,18,.6)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            zIndex: 5,
            flexShrink: 0,
          }}
        >
          {/* Icon */}
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'rgba(10,132,255,.16)',
            border: '1px solid rgba(10,132,255,.32)',
            display: 'grid', placeItems: 'center',
            color: '#6cb1ff',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06),0 0 14px rgba(10,132,255,.20)',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
              <circle cx="12" cy="12" r="3.4"/>
            </svg>
          </div>

          <span className="text-[14px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-.01em' }}>
            Attention
          </span>

          {isAnalyzing && (
            <span className="text-[11px]" style={{ color: '#F7C26B' }}>分析中…</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Reset view */}
            <button
              type="button"
              onClick={() => fitViewCallbackRef.current?.()}
              title="重置视图"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors"
              style={{ color: 'var(--fg-dim)', background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7"/>
                <polyline points="3 4 3 9 8 9"/>
              </svg>
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              title="收起"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors"
              style={{ color: 'var(--fg-dim)', background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}
              aria-label="关闭"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <polyline points="9 6 15 12 9 18"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Panel content */}
        <div className="min-h-0 flex-1">
          <AttentionXPanel
            topicId={topicId}
            nodes={nodes}
            goalAnchor={goalAnchor}
            planItems={planItems}
            rawEvents={rawEvents}
            llmUnavailable={llmUnavailable}
            goals={attention.goals}
            activeGoal={attention.activeGoal}
            activeGoalId={attention.activeGoalId}
            goalDraft={attention.goalDraft}
            onGoalDraftChange={attention.setGoalDraft}
            onCreateGoal={(text) => void attention.createGoal(text)}
            onSelectGoal={(goalId) => void attention.selectGoal(goalId)}
            loadingSnapshot={attention.isLoadingSnapshot}
            chrome={false}
            fitViewCallbackRef={fitViewCallbackRef}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
