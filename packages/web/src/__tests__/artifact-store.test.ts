import { describe, it, expect, beforeEach } from 'vitest'
import { useArtifactStore } from '../stores/artifact-store'
import type { Artifact } from '@agent-chat/protocol'

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    topic_id: null,
    origin_topic_id: null,
    name: 'test.txt',
    mime: 'text/plain',
    size_bytes: 100,
    r2_key: '',
    source: 'uploaded',
    created_at: Date.now(),
    metadata_json: null,
    ...overrides,
  }
}

describe('ArtifactStore', () => {
  beforeEach(() => {
    useArtifactStore.setState({ byTopic: {}, poolArtifacts: [] })
  })

  it('should have correct initial state', () => {
    const state = useArtifactStore.getState()
    expect(state.byTopic).toEqual({})
    expect(state.poolArtifacts).toEqual([])
  })

  it('addArtifact adds to pool when topic_id is null', () => {
    useArtifactStore.getState().addArtifact(makeArtifact({ id: 'a1' }))
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(1)
  })

  it('addArtifact adds to topic when topic_id is set', () => {
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a1', topic_id: 't1' }))
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(1)
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(0)
  })

  it('addArtifact creates topic array if missing', () => {
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a1', topic_id: 't1' }))
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a2', topic_id: 't1' }))
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(2)
  })

  it('removeArtifact removes from pool', () => {
    useArtifactStore.getState().addArtifact(makeArtifact({ id: 'a1' }))
    useArtifactStore.getState().removeArtifact('a1')
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(0)
  })

  it('removeArtifact removes from topic', () => {
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a1', topic_id: 't1' }))
    useArtifactStore.getState().removeArtifact('a1')
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(0)
  })

  it('removeArtifact is no-op for non-existent id', () => {
    useArtifactStore.getState().addArtifact(makeArtifact({ id: 'a1' }))
    useArtifactStore.getState().removeArtifact('nonexistent')
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(1)
  })

  it('moveArtifact moves from pool to topic', () => {
    useArtifactStore.getState().addArtifact(makeArtifact({ id: 'a1' }))
    useArtifactStore.getState().moveArtifact('a1', null, 't1')
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(0)
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(1)
    expect(useArtifactStore.getState().byTopic['t1'][0].topic_id).toBe('t1')
  })

  it('moveArtifact moves from topic to pool', () => {
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a1', topic_id: 't1' }))
    useArtifactStore.getState().moveArtifact('a1', 't1', null)
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(0)
    expect(useArtifactStore.getState().poolArtifacts).toHaveLength(1)
    expect(useArtifactStore.getState().poolArtifacts[0].topic_id).toBeNull()
  })

  it('moveArtifact moves between topics', () => {
    useArtifactStore
      .getState()
      .addArtifact(makeArtifact({ id: 'a1', topic_id: 't1' }))
    useArtifactStore.getState().moveArtifact('a1', 't1', 't2')
    expect(useArtifactStore.getState().byTopic['t1']).toHaveLength(0)
    expect(useArtifactStore.getState().byTopic['t2']).toHaveLength(1)
    expect(useArtifactStore.getState().byTopic['t2'][0].topic_id).toBe('t2')
  })

  it('setTopicArtifacts replaces topic artifacts', () => {
    const artifacts = [
      makeArtifact({ id: 'a1', topic_id: 't1' }),
      makeArtifact({ id: 'a2', topic_id: 't1' }),
    ]
    useArtifactStore.getState().setTopicArtifacts('t1', artifacts)
    expect(useArtifactStore.getState().byTopic['t1']).toEqual(artifacts)
  })

  it('setPoolArtifacts replaces pool', () => {
    const artifacts = [makeArtifact({ id: 'a1' }), makeArtifact({ id: 'a2' })]
    useArtifactStore.getState().setPoolArtifacts(artifacts)
    expect(useArtifactStore.getState().poolArtifacts).toEqual(artifacts)
  })

  it('stores failed artifact status metadata', () => {
    const artifact = makeArtifact({
      id: 'failed-1',
      topic_id: 't1',
      upload_status: 'upload_failed',
      failure_code: 'size_exceeded',
      failure_message: '文件过大',
    })

    useArtifactStore.getState().addArtifact(artifact)

    expect(useArtifactStore.getState().byTopic.t1[0].upload_status).toBe('upload_failed')
    expect(useArtifactStore.getState().byTopic.t1[0].failure_message).toBe('文件过大')
  })
})
