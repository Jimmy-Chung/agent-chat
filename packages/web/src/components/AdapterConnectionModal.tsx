'use client'

import { useEffect, useMemo } from 'react'
import { PairingScanCard } from '@/components/PairingScanCard'
import { PI_TOKEN_KEY, PI_WSS_URL_KEY } from '@/components/ConnectionConfigModal'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { getWsClient, type PiConfig } from '@/lib/ws-client'
import { clearPairedDevice, loadPairedDevice, type PairedDevice } from '@/lib/pairing'
import { resolvePiBadgeState } from '@/lib/connection-status'
import type { AdapterLinkState, ConnectionStatus } from '@/stores/ws-store'

function readPiConfig(): PiConfig {
  if (typeof window === 'undefined') return { wssUrl: '', piToken: '' }
  return {
    wssUrl: localStorage.getItem(PI_WSS_URL_KEY) ?? '',
    piToken: localStorage.getItem(PI_TOKEN_KEY) ?? '',
  }
}

function readPairedDevice(): PairedDevice | null {
  if (typeof window === 'undefined') return null
  return loadPairedDevice()
}

function formatEndpoint(raw: string): string {
  if (!raw.trim()) return '未配置'
  try {
    const url = new URL(raw)
    url.searchParams.delete('access_token')
    url.searchParams.delete('token')
    return url.toString()
  } catch {
    return raw
  }
}

function getConnectionMode(config: PiConfig, paired: PairedDevice | null): string {
  if (config.piToken.trim()) return 'Debug 手动配置'
  if (paired) return '扫码配对'
  try {
    const url = new URL(config.wssUrl)
    if (url.searchParams.has('access_token')) return '扫码配对'
  } catch {
    // ignore
  }
  return config.wssUrl ? '未知' : '未配置'
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function reconnectWith(config: PiConfig): void {
  if (!config.wssUrl) {
    getWsClient().reconnectNow()
    return
  }
  window.dispatchEvent(new CustomEvent('agent-chat:pi-config-changed', { detail: config }))
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' | 'normal' }) {
  const color = tone === 'ok' ? '#6FE39A' : tone === 'danger' ? '#FF8B82' : 'var(--fg-strong)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
      <div style={{ color: 'var(--fg-dim)', fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 12, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

export function PairingRecoveryPanel({ onClose }: { onClose?: () => void }) {
  const isMobile = useIsMobile()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          borderRadius: 12,
          border: '1px solid rgba(255,159,10,0.28)',
          background: 'rgba(255,159,10,0.09)',
          color: 'var(--fg-regular)',
          padding: '12px 13px',
          fontSize: 13,
          lineHeight: 1.65,
        }}
      >
        请刷新二维码后，扫码/上传后再试。
      </div>

      {isMobile ? (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--hairline)',
            background: 'rgba(255,255,255,0.04)',
            padding: '12px 13px',
            color: 'var(--fg-dim)',
            fontSize: 12.5,
            lineHeight: 1.65,
          }}
        >
          移动端请使用系统相机扫描 PI UI 上的新二维码，完成验证码后返回 agent-chat。
        </div>
      ) : (
        <PairingScanCard onClose={onClose} />
      )}
    </div>
  )
}

export function PairingRequiredScreen() {
  return (
    <div
      className="flex h-dvh w-full items-center justify-center px-4"
      style={{ backgroundColor: 'var(--bg-0)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          backgroundColor: 'var(--bg-1)',
          border: '1px solid var(--hairline)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ color: 'var(--fg-strong)', fontSize: 18, fontWeight: 650, marginBottom: 6 }}>
            连接 PI Adapter
          </h1>
          <p style={{ color: 'var(--fg-dim)', fontSize: 13, lineHeight: 1.6 }}>
            先在 PI UI 刷新二维码，再完成设备配对。
          </p>
        </div>
        <PairingRecoveryPanel />
      </div>
    </div>
  )
}

export function AdapterConnectionModal({
  wsStatus,
  adapterLink,
  adapterVersion,
  onClose,
}: {
  wsStatus: ConnectionStatus
  adapterLink: AdapterLinkState
  adapterVersion: string | null
  onClose: () => void
}) {
  const config = useMemo(() => readPiConfig(), [])
  const paired = useMemo(() => readPairedDevice(), [])
  const badge = resolvePiBadgeState(wsStatus, adapterLink)
  const healthy = wsStatus === 'connected' && adapterLink.reachable === true
  const mode = getConnectionMode(config, paired)
  const version = adapterLink.version ?? adapterVersion ?? '—'
  const canRetry = Boolean(config.wssUrl)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const retry = () => {
    reconnectWith(config)
    onClose()
  }

  const clearPairing = () => {
    localStorage.removeItem(PI_WSS_URL_KEY)
    localStorage.removeItem(PI_TOKEN_KEY)
    clearPairedDevice()
    getWsClient().disconnect()
    window.location.reload()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(3,5,10,0.52)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[460px] flex-col overflow-hidden"
        style={{
          borderRadius: 18,
          background: 'var(--glass-modal, rgba(20,22,27,0.78))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className={badge.pulse ? 'animate-pulse' : ''}
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: healthy ? 'var(--state-ok)' : '#FFB340',
                boxShadow: healthy ? '0 0 10px var(--state-ok)' : 'none',
              }}
            />
            <h2 style={{ color: 'var(--fg-strong)', fontSize: 16, fontWeight: 650 }}>
              Agent 连接
            </h2>
          </div>
          <p style={{ color: 'var(--fg-dim)', fontSize: 12.5, marginTop: 6 }}>
            {healthy ? '当前链路正常。' : '当前链路未恢复，需要重新配对或重试当前连接。'}
          </p>
        </div>

        <div style={{ padding: 22, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <StatusRow label="状态" value={badge.label} tone={healthy ? 'ok' : 'danger'} />
            <StatusRow label="连接方式" value={mode} />
            <StatusRow label="Adapter" value={formatEndpoint(config.wssUrl)} />
            <StatusRow label="版本" value={version} />
            {paired ? (
              <>
                <StatusRow label="设备 ID" value={paired.deviceId} />
                <StatusRow label="Instance" value={paired.adapterInstanceId} />
                <StatusRow label="配对时间" value={formatTime(paired.pairedAt)} />
              </>
            ) : null}
            {!healthy && adapterLink.lastError ? (
              <StatusRow label="错误" value={adapterLink.lastError} tone="danger" />
            ) : null}
          </div>

          {!healthy ? (
            <div style={{ marginTop: 18 }}>
              <PairingRecoveryPanel onClose={onClose} />
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 18px',
            borderTop: '1px solid var(--hairline)',
          }}
        >
          {paired ? (
            <button
              type="button"
              onClick={clearPairing}
              style={{
                height: 34,
                padding: '0 11px',
                borderRadius: 9,
                border: '1px solid rgba(255,69,58,0.24)',
                background: 'rgba(255,69,58,0.08)',
                color: '#FF8B82',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              清除配对
            </button>
          ) : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={retry}
            disabled={!canRetry}
            style={{
              height: 34,
              padding: '0 12px',
              borderRadius: 9,
              border: '1px solid rgba(10,132,255,0.28)',
              background: 'rgba(10,132,255,0.14)',
              color: '#7CB6FF',
              opacity: canRetry ? 1 : 0.45,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            重试连接
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 34,
              padding: '0 12px',
              borderRadius: 9,
              border: '1px solid var(--hairline)',
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--fg-regular)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
