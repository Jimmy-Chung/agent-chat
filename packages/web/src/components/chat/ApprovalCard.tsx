'use client'

import { useState } from 'react'
import { getWsClient } from '@/lib/ws-client'

interface ApprovalCardProps {
  interactionId: string
  topicId: string
  prompt: string
  options?: string[]
  status: 'pending' | 'resolved' | 'timeout'
  response?: string
}

export function ApprovalCard({
  interactionId,
  topicId,
  prompt,
  options,
  status,
  response,
}: ApprovalCardProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const handleResolve = (choice: string) => {
    if (status !== 'pending') return
    setSelected(choice)
    const action = choice === 'Approve' ? 'approve' as const : 'reject' as const
    getWsClient().send({
      type: 'user.action',
      data: {
        topicId,
        action,
        interactionId,
      },
    })
  }

  const displayOptions = options ?? ['Approve', 'Deny']
  const isPending = status === 'pending' && !selected
  const resolvedChoice = response ?? selected

  // Collapsed state: approved or rejected
  if (!isPending && resolvedChoice) {
    const isApproved = resolvedChoice === 'Approve'
    return (
      <div
        className="my-1.5 overflow-hidden rounded-xl text-sm"
        style={{
          background: 'var(--glass-1)',
          border: '1px solid var(--hairline)',
          borderLeft: `4px solid ${isApproved ? 'var(--hairline-2)' : 'var(--state-danger)'}`,
          display: 'grid',
          gridTemplateColumns: '1fr',
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {isApproved ? (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--state-ok-soft)' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-ok)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--state-danger-soft)' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-danger)" strokeWidth="3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--fg-dim)' }}>
            {isApproved ? '已允许' : '已拒绝'} · {prompt.slice(0, 60)}{prompt.length > 60 ? '...' : ''}
          </span>
        </div>
      </div>
    )
  }

  // Pending state: full card with attention pulse
  return (
    <div
      className="attention-pulse my-1.5 overflow-hidden rounded-xl text-sm"
      style={{
        background: 'var(--glass-1)',
        border: '1px solid var(--hairline)',
        borderLeft: '4px solid var(--state-warning)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--hairline)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--state-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="text-xs font-medium" style={{ color: 'var(--state-warning)' }}>
          需要你的同意
        </span>
      </div>

      {/* Prompt */}
      <div className="px-3 py-2">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-regular)' }}>
          {prompt}
        </p>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2 px-3 pb-3">
        {isPending ? (
          displayOptions.map((option) => (
            <button
              key={option}
              onClick={() => handleResolve(option)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: option === 'Approve' ? 'var(--role-user)' : 'var(--glass-2)',
                color: option === 'Approve' ? '#ffffff' : 'var(--fg-regular)',
              }}
            >
              {option === 'Approve' ? '始终允许' : option === 'Deny' ? '拒绝' : option}
            </button>
          ))
        ) : (
          resolvedChoice && (
            <span className="rounded-md px-2 py-1 text-xs" style={{ background: 'var(--glass-2)', color: 'var(--fg-dim)' }}>
              Chose: {resolvedChoice}
            </span>
          )
        )}
      </div>
    </div>
  )
}
