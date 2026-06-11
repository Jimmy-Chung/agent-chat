import { describe, expect, it } from 'vitest'
import type { MindMapProjection } from '@agent-chat/protocol'
import { resolveSelectedAttentionSourceIds } from '../sop/export'

function projection(): MindMapProjection {
  return {
    nodes: [
      {
        id: 'aggregate_old',
        kind: 'aggregate',
        treeNodeId: 'topic_old',
        title: '旧聚合',
        subtitle: '',
        relation: 'main',
        goalDistance: 0,
        active: false,
        current: false,
        collapsed: true,
        depth: 1,
        sourceNodeIds: ['n1', 'n2'],
        aggregation: null,
        hasChildren: true,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  }
}

describe('Attention SOP export source resolution', () => {
  it('prefers selected trace source ids over projection node ids', () => {
    expect(resolveSelectedAttentionSourceIds(
      projection(),
      ['expanded_node_only_in_client'],
      ['n3', 'n4'],
    )).toEqual(['n3', 'n4'])
  })

  it('falls back to projection node ids for older clients', () => {
    expect(resolveSelectedAttentionSourceIds(
      projection(),
      ['aggregate_old'],
    )).toEqual(['n1', 'n2'])
  })
})
