import type { WSFrame } from '@agent-chat/protocol'
import { artifactDownloadInitSchema, artifactUploadCompleteSchema, artifactUploadInitSchema, topicSelectSchema } from '@agent-chat/protocol'
import * as artifactRepo from '../../db/repos/artifact.repo'
import type { AppConfig, Env } from '../../config'
import {
  ARTIFACT_UPLOAD_MAX_BYTES,
} from '../../r2/artifact-access'
import {
  artifactToPayload,
  completeArtifactUpload,
  initArtifactDownload,
  type PendingUpload,
} from '../artifact-control'

const pendingUploads = new Map<string, PendingUpload>()

export function registerArtifactHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void; sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void },
  options?: { env?: Env; config?: AppConfig; baseUrl?: string },
): void {
  hub.on('client:artifact.upload.init', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = artifactUploadInitSchema.parse(frame.d)

    if (!options?.env?.R2 || !options.config || !options.baseUrl) {
      hub.sendToClient?.(conn, {
        type: 'error',
        data: {
          code: 'ARTIFACT_UPLOAD_UNAVAILABLE',
          message: 'File upload is not available in this version',
        },
      })
      return
    }

    if (data.sizeBytes > ARTIFACT_UPLOAD_MAX_BYTES) {
      hub.sendToClient?.(conn, {
        type: 'error',
        data: {
          code: 'ARTIFACT_UPLOAD_TOO_LARGE',
          message: `File upload limit is ${Math.floor(ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`,
        },
      })
      return
    }

    const topicId = data.topicId ?? null
    const { ulid } = await import('../../lib/ulid')
    const { buildArtifactKey, createArtifactToken, buildArtifactAccessUrl, ARTIFACT_URL_TTL_MS } = await import('../../r2/artifact-access')
    const uploadId = ulid()
    const artifactId = ulid()
    const r2Key = buildArtifactKey(topicId, uploadId, data.name)
    const expiresAt = Date.now() + ARTIFACT_URL_TTL_MS
    pendingUploads.set(uploadId, {
      uploadId,
      artifactId,
      topicId,
      name: data.name,
      mime: data.mime,
      sizeBytes: data.sizeBytes,
      r2Key,
      source: 'uploaded',
      expiresAt,
    })

    const token = await createArtifactToken(options.config, {
      action: 'upload',
      key: r2Key,
      expiresAt,
      maxBytes: ARTIFACT_UPLOAD_MAX_BYTES,
    })
    hub.sendToClient?.(conn, {
      type: 'artifact.upload.ready',
      data: {
        uploadId,
        uploadUrl: buildArtifactAccessUrl(options.baseUrl, 'upload', r2Key, token),
        method: 'PUT',
        expiresAt,
        maxBytes: ARTIFACT_UPLOAD_MAX_BYTES,
      },
    })
  })

  hub.on('client:artifact.upload.complete', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = artifactUploadCompleteSchema.parse(frame.d)
    const { artifact } = await completeArtifactUpload({
      env: options?.env,
      config: options?.config,
      baseUrl: options?.baseUrl,
      pendingUploads,
    }, {
      uploadId: data.uploadId,
      topicId: data.topicId,
      metadata: { uploadedVia: 'agent-chat' },
    })
    hub.sendToClient?.(args[0], {
      type: 'artifact.added',
      data: artifactToPayload(artifact),
    })
    if ('broadcast' in hub && typeof hub.broadcast === 'function') {
      hub.broadcast('artifact.added', artifactToPayload(artifact))
    }
  })

  hub.on('client:artifact.download.init', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = artifactDownloadInitSchema.parse(frame.d)
    try {
      const result = await initArtifactDownload({
        config: options?.config,
        baseUrl: options?.baseUrl,
      }, {
        artifactId: data.artifactId,
      })
      hub.sendToClient?.(conn, {
        type: 'artifact.download.ready',
        data: result,
      })
    } catch {
      hub.sendToClient?.(conn, {
        type: 'error',
        data: { code: 'ARTIFACT_DOWNLOAD_UNAVAILABLE', message: 'Artifact download is not available' },
      })
    }
  })

  hub.on('client:topic.select', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = topicSelectSchema.parse(frame.d)

    if (data.topicId === 'system_artifact_pool') {
      const artifacts = await artifactRepo.listPoolArtifacts()
      if (hub.sendToClient) {
        hub.sendToClient(conn, {
          type: 'artifact.list',
          data: { artifacts: artifacts.map(artifactToPayload) },
        })
      }
    } else {
      const artifacts = await artifactRepo.listArtifactsByTopic(data.topicId)
      if (hub.sendToClient) {
        hub.sendToClient(conn, {
          type: 'artifact.list',
          data: { artifacts: artifacts.map(artifactToPayload) },
        })
      }
    }
  })
}
