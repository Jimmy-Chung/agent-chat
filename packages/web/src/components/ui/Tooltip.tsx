'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Variant = 'info' | 'warning' | 'error'
type Side = 'top' | 'bottom'

interface TooltipProps {
  content: ReactNode
  variant?: Variant
  side?: Side
  children: ReactNode
  delayMs?: number
  onShow?: () => void
  className?: string
}

export function Tooltip({ content, variant = 'info', side = 'top', children, delayMs = 300, onShow, className }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const calledRef = useRef(false)
  const triggerRef = useRef<HTMLSpanElement>(null)

  const enter = () => {
    timerRef.current = setTimeout(() => {
      if (onShow && !calledRef.current) {
        calledRef.current = true
        onShow()
      }
      setShow(true)
    }, delayMs)
  }
  const leave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
  }, [])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  useEffect(() => {
    if (!show || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    // Set --tx / --ty so the tip-in animation uses them for centering
    if (side === 'top') {
      setStyle({
        position: 'absolute',
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX + rect.width / 2,
        '--tx': '-50%',
        '--ty': 'calc(-100% - 8px)',
        zIndex: 9999,
      } as React.CSSProperties)
    } else {
      setStyle({
        position: 'absolute',
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX + rect.width / 2,
        '--tx': '-50%',
        '--ty': '8px',
        zIndex: 9999,
      } as React.CSSProperties)
    }
  }, [show, side])

  const tooltipEl = show && style ? createPortal(
    <span
      className={`tip ${variant} ${side}`}
      role="tooltip"
      style={style}
    >
      {content}
    </span>,
    document.body,
  ) : null

  return (
    <span
      ref={triggerRef}
      className={className}
      style={{ position: 'relative' }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {tooltipEl}
    </span>
  )
}
