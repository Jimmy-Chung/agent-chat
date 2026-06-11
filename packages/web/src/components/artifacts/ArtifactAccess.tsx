'use client'

import type { Artifact } from '@agent-chat/protocol'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { getWsClient } from '@/lib/ws-client'
import {
  HTML_PREVIEW_SANDBOX,
  buildHtmlPreviewDocument,
  fetchTextPreview,
  renderMarkdownPreview,
  resolveArtifactPreview,
  type ArtifactPreviewKind,
} from '@/lib/artifact-preview'

type ArtifactAccessMode = 'preview' | 'download'

interface ArtifactReadyDetail {
  artifactId: string
  downloadUrl: string
  previewUrl?: string
}

interface ArtifactAccessErrorDetail {
  code?: string
  message?: string
  details?: { artifactId?: unknown }
}

interface PreviewRequest {
  artifact: Artifact
  kind: Exclude<ArtifactPreviewKind, 'fallback'>
  url: string
}

export function ArtifactAccessButton({ artifact, mode }: { artifact: Artifact; mode: ArtifactAccessMode }) {
  const [preview, setPreview] = useState<PreviewRequest | null>(null)
  const needsUpload = artifact.source === 'generated' && !artifact.r2_key
  const disabled = (artifact.upload_status ?? 'uploaded') === 'upload_failed' || (!artifact.r2_key && !needsUpload)

  const requestAccess = () => {
    if (disabled) return
    const url = mode === 'preview' ? artifact.preview_url ?? artifact.download_url : artifact.download_url

    if (mode === 'download') {
      openUrlWithFreshAccess(artifact, mode, url)
      return
    }

    const resolution = resolveArtifactPreview(artifact)
    if (resolution.kind === 'fallback') {
      openUrlWithFreshAccess(artifact, mode, url)
      return
    }
    const previewKind: Exclude<ArtifactPreviewKind, 'fallback'> = resolution.kind

    if (isReusableAccessUrl(url)) {
      setPreview({ artifact, kind: previewKind, url })
      return
    }

    requestFreshArtifactUrl(
      artifact,
      (detail) => {
        setPreview({
          artifact,
          kind: previewKind,
          url: detail.previewUrl ?? detail.downloadUrl,
        })
      },
      (detail) => {
        if (url) {
          openInNewTab(url)
          return
        }
        alert(describeArtifactAccessError(detail, mode))
      },
    )
  }

  return (
    <>
      <button
        onClick={requestAccess}
        disabled={disabled}
        className="rounded px-1.5 py-0.5 text-[11px]"
        style={{ background: 'var(--glass-1)', color: disabled ? 'var(--fg-dim)' : 'var(--fg-regular)', border: '1px solid var(--hairline)', opacity: disabled ? 0.55 : 1 }}
      >
        {needsUpload ? (mode === 'preview' ? '上传并预览' : '上传并下载') : (mode === 'preview' ? '预览' : '下载')}
      </button>
      {preview && typeof document !== 'undefined' && createPortal(
        <ArtifactPreviewDialog
          request={preview}
          onClose={() => setPreview(null)}
          onFallback={(targetUrl) => {
            openInNewTab(targetUrl)
            setPreview(null)
          }}
        />,
        document.body,
      )}
    </>
  )
}

