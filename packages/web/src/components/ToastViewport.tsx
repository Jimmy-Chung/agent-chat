'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToastStore, type ToastItem, type ToastTone } from '@/stores/toast-store'

const AUTO_DISMISS_MS: Record<Exclude<ToastTone, 'error'>, number> = {
  info: 4600,
  warning: 4600,
  success: 4600,
}

const TONE_STYLES: Record<ToastTone, {
  accent: string
  border: string
  iconBg: string
  iconColor: string
  progress: string
}> = {
  info: {
    accent: 'linear-gradient(180deg, rgba(10,132,255,1), rgba(90,200,250,.95))',
    border: 'rgba(10,132,255,.34)',
    iconBg: 'rgba(10,132,255,.16)',
    iconColor: '#71B7FF',
    progress: 'linear-gradient(90deg, #0A84FF, #5AC8FA)',
  },
  warning: {
    accent: 'linear-gradient(180deg, rgba(255,159,10,1), rgba(255,214,10,.95))',
    border: 'rgba(255,159,10,.34)',
    iconBg: 'rgba(255,159,10,.16)',
    iconColor: '#FFC266',
    progress: 'linear-gradient(90deg, #FF9F0A, #FFD60A)',
  },
  error: {
    accent: 'linear-gradient(180deg, rgba(255,69,58,1), rgba(255,55,95,.95))',
    border: 'rgba(255,69,58,.34)',
    iconBg: 'rgba(255,69,58,.16)',
    iconColor: '#FF8B82',
    progress: 'linear-gradient(90deg, #FF453A, #FF375F)',
  },
  success: {
    accent: 'linear-gradient(180deg, rgba(48,209,88,1), rgba(100,210,255,.92))',
    border: 'rgba(48,209,88,.34)',
    iconBg: 'rgba(48,209,88,.16)',
    iconColor: '#73E39C',
    progress: 'linear-gradient(90deg, #30D158, #64D2FF)',
  },
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismissToast = useToastStore((s) => s.dismissToast)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(calc(100vw-24px),380px)] flex-col-reverse gap-2 sm:bottom-5 sm:right-5"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={() => dismissToast(toast.id)} />
      ))}
    </div>,
    document.body,
  )
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const styles = TONE_STYLES[toast.tone]
  const durationMs = toast.tone === 'error' ? undefined : (toast.durationMs ?? AUTO_DISMISS_MS[toast.tone])

  useEffect(() => {
    if (!durationMs) return
    const timer = window.setTimeout(onClose, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, onClose])

  return (
    <div
      className="pointer-events-auto relative overflow-hidden"
      style={{
        borderRadius: 14,
        background: 'rgba(21, 23, 28, 0.82)',
        border: `1px solid ${styles.border}`,
        WebkitBackdropFilter: 'blur(40px) saturate(200%)',
        backdropFilter: 'blur(40px) saturate(200%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 10px 30px rgba(0,0,0,.5)',
        animation: 'toast-enter 360ms cubic-bezier(.22,1.2,.36,1)',
      }}
    >
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: styles.accent }}
      />

      <div
        className="grid items-start"
        style={{
          gridTemplateColumns: '28px minmax(0, 1fr) auto',
          columnGap: 11,
          padding: '11px 12px 12px 14px',
        }}
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-[9px]"
          style={{
            background: styles.iconBg,
            color: styles.iconColor,
            border: `1px solid ${styles.border}`,
            boxShadow: `0 0 16px ${styles.border}`,
          }}
        >
          <ToastIcon tone={toast.tone} />
        </span>

        <div className="min-w-0 pt-0.5">
          <div className="text-[13.5px] font-semibold leading-5" style={{ color: 'var(--fg-strong)' }}>
            {toast.title}
          </div>
          {toast.description ? (
            <div className="mt-0.5 text-[12.5px] leading-5" style={{ color: 'rgba(235,239,245,.72)' }}>
              {toast.description}
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-2">
          {toast.action ? (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="inline-flex h-6 items-center rounded-[7px] px-2.5 text-[12px] font-medium transition-opacity hover:opacity-90"
              style={{
                background: 'rgba(255,255,255,.06)',
                border: '1px solid rgba(255,255,255,.10)',
                color: 'var(--fg-strong)',
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          {toast.dismissible !== false ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭通知"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'rgba(235,239,245,.6)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {durationMs ? (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px]"
          style={{
            width: '100%',
            background: styles.progress,
            transformOrigin: 'left center',
            animation: `toast-progress ${durationMs}ms linear forwards`,
          }}
        />
      ) : null}
    </div>
  )
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'error') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    )
  }
  if (tone === 'warning') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}
