'use client'

interface CronIndicatorProps {
  cronId: string
  runId: string
  firedAt: number
}

export function CronIndicator({ firedAt }: CronIndicatorProps) {
  const time = new Date(firedAt).toLocaleTimeString()

  return (
    <div
      className="my-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs"
      style={{
        backgroundColor: 'var(--role-cron)',
        color: '#1a1a1a',
        opacity: 0.85,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle
          cx="6"
          cy="6"
          r="4.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M6 3.5V6L7.8 7.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-medium">Cron triggered</span>
      <span className="opacity-70">{time}</span>
    </div>
  )
}
