import {
  buildPastedName,
  extractImageFiles,
  mimeToExt,
} from '@/lib/paste-image'
import { useArtifactStore } from '@/stores/artifact-store'
import type { Artifact } from '@agent-chat/protocol'
import { describe, expect, it } from 'vitest'

// Minimal clipboard item stub matching the shape extractImageFiles consumes.
function imageItem(file: File | null, type = file?.type ?? 'image/png') {
  return { kind: 'file', type, getAsFile: () => file }
}
function textItem(value = 'hello') {
  return {
    kind: 'string',
    type: 'text/plain',
    getAsFile: () => null,
    _value: value,
  }
}

describe('mimeToExt', () => {
  it('maps known image mimes', () => {
    expect(mimeToExt('image/png')).toBe('png')
    expect(mimeToExt('image/jpeg')).toBe('jpg')
    expect(mimeToExt('image/webp')).toBe('webp')
    expect(mimeToExt('image/gif')).toBe('gif')
    expect(mimeToExt('image/svg+xml')).toBe('svg')
  })
  it('is case-insensitive and falls back to png', () => {
    expect(mimeToExt('IMAGE/PNG')).toBe('png')
    expect(mimeToExt('application/octet-stream')).toBe('png')
    expect(mimeToExt('')).toBe('png')
  })
})

describe('buildPastedName', () => {
  it('formats a timestamped, unique name with mime-derived ext', () => {
    const ts = new Date(2026, 5, 8, 13, 1, 45).getTime() // 2026-06-08 13:01:45 local
    expect(buildPastedName('image/png', ts, 'a1b2c3')).toBe(
      'pasted-20260608-130145-a1b2c3.png',
    )
    expect(buildPastedName('image/jpeg', ts, 'zzz999')).toBe(
      'pasted-20260608-130145-zzz999.jpg',
    )
  })
  it('zero-pads month/day/time components', () => {
    const ts = new Date(2026, 0, 3, 4, 5, 6).getTime() // 2026-01-03 04:05:06
    expect(buildPastedName('image/png', ts, 'x')).toBe(
      'pasted-20260103-040506-x.png',
    )
  })
  it('produces distinct names across calls (random suffix)', () => {
    const a = buildPastedName('image/png')
    const b = buildPastedName('image/png')
    expect(a).not.toBe(b)
  })
})

describe('extractImageFiles', () => {
  it('extracts image files from clipboard items', () => {
    const png = new File([new Uint8Array([1, 2, 3])], 'image.png', {
      type: 'image/png',
    })
    const data = { items: [imageItem(png)] as unknown as DataTransferItemList }
    const out = extractImageFiles(data)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/png')
  })

  it('ignores non-image and string items', () => {
    const txt = textItem()
    const data = { items: [txt] as unknown as DataTransferItemList }
    expect(extractImageFiles(data)).toHaveLength(0)
  })

  it('returns empty for plain-text paste (no image present)', () => {
    const data = {
      items: [textItem('just some text')] as unknown as DataTransferItemList,
    }
    expect(extractImageFiles(data)).toEqual([])
  })

  it('falls back to files when no image items', () => {
    const jpg = new File([new Uint8Array([9])], 'photo.jpg', {
      type: 'image/jpeg',
    })
    const data = { files: [jpg] as unknown as FileList }
    const out = extractImageFiles(data)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/jpeg')
  })

  it('prefers items over files when both present', () => {
    const fromItem = new File([new Uint8Array([1])], 'a.png', {
      type: 'image/png',
    })
    const fromFiles = new File([new Uint8Array([2])], 'b.jpg', {
      type: 'image/jpeg',
    })
    const data = {
      items: [imageItem(fromItem)] as unknown as DataTransferItemList,
      files: [fromFiles] as unknown as FileList,
    }
    const out = extractImageFiles(data)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/png')
  })

  it('returns empty for null/undefined clipboard', () => {
    expect(extractImageFiles(null)).toEqual([])
    expect(extractImageFiles(undefined)).toEqual([])
  })
})

// TC-235-02: the auto-reference correlation mechanism — after upload completes,
// the artifact arrives in the store via artifact.added; a subscriber keyed on
// the (unique) uploaded name resolves so the composer can @-reference it.
describe('artifact-store name correlation (auto-reference)', () => {
  function waitForArtifactByName(
    topicId: string,
    name: string,
    timeoutMs = 200,
  ) {
    return new Promise<Artifact | null>((resolve) => {
      const find = () =>
        useArtifactStore
          .getState()
          .byTopic[topicId]?.find((a) => a.name === name)
      const existing = find()
      if (existing) return resolve(existing)
      const timer = setTimeout(() => {
        unsub()
        resolve(null)
      }, timeoutMs)
      const unsub = useArtifactStore.subscribe((state) => {
        const found = state.byTopic[topicId]?.find((a) => a.name === name)
        if (found) {
          clearTimeout(timer)
          unsub()
          resolve(found)
        }
      })
    })
  }

  function makeArtifact(id: string, topicId: string, name: string): Artifact {
    return {
      id,
      topic_id: topicId,
      name,
      mime: 'image/png',
      size_bytes: 3,
      source: 'uploaded',
      upload_status: 'uploaded',
      created_at: Date.now(),
    } as Artifact
  }

  it('resolves with the artifact once it lands in the store by name', async () => {
    useArtifactStore.setState({ byTopic: {}, poolArtifacts: [] })
    const topicId = 't1'
    const name = 'pasted-20260608-130145-abc123.png'
    const promise = waitForArtifactByName(topicId, name)
    // Simulate artifact.added arriving asynchronously.
    setTimeout(
      () =>
        useArtifactStore
          .getState()
          .addArtifact(makeArtifact('art-1', topicId, name)),
      10,
    )
    const found = await promise
    expect(found?.id).toBe('art-1')
    expect(found?.name).toBe(name)
  })

  it('resolves immediately if the artifact already exists', async () => {
    useArtifactStore.setState({ byTopic: {}, poolArtifacts: [] })
    const topicId = 't2'
    const name = 'pasted-x.png'
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact('art-2', topicId, name))
    const found = await waitForArtifactByName(topicId, name)
    expect(found?.id).toBe('art-2')
  })

  it('resolves null on timeout when no matching artifact arrives', async () => {
    useArtifactStore.setState({ byTopic: {}, poolArtifacts: [] })
    const found = await waitForArtifactByName('t3', 'never-arrives.png', 50)
    expect(found).toBeNull()
  })
})
