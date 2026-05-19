import type { Artifact } from '@agent-chat/protocol'
import type { AppConfig } from '../config'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as topicRepo from '../db/repos/topic.repo'
import {
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_URL_TTL_MS,
  buildArtifactAccessUrl,
  buildArtifactKey,
  createArtifactToken,
} from '../r2/artifact-access'
import { ulid } from '../lib/ulid'

export interface PendingUpload {
  uploadId: string
  artifactId: string
  topicId: string | null
  sessionId?: string
  name: string
  mime: string
  sizeBytes: number
  r2Key: string
  source: Artifact['source']
  metadataJson?: string | null
  expiresAt: number
}

export type PendingUploadStore = Map<string, PendingUpload>

export interface ArtifactControlContext {
  env?: { R2?: R2Bucket }
  config?: AppConfig | null
  baseUrl?: string | null
  pendingUploads: PendingUploadStore
}

export interface ArtifactUploadRequestParams {
  sessionId?: string
  topicId?: string
  artifactId?: string
  source?: Artifact['source']
  name: string
  mime?: string
  sizeBytes: number
  metadata?: unknown
}

export interface ArtifactUploadCompleteParams {
  uploadId: string
  artifactId?: string
  topicId?: string
  metadata?: unknown
}

export interface ArtifactUploadFailedParams {
  uploadId?: string
  artifactId?: string
  sessionId?: string
  topicId?: string
  name?: string
  mime?: string
  sizeBytes?: number
  code?: string
  message?: string
  metadata?: unknown
}

export interface ArtifactDownloadInitParams {
  artifactId: string
  sessionId?: string
  topicId?: string
}

export function artifactToPayload(artifact: Artifact): Record<string, unknown> {
  const uploadStatus = artifact.upload_status ?? 'uploaded'
  return {
    id: artifact.id,
    topic_id: artifact.topic_id,
    origin_topic_id: artifact.origin_topic_id,
    name: artifact.name,
    mime: artifact.mime,
    size_bytes: artifact.size_bytes,
    r2_key: artifact.r2_key ?? '',
    download_url: undefined,
    preview_url: undefined,
    source: artifact.source,
    upload_status: uploadStatus,
    failure_code: artifact.failure_code,
    failure_message: artifact.failure_message,
    created_at: artifact.created_at,
    metadata_json: artifact.metadata_json,
  }
}

export async function resolveTopicIdForSession(params: {
  sessionId?: string
  topicId?: string
}): Promise<string | null> {
  if (!params.sessionId) return params.topicId ?? null
  const topics = await topicRepo.listTopics()
  const topic = topics.find((item) => item.pi_session_id === params.sessionId)
  if (!topic) throw rpcError('session_not_found', 'Agent session is not linked to a topic')
  if (params.topicId && params.topicId !== topic.id) {
    throw rpcError('topic_mismatch', 'Topic does not match agent session')
  }
  return topic.id
}

export async function requestArtifactUpload(
  ctx: ArtifactControlContext,
  params: ArtifactUploadRequestParams,
): Promise<Record<string, unknown>> {
  if (!ctx.env?.R2 || !ctx.config || !ctx.baseUrl) {
    throw rpcError('upload_unavailable', 'Artifact upload is not available')
  }
  if (params.sizeBytes > ARTIFACT_UPLOAD_MAX_BYTES) {
    throw rpcError('size_exceeded', `File upload limit is ${Math.floor(ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`)
  }

  const topicId = await resolveTopicIdForSession(params)
  const uploadId = ulid()
  const artifactId = params.artifactId ?? ulid()
  const mime = params.mime ?? 'application/octet-stream'
  const r2Key = buildArtifactKey(topicId, uploadId, params.name)
  const expiresAt = Date.now() + ARTIFACT_URL_TTL_MS
  const metadataJson = stringifyMetadata({
    generatedVia: 'adapter',
    ...(isRecord(params.metadata) ? params.metadata : {}),
  })

  ctx.pendingUploads.set(uploadId, {
    uploadId,
    artifactId,
    topicId,
    sessionId: params.sessionId,
    name: params.name,
    mime,
    sizeBytes: params.sizeBytes,
    r2Key,
    source: params.source ?? 'generated',
    metadataJson,
    expiresAt,
  })

  const token = await createArtifactToken(ctx.config, {
    action: 'upload',
    key: r2Key,
    expiresAt,
    maxBytes: ARTIFACT_UPLOAD_MAX_BYTES,
  })

  return {
    artifactId,
    uploadId,
    uploadUrl: buildArtifactAccessUrl(ctx.baseUrl, 'upload', r2Key, token),
    method: 'PUT',
    expiresAt,
    maxBytes: ARTIFACT_UPLOAD_MAX_BYTES,
    headers: {
      'content-type': mime,
    },
  }
}

