'use client'

import { useEffect, useState, useCallback } from 'react'
import { getWsClient } from '@/lib/ws-client'
import { useWsStore } from '@/stores/ws-store'

const TOKEN_KEY = 'AGENT_CHAT_TOKEN'

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const status = useWsStore((s) => s.status)

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    setToken(stored)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!token) return
    const client = getWsClient()
    client.connect()
    return () => {
      client.disconnect()
    }
  }, [token])

  const handleTokenSubmit = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    const client = getWsClient()
    client.disconnect()
    setToken(null)
  }, [])

  if (!mounted) return null

  if (!token) {
    return <AuthForm onSubmit={handleTokenSubmit} />
  }

  return (
    <>
      {status === 'disconnected' && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-2 text-sm"
          style={{ backgroundColor: 'var(--role-system)', color: '#fff' }}
        >
          <span>Connection lost — wrong token?</span>
          <button
            onClick={handleLogout}
            className="rounded px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
          >
            Re-enter token
          </button>
        </div>
      )}
      {children}
    </>
  )
}

function AuthForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Please enter a token')
      return
    }
    onSubmit(trimmed)
  }

  return (
    <div
      className="flex h-dvh w-full items-center justify-center"
      style={{ backgroundColor: 'var(--bg-0)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl p-6"
        style={{
          backgroundColor: 'var(--bg-1)',
          border: '1px solid var(--divider)',
        }}
      >
        <h1
          className="text-lg font-semibold text-center"
          style={{ color: 'var(--fg-strong)' }}
        >
          agent-chat
        </h1>
        <p className="text-center text-sm" style={{ color: 'var(--fg-dim)' }}>
          Enter your access token to continue
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          placeholder="Token"
          autoFocus
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: 'var(--glass-1)',
            color: 'var(--fg-regular)',
            border: '1px solid var(--stroke-inner)',
          }}
        />
        {error && (
          <p className="text-xs" style={{ color: 'var(--role-system)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--role-user)', color: '#fff' }}
        >
          Connect
        </button>
      </form>
    </div>
  )
}
