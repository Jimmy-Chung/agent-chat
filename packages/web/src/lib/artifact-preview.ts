import type { Artifact } from '@agent-chat/protocol'
import MarkdownIt from 'markdown-it'

export type ArtifactPreviewKind = 'pdf' | 'image' | 'markdown' | 'html' | 'text' | 'fallback'

export interface ArtifactPreviewResolution {
  kind: ArtifactPreviewKind
  reason?: 'unsupported' | 'too_large'
}

export interface TextPreviewResult {
  ok: boolean
  text?: string
  reason?: 'too_large' | 'fetch_failed'
}

export const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024
export const HTML_PREVIEW_SANDBOX = 'allow-popups'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkdn'])
const HTML_EXTENSIONS = new Set(['html', 'htm'])
const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'log',
  'json',
  'jsonl',
  'ndjson',
  'xml',
  'yaml',
  'yml',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'md',
  'markdown',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'sh',
  'bash',
  'zsh',
  'sql',
  'toml',
  'ini',
  'env',
])

export function resolveArtifactPreview(
  artifact: Pick<Artifact, 'name' | 'mime' | 'size_bytes'>,
): ArtifactPreviewResolution {
  const mime = normalizeMime(artifact.mime)
  const extension = getExtension(artifact.name)
  const textTooLarge = artifact.size_bytes != null && artifact.size_bytes > TEXT_PREVIEW_MAX_BYTES

  if (mime === 'application/pdf' || extension === 'pdf') return { kind: 'pdf' }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(extension)) {
    return { kind: 'image' }
  }
  if (mime === 'text/markdown' || MARKDOWN_EXTENSIONS.has(extension)) {
    return textTooLarge ? { kind: 'fallback', reason: 'too_large' } : { kind: 'markdown' }
  }
  if (mime === 'text/html' || HTML_EXTENSIONS.has(extension)) {
    return textTooLarge ? { kind: 'fallback', reason: 'too_large' } : { kind: 'html' }
  }
  if (isTextMime(mime) || TEXT_EXTENSIONS.has(extension)) {
    return textTooLarge ? { kind: 'fallback', reason: 'too_large' } : { kind: 'text' }
  }

  return { kind: 'fallback', reason: 'unsupported' }
}

export function renderMarkdownPreview(source: string): string {
  return getMarkdownRenderer().render(source)
}

export function buildHtmlPreviewDocument(source: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob: https: http:; media-src data: blob: https: http:; style-src \'unsafe-inline\'; font-src data: https: http:;">',
    '<base target="_blank">',
    '<style>html,body{margin:0;min-height:100%;background:#fff;color:#111;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}body{padding:24px;}img,video,canvas,svg{max-width:100%;height:auto;}pre{white-space:pre-wrap;overflow-wrap:anywhere;}</style>',
    '</head>',
    '<body>',
    source,
    '</body>',
    '</html>',
  ].join('')
}

export async function fetchTextPreview(url: string, maxBytes = TEXT_PREVIEW_MAX_BYTES): Promise<TextPreviewResult> {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    const contentLength = Number(head.headers.get('content-length') ?? 0)
    if (contentLength > maxBytes) return { ok: false, reason: 'too_large' }

    const response = await fetch(url)
    if (!response.ok) return { ok: false, reason: 'fetch_failed' }

    if (!response.body) {
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: 'too_large' }
      }
      return { ok: true, text }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, reason: 'too_large' }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  }
}

function normalizeMime(mime: string | null): string {
  return mime?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function getExtension(name: string): string {
  const cleanName = name.split(/[?#]/, 1)[0] ?? ''
  const last = cleanName.lastIndexOf('.')
  if (last < 0 || last === cleanName.length - 1) return ''
  return cleanName.slice(last + 1).toLowerCase()
}

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/ld+json'
    || mime === 'application/xml'
    || mime === 'application/javascript'
    || mime === 'application/x-javascript'
    || mime === 'application/x-ndjson'
    || mime.endsWith('+json')
    || mime.endsWith('+xml')
}

let markdownRenderer: MarkdownIt | null = null

function getMarkdownRenderer(): MarkdownIt {
  if (markdownRenderer) return markdownRenderer
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  })
  const defaultLinkOpen = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  markdownRenderer = md
  return md
}
