'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parsePairingUrl } from '@/lib/pairing'
import { decodeQrImage } from '@/lib/qr-decode'

// QR/link entry (AIT-216 D-1): capture/upload a QR image (decoded client-side)
// or paste the pairing link, then jump into the shared /pair flow.
export function PairingScanCard({
  onClose,
  showCameraOption = false,
}: {
  onClose?: () => void
  showCameraOption?: boolean
}) {
  const router = useRouter()
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const go = (raw: string) => {
    const p = parsePairingUrl(raw)
    if (!p) { setError('未识别到有效配对二维码/链接'); return }
    const qs = new URLSearchParams({ session: p.session, nonce: p.nonce, ws: p.ws })
    onClose?.()
    router.push(`/pair?${qs.toString()}`)
  }

  const onFile = async (file: File) => {
    setError('')
    setBusy(true)
    try {
      const decoded = await decodeQrImage(file)
      if (!decoded) { setError('图片中未识别到二维码'); return }
      go(decoded)
    } catch {
      setError('二维码解码失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showCameraOption && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) void onFile(f) }}
        />
      )}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) void onFile(f) }}
      />
      {showCameraOption && (
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          style={{
            height: 40, borderRadius: 10, fontWeight: 600,
            background: 'rgba(10,132,255,.16)', color: '#7CB6FF',
            border: '1px solid rgba(10,132,255,.3)', cursor: 'pointer',
          }}
        >
          {busy ? '识别中…' : '拍照识别二维码'}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => uploadRef.current?.click()}
        style={{
          height: 40, borderRadius: 10, fontWeight: 600,
          background: 'var(--glass-2, rgba(255,255,255,.08))', color: 'var(--fg-strong,#fff)',
          border: '1px dashed var(--hairline-2, rgba(255,255,255,.18))', cursor: 'pointer',
        }}
      >
        {busy ? '识别中…' : '上传二维码图片'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-dim,#9aa)', fontSize: 11 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--hairline,rgba(255,255,255,.1))' }} />
        或粘贴配对链接
        <span style={{ flex: 1, height: 1, background: 'var(--hairline,rgba(255,255,255,.1))' }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="粘贴 https://…/pair?session=…"
          style={{
            flex: 1, height: 38, borderRadius: 8, padding: '0 10px', fontSize: 12,
            background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline,rgba(255,255,255,.14))', color: 'var(--fg-strong,#fff)',
          }}
        />
        <button
          type="button"
          onClick={() => go(pasted)}
          disabled={!pasted.trim()}
          style={{ height: 38, padding: '0 14px', borderRadius: 8, fontWeight: 600, background: 'rgba(10,132,255,.16)', color: '#6cb1ff', border: '1px solid rgba(10,132,255,.3)' }}
        >
          配对
        </button>
      </div>

      {error && <p style={{ color: '#FF8B82', fontSize: 12 }}>{error}</p>}
    </div>
  )
}