function ArtifactPreviewDialog({
  request,
  onClose,
  onFallback,
}: {
  request: PreviewRequest
  onClose: () => void
  onFallback: (url: string) => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      style={{ background: 'rgba(0,0,0,0.58)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${request.artifact.name} 预览`}
        onClick={(event) => event.stopPropagation()}
        className="flex min-h-0 w-full max-w-6xl flex-col overflow-hidden"
        style={{
          height: 'min(86vh, 920px)',
          borderRadius: 18,
          background: 'rgba(20,22,27,0.94)',
          border: '1px solid var(--hairline-2)',
          boxShadow: '0 30px 90px rgba(0,0,0,.62)',
        }}
      >
        <div
          className="flex min-h-0 items-center gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hairline)', background: 'rgba(255,255,255,.03)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: 'var(--fg-strong)' }}>{request.artifact.name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--fg-dim)' }}>
              <span>{previewKindLabel(request.kind)}</span>
              {request.artifact.mime && <span>{request.artifact.mime}</span>}
              {request.artifact.size_bytes != null && <span>{formatSize(request.artifact.size_bytes)}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onFallback(request.url)}
            className="h-8 rounded-md px-3 text-xs font-medium"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-regular)' }}
          >
            新标签打开
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-lg leading-none"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-dim)' }}
            aria-label="关闭预览"
            title="关闭预览"
          >
            &times;
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto" style={{ background: 'rgba(10,11,14,.78)' }}>
          <PreviewBody request={request} onFallback={onFallback} />
        </div>
      </div>
    </div>
  )
}

function PreviewBody({ request, onFallback }: { request: PreviewRequest; onFallback: (url: string) => void }) {
  if (request.kind === 'pdf') return <PdfPreview url={request.url} onFallback={onFallback} />
  if (request.kind === 'image') return <ImagePreview artifact={request.artifact} url={request.url} />
  return <TextBackedPreview request={request} onFallback={onFallback} />
}

function PdfPreview({ url, onFallback }: { url: string; onFallback: (url: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let loadingTask: { destroy: () => Promise<void> | void } | null = null

    async function renderPdf() {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
        const task = pdfjs.getDocument({ url })
        loadingTask = task
        const pdf = await task.promise
        const container = containerRef.current
        if (!container || cancelled) return
        container.replaceChildren()

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return
          const page = await pdf.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1.25 })
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas context unavailable')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = '100%'
          canvas.style.maxWidth = `${Math.floor(viewport.width)}px`
          canvas.style.height = 'auto'
          canvas.style.borderRadius = '6px'
          canvas.style.background = '#fff'
          canvas.style.boxShadow = '0 16px 36px rgba(0,0,0,.35)'
          await page.render({ canvas, canvasContext: context, viewport }).promise
          container.appendChild(canvas)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    renderPdf()
    return () => {
      cancelled = true
      containerRef.current?.replaceChildren()
      void loadingTask?.destroy()
    }
  }, [url])

  if (error) {
    return <PreviewFallbackMessage onFallback={() => onFallback(url)} />
  }

  return (
    <div ref={containerRef} className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-3 py-5">
      <div className="py-10 text-sm" style={{ color: 'var(--fg-dim)' }}>正在加载预览...</div>
    </div>
  )
}

function ImagePreview({ artifact, url }: { artifact: Artifact; url: string }) {
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let viewer: { destroy: () => void } | null = null
    let cancelled = false

    async function attachViewer() {
      const Viewer = (await import('viewerjs')).default
      if (!imageRef.current || cancelled) return
      viewer = new Viewer(imageRef.current, {
        button: false,
        navbar: false,
        title: false,
        toolbar: {
          zoomIn: 1,
          zoomOut: 1,
          oneToOne: 1,
          reset: 1,
          rotateLeft: 1,
          rotateRight: 1,
        },
      })
    }

    attachViewer()
    return () => {
      cancelled = true
      viewer?.destroy()
    }
  }, [url])

  return (
    <div className="grid h-full min-h-[360px] place-items-center p-4">
      <img
        ref={imageRef}
        src={url}
        alt={artifact.name}
        className="max-h-full max-w-full object-contain"
        style={{ borderRadius: 8, boxShadow: '0 18px 50px rgba(0,0,0,.42)' }}
      />
    </div>
  )
}

function TextBackedPreview({ request, onFallback }: { request: PreviewRequest; onFallback: (url: string) => void }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; text: string }>({ status: 'loading', text: '' })

  useEffect(() => {
    let cancelled = false
    fetchTextPreview(request.url).then((result) => {
      if (cancelled) return
      if (!result.ok || typeof result.text !== 'string') {
        setState({ status: 'error', text: '' })
        return
      }
      setState({ status: 'ready', text: result.text })
    })
    return () => {
      cancelled = true
    }
  }, [request.url])

  if (state.status === 'loading') {
    return <div className="py-10 text-center text-sm" style={{ color: 'var(--fg-dim)' }}>正在加载预览...</div>
  }
  if (state.status === 'error') {
    return <PreviewFallbackMessage onFallback={() => onFallback(request.url)} />
  }

  if (request.kind === 'markdown') {
    return (
      <div
        className="artifact-preview-markdown mx-auto max-w-4xl px-5 py-6"
        dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(state.text) }}
      />
    )
  }
  if (request.kind === 'html') {
    return (
      <iframe
        title={`${request.artifact.name} HTML 预览`}
        sandbox={HTML_PREVIEW_SANDBOX}
        srcDoc={buildHtmlPreviewDocument(state.text)}
        className="h-full min-h-[520px] w-full border-0"
        style={{ background: '#fff' }}
      />
    )
  }
  return (
    <pre
      className="m-0 min-h-full overflow-auto p-5 text-[12px] leading-6"
      style={{ color: 'var(--fg-code)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {state.text}
    </pre>
  )
}

function PreviewFallbackMessage({ onFallback }: { onFallback: () => void }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-sm font-medium" style={{ color: 'var(--fg-strong)' }}>无法在应用内预览</div>
      <button
        type="button"
        onClick={onFallback}
        className="h-8 rounded-md px-3 text-xs font-semibold"
        style={{ background: 'rgba(10,132,255,.18)', border: '1px solid rgba(10,132,255,.38)', color: '#7CB6FF' }}
      >
        新标签打开
      </button>
    </div>
  )
}

