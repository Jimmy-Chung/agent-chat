import { describe, it, expect } from 'vitest'
import type { AppConfig, Env } from '../config'
import { createArtifactTokenWithSecret, handleArtifactAccessRequest } from '../r2/artifact-access'

const SECRET = 'test-secret'
const config = { artifactTokenSecret: SECRET } as AppConfig

// Minimal R2 stub: enough surface for handleArtifactAccessRequest's GET path.
function mockGetEnv(body: string, contentType = 'application/octet-stream'): Env {
  return {
    R2: {
      get: async () => ({
        body,
        httpEtag: '"etag"',
        writeHttpMetadata: (headers: Headers) => {
          headers.set('content-type', contentType)
        },
      }),
    },
  } as unknown as Env
}

function mockPutEnv(capture: { key?: string; contentType?: string }): Env {
  return {
    R2: {
      put: async (key: string, _body: unknown, options?: { httpMetadata?: { contentType?: string } }) => {
        capture.key = key
        capture.contentType = options?.httpMetadata?.contentType
      },
    },
  } as unknown as Env
}

async function get(key: string, name: string, body = 'payload', contentType?: string) {
  const token = await createArtifactTokenWithSecret(SECRET, { action: 'download', key })
  const url = `http://localhost/api/artifacts/download/${encodeURIComponent(key)}?token=${token}&name=${encodeURIComponent(name)}`
  const res = await handleArtifactAccessRequest(new Request(url), mockGetEnv(body, contentType), config)
  if (!res) throw new Error('handler did not match request')
  return res
}

async function put(key: string, contentType: string) {
  const token = await createArtifactTokenWithSecret(SECRET, { action: 'upload', key, maxBytes: 1024 })
  const url = `http://localhost/api/artifacts/upload/${encodeURIComponent(key)}?token=${token}`
  const capture: { key?: string; contentType?: string } = {}
  const res = await handleArtifactAccessRequest(
    new Request(url, {
      method: 'PUT',
      headers: {
        'content-length': '7',
        'content-type': contentType,
      },
      body: 'payload',
    }),
    mockPutEnv(capture),
    config,
  )
  if (!res) throw new Error('handler did not match request')
  return { res, capture }
}

describe('artifact download content-disposition', () => {
  it('serves a non-ASCII (Chinese) filename without throwing a ByteString error', async () => {
    // Regression: a raw multi-byte filename in `content-disposition` made
    // `Headers.set` throw → 500 → both preview and download broke for any
    // Chinese-named artifact, while ASCII-named ones worked fine.
    const name = '财务报表.xlsx'
    const res = await get('topics/t/u/report.bin', name, 'hello-bytes')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello-bytes')
    const cd = res.headers.get('content-disposition')
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).toContain(encodeURIComponent(name))
  })

  it('handles emoji / mixed scripts in the filename', async () => {
    const res = await get('topics/t/u/x.zip', '日本語🎉.zip')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''")
  })

  it('keeps an ASCII filename fallback for legacy clients', async () => {
    const res = await get('topics/t/u/App.css', 'App.css')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('filename="App.css"')
  })

  it('adds UTF-8 charset for existing text artifacts on preview', async () => {
    const res = await get('topics/t/u/notes.md', 'notes.md', '# 标题', 'text/plain')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=UTF-8')
    expect(await res.text()).toBe('# 标题')
  })

  it('infers UTF-8 markdown content type when uploading an octet-stream Chinese filename', async () => {
    const key = 'topics/t/u/全量重建.md'
    const { res, capture } = await put(key, 'application/octet-stream')

    expect(res.status).toBe(204)
    expect(capture.key).toBe(key)
    expect(capture.contentType).toBe('text/markdown; charset=UTF-8')
  })
})
