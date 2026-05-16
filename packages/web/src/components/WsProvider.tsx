'use client'

import { useEffect, useState, useCallback } from 'react'
import { getWsClient, type PiConfig } from '@/lib/ws-client'
import { useWsStore } from '@/stores/ws-store'
import { ConnectionConfigModal, PI_WSS_URL_KEY, PI_TOKEN_KEY } from './ConnectionConfigModal'

const TOKEN_KEY = 'AGENT_CHAT_TOKEN'

type Step = 'auth' | 'pi-config' | 'main'

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>('auth')
  const [mounted, setMounted] = useState(false)
  const [piConfig, setPiConfig] = useState<PiConfig | null>(null)
  const status = useWsStore((s) => s.status)
  const unauthorized = useWsStore((s) => s.unauthorized)

  // On mount, check localStorage for existing config
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    const wssUrl = localStorage.getItem(PI_WSS_URL_KEY)
    const piToken = localStorage.getItem(PI_TOKEN_KEY)

    if (token && wssUrl != null && piToken != null) {
      setPiConfig({ wssUrl, piToken })
      setStep('main')
    } else if (token) {
      setStep('pi-config')
    } else {
      setStep('auth')
    }
    setMounted(true)
  }, [])

  // Connect WS when both token and PI config are ready
  useEffect(() => {
    if (step !== 'main' || !piConfig) return
    const client = getWsClient()
    client.connect(piConfig)
    return () => {
      client.disconnect()
    }
  }, [step, piConfig])

  // Listen for PI config changes from Sidebar modal
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PiConfig>).detail
      localStorage.setItem(PI_WSS_URL_KEY, detail.wssUrl)
      localStorage.setItem(PI_TOKEN_KEY, detail.piToken)
      setPiConfig(detail)
      const client = getWsClient()
      client.disconnect()
      client.connect(detail)
    }
    window.addEventListener('agent-chat:pi-config-changed', handler)
    return () => window.removeEventListener('agent-chat:pi-config-changed', handler)
  }, [])

  // Auto-logout when server rejects the token (close code 4401)
  useEffect(() => {
    if (unauthorized) {
      localStorage.removeItem(TOKEN_KEY)
      getWsClient().disconnect()
      setPiConfig(null)
      setStep('auth')
    }
  }, [unauthorized])

  const handleAuthSuccess = useCallback(() => {
    setStep('pi-config')
  }, [])

  const handlePiConfigConfirm = useCallback((config: PiConfig) => {
    setPiConfig(config)
    setStep('main')
  }, [])

  if (!mounted) return null

  if (step === 'auth') {
    return <AuthForm onSuccess={handleAuthSuccess} />
  }

  if (step === 'pi-config') {
    return (
      <ConnectionConfigModal
        initialWssUrl={piConfig?.wssUrl ?? ''}
        initialToken={piConfig?.piToken ?? ''}
        onConfirm={handlePiConfigConfirm}
        onClose={() => { /* cannot close without config */ }}
      />
    )
  }

  return (
    <>
      {status === 'disconnected' && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-2 text-sm"
          style={{ backgroundColor: 'var(--role-system)', color: '#fff' }}
        >
          <span>连接已断开</span>
          <button
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY)
              getWsClient().disconnect()
              setPiConfig(null)
              setStep('auth')
            }}
            className="rounded px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
          >
            重新输入
          </button>
        </div>
      )}
      {children}
    </>
  )
}

function AuthForm({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      setError('请输入 Token')
      return
    }

    setVerifying(true)
    setError('')

    try {
      const valid = await verifyToken(trimmed)
      if (valid) {
        localStorage.setItem(TOKEN_KEY, trimmed)
        onSuccess()
      } else {
        setError('Token 验证失败，请检查后重试')
      }
    } catch (err) {
      setError('无法连接服务器，请检查网络')
    } finally {
      setVerifying(false)
    }
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
          请输入 Token 以继续
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
          disabled={verifying}
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
          disabled={verifying}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: 'var(--role-user)', color: '#fff' }}
        >
          {verifying ? '验证中...' : '连接'}
        </button>
      </form>
    </div>
  )
}

function verifyToken(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wsUrl = getWsUrl()
    const url = `${wsUrl}?token=${encodeURIComponent(token)}`
    let opened = false
    const ws = new WebSocket(url)

    const timeout = setTimeout(() => {
      ws.close()
      resolve(false)
    }, 8_000)

    ws.addEventListener('open', () => {
      opened = true
      clearTimeout(timeout)
      ws.close()
      resolve(true)
    })

    ws.addEventListener('close', () => {
      clearTimeout(timeout)
      if (!opened) resolve(false)
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
    })
  })
}

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  return 'ws://127.0.0.1:8080/ws'
}
