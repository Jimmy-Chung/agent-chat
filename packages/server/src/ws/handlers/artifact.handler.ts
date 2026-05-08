import type { WSFrame } from '@agent-chat/protocol'
import { artifactUploadInitSchema, artifactUploadCompleteSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import * as artifactRepo from '../../db/repos/artifact.repo'
import * as r2 from '../../r2/client'
import { logger } from '../../logger'

export function registerArtifactHandlers(hub: WsHub): void {
  hub.on('client:artifact.upload.init', async (conn, frame: WSFrame) => {
    const data = artifactUploadInitSchema.parse(frame.d)

    try {
      const { uploadId, url, key } = await r2.createPresignedUrl(
        data.name,
        data.mime,
      )

      // Send presigned URL back to requesting client
      hub.sendToClient(conn.ws, {
        type: 'error', // reuse error as response — client expects uploadId + url
        data: {
          code: 'ARTIFACT_UPLOAD_READY',
          message: JSON.stringify({ uploadId, url, key, topicId: data.topicId }),
        },
      })
    } catch (err) {
      logger.error({ err }, 'Failed to create presigned URL')
      hub.sendToClient(conn.ws, {
        type: 'error',
        data: {
          code: 'ARTIFACT_UPLOAD_FAILED',
          message: 'R2 not configured or presigned URL generation failed',
        },
      })
    }
  })

  hub.on('client:artifact.upload.complete', (_conn, frame: WSFrame) => {
    const data = artifactUploadCompleteSchema.parse(frame.d)

    // For now, create artifact record with the uploadId as r2_key
    // In production, verify the upload succeeded with R2 head request
    const artifact = artifactRepo.createArtifact({
      topicId: data.topicId ?? null,
      name: data.uploadId, // client should send actual name
      r2Key: `uploads/${data.uploadId}`,
      source: 'uploaded',
    })

    hub.broadcast({
      type: 'artifact.added',
      data: {
        id: artifact.id,
        topic_id: artifact.topic_id,
        name: artifact.name,
        mime: artifact.mime,
        size_bytes: artifact.size_bytes,
        source: artifact.source,
        created_at: artifact.created_at,
      },
    })
  })
}
