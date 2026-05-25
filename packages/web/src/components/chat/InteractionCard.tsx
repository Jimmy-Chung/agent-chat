'use client'

import { useState, useCallback, useEffect } from 'react'
import { getWsClient } from '@/lib/ws-client'

export interface InteractionCardProps {
  interactionId: string
  topicId: string
  interactionKind: 'approval' | 'choice'
  prompt: string
  options?: string[]
  status: 'pending' | 'resolved' | 'timeout'
  response?: string
  defaultTimeoutMs?: number
}

export function InteractionCard({
  interactionId,
  topicId,
  interactionKind,
  prompt,
  options,
  status,
  response,
  defaultTimeoutMs,
}: InteractionCardProps) {
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [resolved, setResolved] = useState(status === 'resolved')
  const [resolvedChoice, setResolvedChoice] = useState<string | null>(response ?? null)

  // Countdown for defaultTimeoutMs
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (status !== 'pending' || !defaultTimeoutMs) return
    const start = Date.now()
    setRemaining(Math.ceil(defaultTimeoutMs / 1000))
    const iv = setInterval(() => {
      const left = Math.ceil((defaultTimeoutMs - (Date.now() - start)) / 1000)
      if (left <= 0) { clearInterval(iv); setRemaining(0); return }
      setRemaining(left)
    }, 1000)
    return () => clearInterval(iv)
  }, [status, defaultTimeoutMs])

  const isChoice = interactionKind === 'choice'
  const isPending = status === 'pending' && !resolved

  // Options may arrive as "label — description" — only send label back to adapter
  function parseLabel(opt: string): string {
    const sep = opt.indexOf(' — ')
    return sep >= 0 ? opt.slice(0, sep) : opt
  }
  function parseDesc(opt: string): string | undefined {
    const sep = opt.indexOf(' — ')
    return sep >= 0 ? opt.slice(sep + 3) : undefined
  }

  // Keyboard navigation for choice mode
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isPending || !isChoice) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((i) => Math.min((options?.length ?? 0) - 1, i + 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options?.[focusedIdx]
      if (opt) handleChoose(opt)
    } else if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1
      const opt = options?.[idx]
      if (opt) handleChoose(opt)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, isChoice, options, focusedIdx, topicId, interactionId])

  function handleChoose(choice: string) {
    if (!isPending) return
    const label = parseLabel(choice)
    setResolved(true)
    setResolvedChoice(label)
    getWsClient().send({
      type: 'user.action',
      data: { topicId, action: 'choose', interactionId, choice: label },
    })
  }

  function handleApprove() {
    if (!isPending) return
    setResolved(true)
    setResolvedChoice('Approve')
    getWsClient().send({
      type: 'user.action',
      data: { topicId, action: 'approve', interactionId },
    })
  }

  function handleReject() {
    if (!isPending) return
    setResolved(true)
    setResolvedChoice('Reject')
    getWsClient().send({
      type: 'user.action',
      data: { topicId, action: 'reject', interactionId },
    })
  }

  // ───── Choice mode ─────

  if (isChoice) {
    // Collapsed: resolved
    if (!isPending && resolvedChoice) {
      return (
        <div style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--hairline)',
          borderLeft: '4px solid var(--state-ok)',
          borderRadius: '14px',
          overflow: 'hidden',
          margin: '6px 0',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto auto',
            gap: '10px',
            alignItems: 'center',
            padding: '12px 18px 12px 22px',
            fontSize: '13px',
            color: 'var(--fg-regular)',
            minHeight: '48px',
          }}>
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              background: 'rgba(48,209,88,.18)', color: 'var(--state-ok)',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-0.005em' }}>已选择</span>
              <span style={{ color: 'var(--fg-muted)' }}>·</span>
              <span style={{ fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-0.005em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolvedChoice}</span>
              <span style={{ color: 'var(--fg-muted)' }}>·</span>
              <span style={{ color: 'var(--fg-dim)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt}</span>
            </div>
          </div>
        </div>
      )
    }

    // Collapsed: timeout
    if (status === 'timeout' && !resolved) {
      return (
        <div style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--hairline)',
          borderLeft: '4px solid rgba(255,255,255,.16)',
          borderRadius: '14px',
          overflow: 'hidden',
          margin: '6px 0',
          opacity: 0.92,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto auto',
            gap: '10px',
            alignItems: 'center',
            padding: '12px 18px 12px 22px',
            fontSize: '13px',
            color: 'var(--fg-regular)',
            minHeight: '48px',
          }}>
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              background: 'var(--glass-1)', color: 'var(--state-paused)',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--fg-regular)', letterSpacing: '-0.005em' }}>已超时</span>
              <span style={{ color: 'var(--fg-muted)' }}>·</span>
              <span style={{ fontWeight: 500, color: 'var(--fg-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>未做选择</span>
              <span style={{ color: 'var(--fg-muted)' }}>·</span>
              <span style={{ color: 'var(--fg-muted)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt}</span>
            </div>
          </div>
        </div>
      )
    }

    // Pending: full choice card
    return (
      <div
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="interaction-choice-pulse"
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.075)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid rgba(142,140,255,.18)',
          borderLeft: '4px solid var(--role-system)',
          borderRadius: '14px',
          overflow: 'hidden',
          margin: '6px 0',
          outline: 'none',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 18px 50px rgba(0,0,0,.45), 0 0 32px rgba(142,140,255,.14)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px 8px 22px' }}>
          <span style={{ width: '22px', height: '22px', display: 'grid', placeItems: 'center', color: 'var(--role-system)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12" /><circle cx="6" cy="3" r="1.6" fill="currentColor" /><path d="M6 15a3 3 0 0 0 3 3h2" /><path d="M14 8h0a3 3 0 0 1 3 3v7" /><circle cx="17" cy="20" r="1.6" fill="currentColor" /></svg>
          </span>
          <span style={{ fontSize: '13.5px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--role-system)' }}>请选择</span>
          <span className="interaction-pulse-dot" style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--role-system)', boxShadow: '0 0 10px var(--role-system)', marginLeft: '2px' }} />
          {remaining != null && remaining > 0 && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', border: '1.5px solid rgba(142,140,255,.30)', borderTopColor: 'var(--role-system)', animation: 'interaction-spin 2s linear infinite', display: 'inline-block' }} />
              {remaining}s
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '0 22px 14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '14.5px', color: 'var(--fg-strong)', letterSpacing: '-0.005em', lineHeight: 1.5 }}>
            {prompt}
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(options ?? []).map((opt, i) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleChoose(opt)}
                onMouseEnter={() => setFocusedIdx(i)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  gap: '11px',
                  alignItems: 'center',
                  padding: '11px 14px',
                  borderRadius: '10px',
                  border: `1px solid ${i === focusedIdx ? 'rgba(142,140,255,.45)' : 'var(--hairline)'}`,
                  background: i === focusedIdx ? 'rgba(142,140,255,.10)' : 'rgba(0,0,0,.22)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
                  ...(i === focusedIdx ? { boxShadow: 'inset 0 0 0 1px rgba(142,140,255,.20), 0 0 22px rgba(142,140,255,.18)' } : {}),
                }}
              >
                {/* Radio marker */}
                <span style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  border: `1.5px solid ${i === focusedIdx ? 'var(--role-system)' : 'rgba(255,255,255,.22)'}`,
                  display: 'grid', placeItems: 'center',
                  background: i === focusedIdx ? 'rgba(142,140,255,.18)' : 'rgba(0,0,0,.18)',
                  position: 'relative',
                }}>
                  {i === focusedIdx && (
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--role-system)', boxShadow: '0 0 6px var(--role-system)' }} />
                  )}
                </span>
                {/* Option text */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-0.005em' }}>
                    {parseLabel(opt)}
                  </span>
                  {parseDesc(opt) && (
                    <span style={{ fontSize: '12px', color: 'var(--fg-dim)', fontWeight: 400, lineHeight: 1.4 }}>
                      {parseDesc(opt)}
                    </span>
                  )}
                </span>
                {/* Key hint */}
                <span style={{
                  fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,Menlo,monospace',
                  fontSize: '10.5px',
                  background: 'var(--glass-1)',
                  border: '1px solid var(--hairline)',
                  padding: '1px 6px',
                  borderRadius: '5px',
                  color: 'var(--fg-regular)',
                }}>
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '11px 18px 13px 22px',
          borderTop: '1px solid var(--hairline)',
          fontSize: '11.5px', color: 'var(--fg-dim)',
          fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,Menlo,monospace',
        }}>
          <span>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: '5px', fontFamily: 'inherit', fontSize: '10px', color: 'var(--fg-regular)' }}>↑</kbd>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: '5px', fontFamily: 'inherit', fontSize: '10px', color: 'var(--fg-regular)' }}>↓</kbd> 移动
          </span>
          <span>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: '5px', fontFamily: 'inherit', fontSize: '10px', color: 'var(--fg-regular)' }}>↵</kbd> 选择
          </span>
          {(options?.length ?? 0) <= 9 && (
            <span>
              <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: '5px', fontFamily: 'inherit', fontSize: '10px', color: 'var(--fg-regular)' }}>1</kbd>
              –
              <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', padding: '1px 5px', borderRadius: '5px', fontFamily: 'inherit', fontSize: '10px', color: 'var(--fg-regular)' }}>{Math.min(options?.length ?? 0, 9)}</kbd> 直接选
            </span>
          )}
        </div>
      </div>
    )
  }

  // ───── Approval mode (existing behavior) ─────

  // Collapsed: approved or rejected
  if (!isPending && resolvedChoice) {
    const isApproved = resolvedChoice === 'Approve'
    return (
      <div style={{
        position: 'relative',
        background: 'var(--glass-1)',
        border: '1px solid var(--hairline)',
        borderLeft: `4px solid ${isApproved ? 'var(--hairline-2)' : 'var(--state-danger)'}`,
        borderRadius: '14px',
        overflow: 'hidden',
        margin: '6px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px 10px 22px' }}>
          {isApproved ? (
            <span style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--state-ok-soft)' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-ok)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
          ) : (
            <span style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--state-danger-soft)' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--state-danger)" strokeWidth="3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
            </span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--fg-dim)' }}>
            {isApproved ? '已允许' : '已拒绝'} · {prompt.slice(0, 60)}{prompt.length > 60 ? '...' : ''}
          </span>
        </div>
      </div>
    )
  }

  // Pending: approval card
  return (
    <div
      className="attention-pulse"
      style={{
        position: 'relative',
        background: 'var(--glass-1)',
        border: '1px solid var(--hairline)',
        borderLeft: '4px solid var(--state-warning)',
        borderRadius: '14px',
        overflow: 'hidden',
        margin: '6px 0',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px 8px 22px', borderBottom: '1px solid var(--hairline)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--state-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--state-warning)' }}>
          需要你的同意
        </span>
      </div>

      {/* Prompt */}
      <div style={{ padding: '10px 18px 10px 22px' }}>
        <p style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--fg-regular)', margin: 0 }}>
          {prompt}
        </p>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 18px 14px 22px' }}>
        <button
          type="button"
          onClick={handleReject}
          style={{
            height: '30px', padding: '0 13px', borderRadius: '9px',
            fontSize: '12.5px', fontWeight: 600, letterSpacing: '-0.005em',
            display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
            background: 'transparent', color: 'var(--fg-dim)', border: '1px solid transparent',
            fontFamily: 'inherit',
          }}
        >
          拒绝
        </button>
        <button
          type="button"
          onClick={handleApprove}
          style={{
            height: '30px', padding: '0 13px', borderRadius: '9px',
            fontSize: '12.5px', fontWeight: 600, letterSpacing: '-0.005em',
            display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
            background: 'linear-gradient(180deg, #2090FF 0%, #0A84FF 50%, #0064D8 100%)',
            color: '#fff',
            border: '1px solid transparent',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.20), inset 0 -1px 0 rgba(0,0,0,.15), 0 4px 14px rgba(10,132,255,.40)',
            fontFamily: 'inherit',
          }}
        >
          始终允许
        </button>
      </div>
    </div>
  )
}