function openUrlWithFreshAccess(artifact: Artifact, mode: ArtifactAccessMode, existingUrl: string | undefined) {
  if (isReusableAccessUrl(existingUrl)) {
    openInNewTab(existingUrl)
    return
  }

  const newWindow = window.open('about:blank', '_blank')
  requestFreshArtifactUrl(
    artifact,
    (detail) => {
      const targetUrl = mode === 'preview' ? detail.previewUrl ?? detail.downloadUrl : detail.downloadUrl
      if (newWindow && !newWindow.closed) {
        newWindow.location.href = targetUrl
      } else {
        openInNewTab(targetUrl)
      }
    },
    (detail) => {
      if (newWindow && !newWindow.closed) newWindow.close()
      alert(describeArtifactAccessError(detail, mode))
    },
  )
}

function requestFreshArtifactUrl(
  artifact: Artifact,
  onReady: (detail: ArtifactReadyDetail) => void,
  onError: (detail: ArtifactAccessErrorDetail) => void,
) {
  const cleanup = () => {
    window.removeEventListener('agent-chat:artifact-download-ready', handleReady)
    window.removeEventListener('agent-chat:error', handleError)
  }
  const handleReady = (event: Event) => {
    const detail = (event as CustomEvent).detail as ArtifactReadyDetail
    if (detail.artifactId !== artifact.id) return
    cleanup()
    onReady(detail)
  }
  const handleError = (event: Event) => {
    const detail = (event as CustomEvent).detail as ArtifactAccessErrorDetail
    if (!isArtifactAccessError(detail.code)) return
    if (typeof detail.details?.artifactId === 'string' && detail.details.artifactId !== artifact.id) return
    cleanup()
    onError(detail)
  }

  window.addEventListener('agent-chat:artifact-download-ready', handleReady)
  window.addEventListener('agent-chat:error', handleError)
  const sent = getWsClient().send({ type: 'artifact.download.init', data: { artifactId: artifact.id } })
  if (!sent) {
    cleanup()
    onError({ message: 'WebSocket 未连接' })
  }
}

function isReusableAccessUrl(url: string | undefined): url is string {
  return Boolean(url && !url.startsWith('/api/artifacts/'))
}

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function previewKindLabel(kind: Exclude<ArtifactPreviewKind, 'fallback'>): string {
  switch (kind) {
    case 'pdf':
      return 'PDF'
    case 'image':
      return '图片'
    case 'markdown':
      return 'Markdown'
    case 'html':
      return 'HTML'
    case 'text':
      return '文本'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isArtifactAccessError(code: string | undefined): boolean {
  return [
    'ARTIFACT_DOWNLOAD_UNAVAILABLE',
    'artifact_unavailable',
    'artifact_upload_failed',
    'download_unavailable',
    'upload_unavailable',
    'file_not_found',
    'file_unreadable',
    'size_exceeded',
    'artifact_forbidden',
    'topic_mismatch',
    'session_not_found',
  ].includes(code ?? '')
}

function describeArtifactAccessError(detail: { code?: string; message?: string }, mode: ArtifactAccessMode): string {
  const action = mode === 'preview' ? '预览' : '下载'
  switch (detail.code) {
    case 'file_not_found':
      return `无法${action}：adapter 侧文件不存在，可能已被移动或删除。`
    case 'file_unreadable':
      return `无法${action}：adapter 侧文件不可读。`
    case 'size_exceeded':
      return `无法${action}：文件超过上传大小限制。`
    case 'artifact_forbidden':
      return `无法${action}：产物路径不在当前会话工作目录内。`
    case 'upload_unavailable':
    case 'download_unavailable':
      return `无法${action}：产物上传/下载服务当前不可用。`
    case 'topic_mismatch':
    case 'session_not_found':
      return `无法${action}：产物关联的话题会话已失效。`
    default:
      return detail.message ? `无法${action}：${detail.message}` : `无法${action}：产物尚未上传或不可访问。`
  }
}
