import { describe, expect, it } from 'vitest'
import {
  HTML_PREVIEW_SANDBOX,
  TEXT_PREVIEW_MAX_BYTES,
  buildHtmlPreviewDocument,
  renderMarkdownPreview,
  resolveArtifactPreview,
} from '@/lib/artifact-preview'

const baseArtifact = {
  name: 'artifact.bin',
  mime: null,
  size_bytes: 1024,
}

describe('artifact preview resolution', () => {
  it('TC-AIT-244-02 resolves common previewable formats by mime and extension', () => {
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'report.pdf', mime: null }).kind).toBe('pdf')
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'image.bin', mime: 'image/png' }).kind).toBe('image')
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'notes.md', mime: null }).kind).toBe('markdown')
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'page.htm', mime: null }).kind).toBe('html')
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'data.json', mime: 'application/octet-stream' }).kind).toBe('text')
    expect(resolveArtifactPreview({ ...baseArtifact, name: 'archive.zip', mime: 'application/zip' }).kind).toBe('fallback')
  })

  it('TC-AIT-244-04 falls back for oversized text-like artifacts', () => {
    expect(resolveArtifactPreview({
      ...baseArtifact,
      name: 'huge.md',
      mime: 'text/markdown',
      size_bytes: TEXT_PREVIEW_MAX_BYTES + 1,
    })).toEqual({ kind: 'fallback', reason: 'too_large' })
  })
})

describe('artifact preview safety', () => {
  it('TC-AIT-244-03 renders markdown with raw HTML escaped', () => {
    const html = renderMarkdownPreview('# Title\n\n<script>alert(1)</script>\n\n<a href="https://example.com">link</a>')

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('TC-AIT-244-03 builds an isolated iframe document and sandbox policy', () => {
    const html = buildHtmlPreviewDocument('<h1>Hello</h1><script>alert(1)</script>')

    expect(HTML_PREVIEW_SANDBOX).not.toContain('allow-scripts')
    expect(HTML_PREVIEW_SANDBOX).not.toContain('allow-same-origin')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('<base target="_blank">')
    expect(html).toContain('<script>alert(1)</script>')
  })
})
