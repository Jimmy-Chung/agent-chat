import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Artifact } from '@agent-chat/protocol'
import { ArtifactAccessButton } from '@/components/artifacts/ArtifactAccess'

const sendMock = vi.fn()
const openMock = vi.fn()

vi.mock('@/lib/ws-client', () => ({
  getWsClient: () => ({ send: sendMock }),
}))

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    topic_id: 'topic-1',
    origin_topic_id: 'topic-1',
    name: 'notes.md',
    mime: 'text/markdown',
    size_bytes: 64,
    r2_key: 'topics/topic-1/notes.md',
    download_url: 'https://example.com/notes.md',
    preview_url: 'https://example.com/notes.md',
    source: 'uploaded',
    upload_status: 'uploaded',
    failure_code: null,
    failure_message: null,
    created_at: 123,
    metadata_json: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sendMock.mockClear()
})

describe('ArtifactAccessButton', () => {
  it('TC-AIT-244-01 opens supported previews in an in-page dialog instead of a new tab', async () => {
    vi.stubGlobal('open', openMock)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Preview', {
      headers: { 'content-length': '9' },
    })))

    render(<ArtifactAccessButton artifact={artifact()} mode="preview" />)
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(openMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('dialog', { name: /notes\.md/ })).toBeTruthy())
    expect(await screen.findByText('Preview')).toBeTruthy()
  })

  it('TC-AIT-244-04 falls back to a new tab for unsupported preview formats', () => {
    vi.stubGlobal('open', openMock)

    render(<ArtifactAccessButton artifact={artifact({
      name: 'archive.zip',
      mime: 'application/zip',
      download_url: 'https://example.com/archive.zip',
      preview_url: 'https://example.com/archive.zip',
    })} mode="preview" />)
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(openMock).toHaveBeenCalledWith('https://example.com/archive.zip', '_blank', 'noopener,noreferrer')
  })

  it('TC-AIT-244-05 keeps download behavior as a new tab action', () => {
    vi.stubGlobal('open', openMock)

    render(<ArtifactAccessButton artifact={artifact()} mode="download" />)
    fireEvent.click(screen.getByRole('button', { name: '下载' }))

    expect(openMock).toHaveBeenCalledWith('https://example.com/notes.md', '_blank', 'noopener,noreferrer')
  })
})
