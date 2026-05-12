import type { WSFrame, Artifact } from '@agent-chat/protocol'
import { topicSelectSchema } from '@agent-chat/protocol'
import * as artifactRepo from '../../db/repos/artifact.repo'

function artifactToPayload(a: Artifact) {
  return {
    id: a.id,
    topic_id: a.topic_id,
    origin_topic_id: a.origin_topic_id,
    name: a.name,
    mime: a.mime,
    size_bytes: a.size_bytes,
    source: a.source,
    created_at: a.created_at,
  }
}

export function registerArtifactHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void; sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void },
): void {
  hub.on('client:artifact.upload.init', async (...args: unknown[]) => {
    const conn = args[0]
    if (hub.sendToClient) {
      hub.sendToClient(conn, {
        type: 'error',
        data: {
          code: 'ARTIFACT_UPLOAD_UNAVAILABLE',
          message: 'File upload is not available in this version',
        },
      })
    }
  })

  hub.on('client:artifact.upload.complete', () => {
    // no-op
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
      if (artifacts.length > 0 && hub.sendToClient) {
        hub.sendToClient(conn, {
          type: 'artifact.list',
          data: { artifacts: artifacts.map(artifactToPayload) },
        })
      }
    }
  })
}
