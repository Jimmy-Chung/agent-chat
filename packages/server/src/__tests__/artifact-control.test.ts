import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import * as topicRepo from '../db/repos/topic.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import {
  completeArtifactUpload,
  failArtifactUpload,
  initArtifactDownload,
  requestArtifactUpload,
  type PendingUploadStore,
} from '../ws/artifact-control'

const config = {
  token: 'test-token',
  piAdapterUrl: '',
  piAdapterToken: '',
  artifactTokenSecret: 'secret',
  logLevel: 'info',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', publicUrl: '' },
  vapidPublicKey: '',
  vapidPrivateKey: '',
  vapidSubject: '',
}

function makeContext(pendingUploads: PendingUploadStore) {
  return {
    env: { R2: {} } as any,
    config,
    baseUrl: 'https://agent-chat.test',
    pendingUploads,
  }
}

describe('artifact control plane', () => {
  let pendingUploads: PendingUploadStore

  beforeEach(async () => {
    await setupTestDb()
    pendingUploads = new Map()
  })

  afterEach(() => {
    teardownTestDb()
  })

  it('creates Adapter upload request result without file body', async () => {
    const topic = await topicRepo.createTopic({ name: 'Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'session-1' })

    const result = await requestArtifactUpload(makeContext(pendingUploads), {
      sessionId: 'session-1',
      name: 'report.md',
      mime: 'text/markdown',
      sizeBytes: 128,
    })

    expect(result.artifactId).toEqual(expect.any(String))
    expect(result.uploadId).toEqual(expect.any(String))
    expect(result.uploadUrl).toContain('/api/artifacts/upload/')
    expect(result.method).toBe('PUT')
    expect(result.maxBytes).toBe(20 * 1024 * 1024)
    expect(result.headers).toEqual({ 'content-type': 'text/markdown' })
    expect(pendingUploads.size).toBe(1)
  })

  it('completes Adapter upload and creates uploaded topic artifact', async () => {
    const topic = await topicRepo.createTopic({ name: 'Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'session-1' })
    const request = await requestArtifactUpload(makeContext(pendingUploads), {
      sessionId: 'session-1',
      name: 'report.md',
      mime: 'text/markdown',
      sizeBytes: 128,
    })

    const { artifact, result } = await completeArtifactUpload(makeContext(pendingUploads), {
      uploadId: request.uploadId as string,
      artifactId: request.artifactId as string,
    })

    expect(result).toEqual({
      ok: true,
      artifactId: request.artifactId,
      uploadStatus: 'uploaded',
    })
    expect(artifact.topic_id).toBe(topic.id)
    expect(artifact.upload_status).toBe('uploaded')
    expect((await artifactRepo.getArtifact(artifact.id))?.name).toBe('report.md')
  })

  it('records Adapter upload failure as failed artifact', async () => {
    const topic = await topicRepo.createTopic({ name: 'Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'session-1' })
    const request = await requestArtifactUpload(makeContext(pendingUploads), {
      sessionId: 'session-1',
      name: 'huge.json',
      mime: 'application/json',
      sizeBytes: 1024,
    })

    const { artifact, result } = await failArtifactUpload(makeContext(pendingUploads), {
      uploadId: request.uploadId as string,
      code: 'size_exceeded',
      message: '文件过大',
    })

    expect(result).toEqual({
      ok: true,
      artifactId: request.artifactId,
      uploadStatus: 'upload_failed',
    })
    expect(artifact.upload_status).toBe('upload_failed')
    expect(artifact.failure_code).toBe('size_exceeded')
    expect(artifact.failure_message).toBe('文件过大')
    expect(artifact.topic_id).toBe(topic.id)
  })

  it('refreshes Adapter download URL only for uploaded artifact', async () => {
    const topic = await topicRepo.createTopic({ name: 'Topic', kind: 'normal', agentType: 'general' })
    await topicRepo.updateTopic(topic.id, { pi_session_id: 'session-1' })
    const artifact = await artifactRepo.createArtifact({
      topicId: topic.id,
      originTopicId: topic.id,
      name: 'report.md',
      mime: 'text/markdown',
      sizeBytes: 128,
      r2Key: 'topics/topic/report.md',
      source: 'generated',
    })

    const result = await initArtifactDownload({
      config,
      baseUrl: 'https://agent-chat.test',
    }, {
      sessionId: 'session-1',
      artifactId: artifact.id,
    })

    expect(result.artifactId).toBe(artifact.id)
    expect(result.downloadUrl).toContain('/api/artifacts/download/')
  })
})
