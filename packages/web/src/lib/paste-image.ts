// Helpers for pasting images into the composer: extract image files from a
// clipboard payload and synthesize a stable, unique artifact name for them.
// Kept framework-free so they can be unit tested without a DOM clipboard.

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

export function mimeToExt(mime: string): string {
  return MIME_EXT[(mime || '').toLowerCase()] ?? 'png'
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Build a unique filename for a pasted image, e.g.
 * `pasted-20260608-130145-a1b2c3.png`. The timestamp + random suffix make it
 * unique enough to correlate the eventual `artifact.added` event back to this
 * upload by name.
 */
export function buildPastedName(
  mime: string,
  now: number = Date.now(),
  rand: string = Math.random().toString(36).slice(2, 8),
): string {
  const d = new Date(now)
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `pasted-${stamp}-${rand}.${mimeToExt(mime)}`
}

interface ClipboardItemLike {
  kind: string
  type: string
  getAsFile(): File | null
}

interface ClipboardLike {
  items?: ArrayLike<ClipboardItemLike> | null
  files?: ArrayLike<File> | null
}

/**
 * Pull image File objects out of a clipboard payload. Prefers `items` (covers
 * screenshot / inline-image paste), falling back to `files`. Returns the raw
 * files as-is — callers rename pasted images via {@link buildPastedName}.
 */
export function extractImageFiles(
  data: ClipboardLike | null | undefined,
): File[] {
  if (!data) return []
  const out: File[] = []

  const items = data.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it && it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
  }

  if (out.length === 0 && data.files) {
    const files = data.files
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f && f.type.startsWith('image/')) out.push(f)
    }
  }

  return out
}
