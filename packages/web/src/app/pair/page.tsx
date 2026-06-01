'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  parsePairingParams,
  claimSession,
  verifyCode,
  exchangeToken,
  applyPairedConnection,
  savePairedDevice,
  detectPlatform,
  PairingError,
} from '@/lib/pairing'

type Phase = 'loading' | 'code' | 'verifying' | 'success' | 'error'

// Rough first-version UI (AIT-216 D-3). Visual polish待设计图.
function PairInner() {
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorCode, setErrorCode] = useState('')
  const [code, setCode] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const claimedRef = useRef(false)

  const pairing = parsePairingParams(params.toString())

  useEffect(() => {
    if (claimedRef.current) return
    claimedRef.current = true
    if (!pairing) { setPhase('error'); setErrorCode('invalid_link'); return }
    claimSession(pairing.session, pairing.nonce, { name: `${detectPlatform()} 设备`, platform: detectPlatform() })
      .then(() => setPhase('code'))
      .catch((e: unknown) => {
        setPhase('error')
        setErrorCode(e instanceof PairingError ? (e.status === 410 ? 'expired' : e.code) : 'claim_failed')
      })
  }, [pairing])

  const submit = useCallback(async () => {
    if (!pairing || code.trim().length < 4) return
    setPhase('verifying')
    setRemaining(null)
    try {
      const v = await verifyCode(pairing.session, code.trim())
      const accessToken = await exchangeToken(v.deviceCredential, v.adapterInstanceId)
      savePairedDevice({
        deviceId: v.pairedDevice.id,
        deviceCredential: v.deviceCredential,
        adapterInstanceId: v.adapterInstanceId,
        adapterWssUrl: v.adapterWssUrl,
        pairedAt: v.pairedDevice.pairedAt,
      })
      // Point the app at the paired adapter (JWT as ?access_token=, server connects through).
      applyPairedConnection(v.adapterWssUrl, accessToken)
      setPhase('success')
    } catch (e: unknown) {
      if (e instanceof PairingError && e.code === 'invalid_code') {
        setRemaining(e.remainingAttempts ?? null)
        setPhase('code')
      } else {
        setPhase('error')
        setErrorCode(e instanceof PairingError ? e.code : 'verify_failed')
      }
    }
  }, [pairing, code])

  const errorText: Record<string, string> = {
    invalid_link: '配对链接无效或缺少参数',
    expired: '二维码已过期，请回到电脑端刷新二维码',
    invalid_nonce: '配对校验失败，请重新扫码',
    code_expired: '验证码已过期，请回到电脑端刷新',
    too_many_attempts: '验证码尝试次数过多，请回到电脑端重新发起配对',
    claim_failed: '连接电脑失败，请确认电脑端配对界面仍打开',
    verify_failed: '验证失败，请稍后重试',
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg, #0b0d12)' }}>
      <div
        style={{
          width: 'min(420px, 100%)', borderRadius: 20, padding: 24,
          background: 'var(--glass-1, rgba(255,255,255,0.04))',
          border: '1px solid var(--hairline, rgba(255,255,255,0.1))',
          color: 'var(--fg-strong, #fff)',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>设备配对</h1>

        {phase === 'loading' && <p style={{ color: 'var(--fg-dim,#9aa)' }}>已扫描，正在连接当前电脑…</p>}

        {(phase === 'code' || phase === 'verifying') && (
          <>
            <p style={{ color: 'var(--fg-dim,#9aa)', fontSize: 13, marginBottom: 14 }}>请输入电脑屏幕上显示的验证码</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
              maxLength={8}
              autoFocus
              inputMode="text"
              placeholder="例如 AB12CD"
              disabled={phase === 'verifying'}
              style={{
                width: '100%', height: 44, borderRadius: 10, padding: '0 12px',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 18, letterSpacing: 4, textAlign: 'center',
                background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline,rgba(255,255,255,.14))', color: 'var(--fg-strong,#fff)',
              }}
            />
            {remaining !== null && (
              <p style={{ color: '#FF8B82', fontSize: 12, marginTop: 8 }}>验证码错误，还剩 {remaining} 次</p>
            )}
            <button
              onClick={() => void submit()}
              disabled={phase === 'verifying' || code.trim().length < 4}
              style={{
                marginTop: 16, width: '100%', height: 42, borderRadius: 10, fontWeight: 600,
                background: 'linear-gradient(180deg,#2090FF,#0A84FF 60%,#0064D8)', color: '#fff', border: 'none',
                opacity: phase === 'verifying' || code.trim().length < 4 ? 0.5 : 1,
              }}
            >
              {phase === 'verifying' ? '验证中…' : '验证并连接'}
            </button>
          </>
        )}

        {phase === 'success' && (
          <>
            <p style={{ color: 'var(--state-ok,#30D158)', fontSize: 14, marginBottom: 16 }}>✓ 配对成功，已绑定该电脑</p>
            <button
              onClick={() => { window.location.assign('/') }}
              style={{ width: '100%', height: 42, borderRadius: 10, fontWeight: 600, background: 'var(--glass-2,rgba(255,255,255,.08))', color: '#fff', border: '1px solid var(--hairline,rgba(255,255,255,.14))' }}
            >
              进入
            </button>
          </>
        )}

        {phase === 'error' && (
          <p style={{ color: '#FF8B82', fontSize: 14 }}>{errorText[errorCode] ?? '配对失败，请重试'}</p>
        )}
      </div>
    </div>
  )
}

export default function PairPage() {
  return (
    <Suspense fallback={null}>
      <PairInner />
    </Suspense>
  )
}
