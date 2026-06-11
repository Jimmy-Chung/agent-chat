import { describe, expect, it } from 'vitest'
import { resolveTopicSopNames, topicSopBadgeLabel } from '../lib/topic-sop'

function topic(overrides: {
  programming_spec_json?: string | null
  general_spec_json?: string | null
  sop_template_id?: string | null
}) {
  return {
    programming_spec_json: null,
    general_spec_json: null,
    sop_template_id: null,
    ...overrides,
  }
}

function specWithSops(names: string[]): string {
  return JSON.stringify({
    sopWorkflow: {
      selectedSops: names.map((name, index) => ({ sopId: `s${index}`, name, order: index })),
    },
  })
}

describe('resolveTopicSopNames', () => {
  it('reads SOP names from the programming spec workflow snapshot in order', () => {
    const names = resolveTopicSopNames(
      topic({ programming_spec_json: specWithSops(['数据分析', '报告生成']) }),
    )
    expect(names).toEqual(['数据分析', '报告生成'])
  })

  it('reads SOP names from the general spec', () => {
    const names = resolveTopicSopNames(topic({ general_spec_json: specWithSops(['客服话术']) }))
    expect(names).toEqual(['客服话术'])
  })

  it('returns empty for topics without SOP workflow or with broken spec json', () => {
    expect(resolveTopicSopNames(topic({}))).toEqual([])
    expect(resolveTopicSopNames(topic({ programming_spec_json: '{not json' }))).toEqual([])
    expect(resolveTopicSopNames(topic({ programming_spec_json: JSON.stringify({ extension: 'claude-code' }) }))).toEqual([])
  })
})

describe('topicSopBadgeLabel', () => {
  it('labels single and multiple SOPs and hides when none', () => {
    expect(topicSopBadgeLabel([])).toBeNull()
    expect(topicSopBadgeLabel(['数据分析'])).toBe('SOP · 数据分析')
    expect(topicSopBadgeLabel(['数据分析', '报告生成'])).toBe('SOP ×2 · 数据分析')
  })
})
