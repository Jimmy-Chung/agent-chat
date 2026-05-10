import type { WSFrame, Artifact } from '@agent-chat/protocol'
import { topicSelectSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
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

export function registerArtifactHandlers(hub: WsHub): void {
  hub.on('client:artifact.upload.init', async (conn, _frame: WSFrame) => {
    hub.sendToClient(conn.ws, {
      type: 'error',
      data: {
        code: 'ARTIFACT_UPLOAD_UNAVAILABLE',
        message: 'File upload is not available in this version',
      },
    })
  })

  hub.on('client:artifact.upload.complete', (_conn, _frame: WSFrame) => {
    // v1.0.0: no-op
  })

  hub.on('client:topic.select', (conn, frame: WSFrame) => {
    const data = topicSelectSchema.parse(frame.d)

    if (data.topicId === 'system_artifact_pool') {
      const artifacts = artifactRepo.listPoolArtifacts()
      hub.sendToClient(conn.ws, {
        type: 'artifact.list',
        data: { artifacts: artifacts.map(artifactToPayload) },
      })
    } else {
      const artifacts = artifactRepo.listArtifactsByTopic(data.topicId)
      if (artifacts.length > 0) {
        hub.sendToClient(conn.ws, {
          type: 'artifact.list',
          data: { artifacts: artifacts.map(artifactToPayload) },
        })
      }
    }
  })
}
