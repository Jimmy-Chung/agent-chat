'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const MESSAGES = [
  '夜深了，早点休息吧',
  '明天还有很多事要做，先睡觉',
  '你的眼睛需要休息了',
  '熬夜伤身，早点睡',
  '再不睡，头发就要掉光了',
  '晚安，世界不会因为你睡觉而崩塌',
  '你跟手机不一样，不能边充边用',
  '凌晨了，你的肝在加班抗议',
  '床在等你，别让它失望',
  '睡吧，bug 明天还在',
  '早点睡，梦里没有 deadline',
  '月亮都困了，你还不困吗',
  '你的黑眼圈正在实时加剧中',
  '屏幕不会陪你到天亮',
  '放下鼠标，立地成佛',
  '熬夜写出来的代码，bug 翻倍',
  '现在的你，写的每一行代码都是明天的技术债',
  '睡觉是性价比最高的养生',
  '别卷了，去睡吧',
  '你的身体不是云服务，不能 996',
]

function getGmt8Now(): Date {
  const now = new Date()
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  return new Date(utc + 8 * 3600000)
}

function pickMessage(lastIndex: number): { message: string; index: number } {
  let idx: number
  do {
    idx = Math.floor(Math.random() * MESSAGES.length)
  } while (idx === lastIndex && MESSAGES.length > 1)
  return { message: MESSAGES[idx], index: idx }
}

export function SleepReminder() {
  const [visible, setVisible] = useState(false)
  const [clicksRemaining, setClicksRemaining] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [lastMessageIndex, setLastMessageIndex] = useState(-1)
  const firedRounds = useRef(new Set<number>())
  const lastDateRef = useRef<string>('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  const checkTime = useCallback(() => {
    const now = getGmt8Now()
    const dateStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`

    // New day → reset
    if (dateStr !== lastDateRef.current) {
      lastDateRef.current = dateStr
      firedRounds.current.clear()
    }

    const hour = now.getHours()
    const minute = now.getMinutes()

    // After 1 AM → force close
    if (hour >= 1) {
      setVisible(false)
      return
    }

    // Only trigger at midnight hour
    if (hour !== 0) return

    const round = Math.floor(minute / 5)
    const requiredClicks = Math.pow(2, round)

    // Already fired this round
    if (firedRounds.current.has(round)) return
    if (visible) return

    // Only fire at exact 5-min mark (0, 5, 10, 15...)
    if (minute % 5 !== 0) return

    firedRounds.current.add(round)
    const { message, index } = pickMessage(lastMessageIndex)
    setLastMessageIndex(index)
    setCurrentMessage(message)
    setClicksRemaining(requiredClicks)
    setVisible(true)
  }, [visible, lastMessageIndex])

  useEffect(() => {
    const id = setInterval(checkTime, 1000)
    return () => clearInterval(id)
  }, [checkTime])

  useEffect(() => {
    if (visible && buttonRef.current) {
      buttonRef.current.focus()
    }
  }, [visible])

  const handleClick = useCallback(() => {
    const next = clicksRemaining - 1
    if (next <= 0) {
      setVisible(false)
    } else {
      setClicksRemaining(next)
    }
  }, [clicksRemaining])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ padding: '24px' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Panel */}
      <div
        className="relative flex flex-col items-center gap-6 px-12 py-10 text-left"
        style={{
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          backdropFilter: 'blur(60px) saturate(200%)',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          maxWidth: '420px',
          width: '100%',
        }}
      >
        {/* Icon */}
        <span style={{ fontSize: '48px', lineHeight: 1 }}>🌙</span>

        {/* Message */}
        <p
          style={{
            color: 'var(--fg-strong, rgba(255,255,255,0.92))',
            fontSize: '18px',
            fontWeight: 500,
            lineHeight: 1.6,
            letterSpacing: '-0.01em',
          }}
        >
          {currentMessage}
        </p>

        {/* Click counter */}
        {clicksRemaining > 1 && (
          <p
            style={{
              color: 'var(--fg-2, rgba(255,255,255,0.55))',
              fontSize: '14px',
            }}
          >
            还需点击 {clicksRemaining} 次
          </p>
        )}

        {/* Confirm button */}
        <button
          ref={buttonRef}
          onClick={handleClick}
          style={{
            alignSelf: 'flex-end',
            padding: '10px 28px',
            borderRadius: 'var(--r-btn, 12px)',
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--fg-strong, rgba(255,255,255,0.92))',
            fontSize: '15px',
            fontWeight: 500,
            border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
            cursor: 'pointer',
            transition: 'background 150ms ease, transform 80ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.16)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.96)'
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          确认
        </button>
      </div>
    </div>
  )
}