export async function completeArtifactUpload(
  ctx: ArtifactControlContext,
  params: ArtifactUploadCompleteParams,
): Promise<{ artifact: Artifact; result: Record<string, unknown> }> {
  const pending = ctx.pendingUploads.get(params.uploadId)
  if (!pending || pending.expiresAt < Date.now()) {
    throw rpcError('upload_not_found', 'Upload is not found or expired')
  }
  if (params.artifactId && params.artifactId !== pending.artifactId) {
    throw rpcError('artifact_mismatch', 'Artifact does not match upload')
  }
  if (params.topicId && params.topicId !== pending.topicId) {
    throw rpcError('topic_mismatch', 'Topic does not match upload')
  }
  ctx.pendingUploads.delete(params.uploadId)

  const artifact = await artifactRepo.createArtifact({
    id: pending.artifactId,
    topicId: pending.topicId,
    originTopicId: pending.topicId,
    name: pending.name,
    mime: pending.mime,
    sizeBytes: pending.sizeBytes,
    r2Key: pending.r2Key,
    source: pending.source,
    uploadStatus: 'uploaded',
    metadataJson: mergeMetadataJson(pending.metadataJson, params.metadata),
  })

  return {
    artifact,
    result: {
      ok: true,
      artifactId: artifact.id,
      uploadStatus: 'uploaded',
    },
  }
}

export async function failArtifactUpload(
  ctx: ArtifactControlContext,
  params: ArtifactUploadFailedParams,
): Promise<{ artifact: Artifact; result: Record<string, unknown> }> {
  let pending: PendingUpload | undefined
  if (params.uploadId) pending = ctx.pendingUploads.get(params.uploadId)
  if (pending) ctx.pendingUploads.delete(pending.uploadId)

  const topicId = pending?.topicId ?? await resolveTopicIdForSession(params)
  const artifactId = params.artifactId ?? pending?.artifactId ?? ulid()
  const name = params.name ?? pending?.name ?? 'artifact'
  const mime = params.mime ?? pending?.mime ?? 'application/octet-stream'
  const sizeBytes = params.sizeBytes ?? pending?.sizeBytes ?? 0
  const r2Key = pending?.r2Key ?? buildArtifactKey(topicId, params.uploadId ?? artifactId, name)
  const failureCode = params.code ?? 'upload_failed'
  const failureMessage = params.message ?? 'Artifact upload failed'

  const artifact = await artifactRepo.createArtifact({
    id: artifactId,
    topicId,
    originTopicId: topicId,
    name,
    mime,
    sizeBytes,
    r2Key,
    source: 'generated',
    uploadStatus: 'upload_failed',
    failureCode,
    failureMessage,
    metadataJson: mergeMetadataJson(pending?.metadataJson ?? stringifyMetadata({ generatedVia: 'adapter' }), {
      ...(isRecord(params.metadata) ? params.metadata : {}),
      failureCode,
      failureMessage,
    }),
  })

  return {
    artifact,
    result: {
      ok: true,
      artifactId: artifact.id,
      uploadStatus: 'upload_failed',
    },
  }
}

export async function initArtifactDownload(
  ctx: Pick<ArtifactControlContext, 'config' | 'baseUrl'>,
  params: ArtifactDownloadInitParams,
): Promise<Record<string, unknown>> {
  if (!ctx.config || !ctx.baseUrl) {
    throw rpcError('download_unavailable', 'Artifact download is not available')
  }
  const artifact = await artifactRepo.getArtifact(params.artifactId)
  if (!artifact || !artifact.r2_key || (artifact.upload_status ?? 'uploaded') !== 'uploaded') {
    throw rpcError('artifact_unavailable', 'Artifact is not available for download')
  }
  if (params.sessionId || params.topicId) {
    const topicId = await resolveTopicIdForSession(params)
    if (artifact.topic_id && artifact.topic_id !== topicId) {
      throw rpcError('artifact_forbidden', 'Artifact is not accessible from this topic')
    }
  }

  const expiresAt = Date.now() + ARTIFACT_URL_TTL_MS
  const token = await createArtifactToken(ctx.config, {
    action: 'download',
    key: artifact.r2_key,
    expiresAt,
  })
  const downloadUrl = buildArtifactAccessUrl(ctx.baseUrl, 'download', artifact.r2_key, token, artifact.name)
  return {
    artifactId: artifact.id,
    downloadUrl,
    previewUrl: downloadUrl,
    expiresAt,
  }
}

export function rpcError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

export function errorToRpc(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return {
      code: String((error as { code: unknown }).code),
      message: String((error as { message: unknown }).message),
    }
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Internal error',
  }
}

function stringifyMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata)
}

function mergeMetadataJson(baseJson: string | null | undefined, next: unknown): string | null {
  if (!next || !isRecord(next)) return baseJson ?? null
  let base: Record<string, unknown> = {}
  if (baseJson) {
    try {
      const parsed = JSON.parse(baseJson)
      if (isRecord(parsed)) base = parsed
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...next })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
