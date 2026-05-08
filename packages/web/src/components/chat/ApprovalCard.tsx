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

  return (
    <div
      className="my-1.5 rounded-xl overflow-hidden text-sm"
      style={{
        backgroundColor: 'var(--glass-1)',
        border: '1px solid var(--stroke-inner)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--stroke-inner)' }}
      >
        <StatusDot status={status} resolved={!!resolvedChoice} />
        <span className="text-xs font-medium" style={{ color: 'var(--fg-dim)' }}>
          {isPending ? 'Action Required' : status === 'timeout' ? 'Timed Out' : 'Resolved'}
        </span>
      </div>

      {/* Prompt */}
      <div className="px-3 py-2">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-regular)' }}>
          {prompt}
        </p>
      </div>

      {/* Buttons */}
      <div
        className="flex items-center gap-2 px-3 pb-3"
      >
        {isPending ? (
          displayOptions.map((option) => (
            <button
              key={option}
              onClick={() => handleResolve(option)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor:
                  option === 'Approve'
                    ? 'var(--role-user)'
                    : 'var(--glass-2)',
                color:
                  option === 'Approve'
                    ? '#ffffff'
                    : 'var(--fg-regular)',
              }}
            >
              {option}
            </button>
          ))
        ) : (
          resolvedChoice && (
            <span
              className="rounded-md px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--glass-2)',
                color: 'var(--fg-dim)',
              }}
            >
              Chose: {resolvedChoice}
            </span>
          )
        )}
      </div>
    </div>
  )
}

function StatusDot({ status, resolved }: { status: string; resolved: boolean }) {
  if (status === 'timeout') {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: 'var(--state-warning)' }}
      />
    )
  }
  if (resolved || status === 'resolved') {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: '#34c759' }}
      />
    )
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full animate-pulse"
      style={{ backgroundColor: 'var(--state-warning)' }}
    />
  )
}
