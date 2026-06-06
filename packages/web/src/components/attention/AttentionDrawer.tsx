'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAttentionTrace } from '@/lib/attention'
import { AttentionXPanel } from './AttentionXPanel'

/** 宽 drawer：左窄列表 + 右 React Flow 实时图。仅在打开时挂载（hook 随之运行）。 */
export function AttentionDrawer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const attention = useAttentionTrace(topicId)
  const { nodes, goalAnchor, planItems, rawEvents, isAnalyzing, llmUnavailable } = attention

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
        className="flex h-full w-full max-w-[1180px] flex-col"
        style={{
          background: 'var(--glass-modal, rgba(20,22,27,0.86))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          borderLeft: '1px solid var(--hairline-2)',
          boxShadow: '-30px 0 80px rgba(0,0,0,.55)',
        }}
      >
        <header
          className="flex h-12 shrink-0 items-center gap-2.5 px-4"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <span style={{ fontSize: 14 }}>🧭</span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>
            注意力 X
          </span>
          {isAnalyzing && (
            <span className="text-[11px]" style={{ color: '#F7C26B' }}>
              分析中…
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:opacity-80"
            style={{ color: 'var(--fg-dim)' }}
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
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
            onCreateGoal={() => void attention.createGoal()}
            onSelectGoal={(goalId) => void attention.selectGoal(goalId)}
            loadingSnapshot={attention.isLoadingSnapshot}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
