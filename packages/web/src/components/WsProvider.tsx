'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { getWsClient, type PiConfig } from '@/lib/ws-client'
import { getServerBase, getWsUrl } from '@/lib/server-url'
import { useWsStore } from '@/stores/ws-store'
import { useToastStore } from '@/stores/toast-store'
import { ConnectionConfigModal, PI_WSS_URL_KEY, PI_TOKEN_KEY } from './ConnectionConfigModal'

interface AgentChatErrorDetail {
  code?: string
  message?: string
  details?: Record<string, unknown>
}

function describeError(detail: AgentChatErrorDetail): { tone: 'error' | 'warning'; title: string; description?: string } | null {
  if (detail.code === 'DUPLICATE_NAME') {
    return {
      tone: 'warning',
      title: '同名话题已存在',
      description: '请更换话题名称后再创建。',
    }
  }

  if (detail.code === 'DUPLICATE_CWD') {
    const topicName = typeof detail.details?.topicName === 'string' ? detail.details.topicName : null
    const topicId = typeof detail.details?.topicId === 'string' ? detail.details.topicId : null
    return {
      tone: 'warning',
      title: '已有同目录话题',
      description: topicName && topicId
        ? `${topicName} · ${topicId}`
        : topicId
          ? `Topic ID: ${topicId}`
          : '请选择其他工作目录后再创建。',
    }
  }

  if (detail.code === 'PI_SESSION_FAILED') {
    return {
      tone: 'error',
      title: '创建 Agent 会话失败',
      description: '请稍后重试，或检查 PI Adapter 连接状态。',
    }
  }

  return null
}

function ErrorToastListener() {
  const pushToast = useToastStore((s) => s.pushToast)

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<AgentChatErrorDetail>).detail ?? {}
      const toast = describeError(detail)
      if (!toast) return
      pushToast(toast)
    }

    window.addEventListener('agent-chat:error', onError)
    return () => window.removeEventListener('agent-chat:error', onError)
  }, [pushToast])

  return null
}

function DisconnectBanner({
  onReset,
}: {
  onReset: () => void
}) {
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-2 text-sm"
      style={{ backgroundColor: 'var(--role-system)', color: '#fff' }}
    >
      <span>连接已断开</span>
      <button
        onClick={onReset}
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
      >
        重新输入
      </button>
    </div>
  )
}

function resetConnection(setPiConfig: (config: PiConfig | null) => void, setStep: (step: Step) => void) {
  localStorage.removeItem(TOKEN_KEY)
  getWsClient().disconnect()
  setPiConfig(null)
  setStep('auth')
}

function MainContent({
  status,
  setPiConfig,
  setStep,
  children,
}: {
  status: string
  setPiConfig: (config: PiConfig | null) => void
  setStep: (step: Step) => void
  children: React.ReactNode
}) {
  const handleReset = useCallback(() => {
    resetConnection(setPiConfig, setStep)
  }, [setPiConfig, setStep])

  return (
    <>
      <ErrorToastListener />
      {status === 'disconnected' && <DisconnectBanner onReset={handleReset} />}
      {children}
    </>
  )
}

const TOKEN_KEY = 'AGENT_CHAT_TOKEN'
const ADAPTER_LINK_POLL_MS = 30_000

type Step = 'auth' | 'pi-config' | 'main'

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>('auth')
  const [mounted, setMounted] = useState(false)
  const [piConfig, setPiConfig] = useState<PiConfig | null>(null)
  const status = useWsStore((s) => s.status)
  const unauthorized = useWsStore((s) => s.unauthorized)
  // 扫码配对页是独立路径，不走「输 token / 配 adapter」的全局门。
  const pathname = usePathname()
  const isPairRoute = (pathname ?? '').startsWith('/pair')

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

  useEffect(() => {
    if (isPairRoute || step !== 'main' || !piConfig) return
    const client = getWsClient()
    client.connect(piConfig)
    return () => {
      client.disconnect()
    }
  }, [step, piConfig, isPairRoute])

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

  useEffect(() => {
    if (unauthorized) {
      resetConnection(setPiConfig, setStep)
    }
  }, [unauthorized])

  useEffect(() => {
    if (step !== 'main' || !piConfig || status !== 'connected') return

    let cancelled = false

    const probe = async () => {
      const params = new URLSearchParams()
      if (piConfig.wssUrl) params.set('wssUrl', piConfig.wssUrl)
      if (piConfig.piToken) params.set('piToken', piConfig.piToken)

      try {
        const res = await fetch(
          `${getServerBase()}/api/agent-chat/v1/adapter-status?${params}`,
          { signal: AbortSignal.timeout(5_000) },
        )
        const data = await res.json() as {
          reachable?: boolean
          lastError?: string
          version?: string
        }
        if (cancelled) return
        useWsStore.getState().setAdapterLink({
          reachable: typeof data.reachable === 'boolean' ? data.reachable : false,
          lastError: data.lastError,
          checkedAt: Date.now(),
          version: data.version ?? null,
        })
      } catch (err) {
        if (cancelled) return
        useWsStore.getState().setAdapterLink({
          reachable: false,
          lastError: err instanceof Error ? err.message : String(err),
          checkedAt: Date.now(),
          version: 'unreachable',
        })
      }
    }

    void probe()
    const intervalId = window.setInterval(() => { void probe() }, ADAPTER_LINK_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void probe()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [piConfig, status, step])

  const handleAuthSuccess = useCallback(() => {
    setStep('pi-config')
  }, [])

  const handlePiConfigConfirm = useCallback((config: PiConfig) => {
    setPiConfig(config)
    setStep('main')
  }, [])

  if (!mounted) return null

  // 平台 token（VerifyPlatform）—— 扫码与直接访问都要。
  if (step === 'auth') {
    return <AuthForm onSuccess={handleAuthSuccess} />
  }

  // 扫码（/pair）：平台 token 验过后进设备验证码页（VerifyDevice），跳过 pi-adapter 配置。
  if (isPairRoute) return <>{children}</>

  if (step === 'pi-config') {
    return (
      <ConnectionConfigModal
        initialWssUrl={piConfig?.wssUrl ?? ''}
        initialToken={piConfig?.piToken ?? ''}
        onConfirm={handlePiConfigConfirm}
        onClose={() => {}}
      />
    )
  }

  return (
    <MainContent status={status} setPiConfig={setPiConfig} setStep={setStep}>
      {children}
    </MainContent>
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
