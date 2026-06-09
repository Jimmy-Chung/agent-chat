import { describe, it, expect } from 'vitest'
import type { AppConfig, Env } from '../config'
import { createArtifactTokenWithSecret, handleArtifactAccessRequest } from '../r2/artifact-access'

const SECRET = 'test-secret'
const config = { artifactTokenSecret: SECRET } as AppConfig

// Minimal R2 stub: enough surface for handleArtifactAccessRequest's GET path.
function mockEnv(body: string): Env {
  return {
    R2: {
      get: async () => ({
        body,
        httpEtag: '"etag"',
        writeHttpMetadata: (headers: Headers) => {
          headers.set('content-type', 'application/octet-stream')
        },
      }),
    },
  } as unknown as Env
}

async function get(key: string, name: string, body = 'payload') {
  const token = await createArtifactTokenWithSecret(SECRET, { action: 'download', key })
  const url = `http://localhost/api/artifacts/download/${encodeURIComponent(key)}?token=${token}&name=${encodeURIComponent(name)}`
  const res = await handleArtifactAccessRequest(new Request(url), mockEnv(body), config)
  if (!res) throw new Error('handler did not match request')
  return res
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
})
