'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

const PI_WSS_URL_KEY = 'PI_ADAPTER_WSS_URL'
const PI_TOKEN_KEY = 'PI_ADAPTER_TOKEN'

function getServerUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL
  if (wsUrl) {
    try {
      const u = new URL(wsUrl)
      return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') return window.location.origin
  return 'http://127.0.0.1:8787'
}

interface ConnectionConfigModalProps {
  initialWssUrl?: string
  initialToken?: string
  onConfirm: (config: { wssUrl: string; piToken: string }) => void
  onClose: () => void
}

export function ConnectionConfigModal({
  initialWssUrl = '',
  initialToken = '',
  onConfirm,
  onClose,
}: ConnectionConfigModalProps) {
  const [wssUrl, setWssUrl] = useState(initialWssUrl)
  const [piToken, setPiToken] = useState(initialToken)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const canSubmit = wssUrl.trim() && piToken.trim() && !testing

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const base = getServerUrl()
      const res = await fetch(
        `${base}/pi-healthz?wssUrl=${encodeURIComponent(wssUrl.trim())}&piToken=${encodeURIComponent(piToken.trim())}`,
        { signal: AbortSignal.timeout(8_000) },
      )
      const data = await res.json()
      if (!data.ok) {
        setTestResult({ ok: false, error: data.error || '连接失败' })
        return
      }

      // Server healthz passed — now probe the full WSS URL from browser
      const wsProbeOk = await new Promise<boolean>((resolve) => {
        const probeUrl = new URL(wssUrl.trim())
        if (piToken.trim()) probeUrl.searchParams.set('token', piToken.trim())
        let opened = false
        const ws = new WebSocket(probeUrl.toString())
        const timer = setTimeout(() => { ws.close(); resolve(false) }, 5_000)
        ws.addEventListener('open', () => {
          opened = true
          clearTimeout(timer)
          ws.close()
          resolve(true)
        })
        ws.addEventListener('error', () => { clearTimeout(timer); resolve(false) })
        ws.addEventListener('close', () => { clearTimeout(timer); if (!opened) resolve(false) })
      })

      if (!wsProbeOk) {
        setTestResult({ ok: false, error: 'WSS 连接失败 — 请检查地址和路径是否正确' })
        return
      }

      setTestResult({ ok: true })
      localStorage.setItem(PI_WSS_URL_KEY, wssUrl.trim())
      localStorage.setItem(PI_TOKEN_KEY, piToken.trim())
      onConfirm({ wssUrl: wssUrl.trim(), piToken: piToken.trim() })
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }, [wssUrl, piToken, onConfirm])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{
          backgroundColor: 'var(--bg-1)',
          border: '1px solid var(--hairline)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold" style={{ color: 'var(--fg-strong)' }}>
            PI Adapter 连接配置
          </h2>
          <p className="text-xs" style={{ color: 'var(--fg-dim)' }}>
            配置远程 PI Adapter 的 WebSocket 地址和鉴权 Token
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--fg-regular)' }}>
              WSS 地址
            </label>
            <input
              type="url"
              value={wssUrl}
              onChange={(e) => { setWssUrl(e.target.value); setTestResult(null) }}
              placeholder="wss://pi-adapter.example.com/api/agent-chat/v1/socket"
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--glass-1)',
                color: 'var(--fg-regular)',
                border: `1px solid ${testResult && !testResult.ok ? 'var(--state-danger)' : 'var(--stroke-inner)'}`,
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--fg-regular)' }}>
              Token
            </label>
            <input
              type="password"
              value={piToken}
              onChange={(e) => { setPiToken(e.target.value); setTestResult(null) }}
              placeholder="PI Adapter 鉴权 Token"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--glass-1)',
                color: 'var(--fg-regular)',
                border: '1px solid var(--stroke-inner)',
              }}
            />
          </div>
        </div>

        {testResult && (
          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: testResult.ok ? 'rgba(48,209,88,0.10)' : 'rgba(255,69,58,0.10)',
              color: testResult.ok ? '#6FE39A' : '#FF6B6B',
              border: `1px solid ${testResult.ok ? 'rgba(48,209,88,0.22)' : 'rgba(255,69,58,0.22)'}`,
            }}
          >
            {testResult.ok ? '连接验证成功' : `连接失败：${testResult.error}`}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px]" style={{ color: 'var(--fg-dim)' }}>ESC 取消</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-1.5 text-xs font-medium"
              style={{ color: 'var(--fg-regular)' }}
            >
              取消
            </button>
            <button
              onClick={handleTest}
              disabled={!canSubmit}
              className="rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: 'var(--role-user)' }}
            >
              {testing ? '验证中...' : '验证并保存'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export { PI_WSS_URL_KEY, PI_TOKEN_KEY }
