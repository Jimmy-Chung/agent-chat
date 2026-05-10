'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      className="flex h-dvh w-full flex-col items-center justify-center gap-4 p-8"
      style={{ backgroundColor: 'var(--bg-0)' }}
    >
      <h2 className="text-lg font-semibold" style={{ color: '#f87171' }}>
        Something went wrong
      </h2>
      <pre
        className="max-h-64 max-w-lg overflow-auto rounded-lg p-4 text-xs"
        style={{ backgroundColor: 'var(--surface-secondary)', color: 'var(--fg-regular)' }}
      >
        {error.message}
        {'\n\n'}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        className="rounded-lg px-4 py-2 text-sm font-medium"
        style={{ backgroundColor: 'var(--role-user)', color: '#fff' }}
      >
        Try again
      </button>
    </div>
  )
}
