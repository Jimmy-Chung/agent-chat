import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Artifact } from '@agent-chat/protocol'

interface ArtifactState {
  byTopic: Record<string, Artifact[]>
  poolArtifacts: Artifact[]
  addArtifact: (artifact: Artifact) => void
  removeArtifact: (id: string) => void
  moveArtifact: (id: string, fromTopicId: string | null, toTopicId: string | null) => void
  setTopicArtifacts: (topicId: string, artifacts: Artifact[]) => void
  setPoolArtifacts: (artifacts: Artifact[]) => void
}

export const useArtifactStore = create<ArtifactState>()(
  immer((set) => ({
    byTopic: {},
    poolArtifacts: [],

    addArtifact: (artifact) => {
      set((s) => {
        if (artifact.topic_id) {
          if (!s.byTopic[artifact.topic_id]) s.byTopic[artifact.topic_id] = []
          s.byTopic[artifact.topic_id].push(artifact)
        } else {
          s.poolArtifacts.push(artifact)
        }
      })
    },

    removeArtifact: (id) => {
      set((s) => {
        for (const topicId of Object.keys(s.byTopic)) {
          s.byTopic[topicId] = s.byTopic[topicId].filter((a) => a.id !== id)
        }
        s.poolArtifacts = s.poolArtifacts.filter((a) => a.id !== id)
      })
    },

    moveArtifact: (id, _fromTopicId, toTopicId) => {
      set((s) => {
        let artifact: Artifact | undefined
        for (const topicId of Object.keys(s.byTopic)) {
          const idx = s.byTopic[topicId].findIndex((a) => a.id === id)
          if (idx >= 0) {
            artifact = s.byTopic[topicId][idx]
            s.byTopic[topicId].splice(idx, 1)
            break
          }
        }
        if (!artifact) {
          const idx = s.poolArtifacts.findIndex((a) => a.id === id)
          if (idx >= 0) {
            artifact = s.poolArtifacts[idx]
            s.poolArtifacts.splice(idx, 1)
          }
        }
        if (artifact) {
          artifact.topic_id = toTopicId
          if (toTopicId) {
            if (!s.byTopic[toTopicId]) s.byTopic[toTopicId] = []
            s.byTopic[toTopicId].push(artifact)
          } else {
            s.poolArtifacts.push(artifact)
          }
        }
      })
    },

    setTopicArtifacts: (topicId, artifacts) => {
      set((s) => {
        s.byTopic[topicId] = artifacts
      })
    },

    setPoolArtifacts: (artifacts) => {
      set((s) => {
        s.poolArtifacts = artifacts
      })
    },
  })),
)
