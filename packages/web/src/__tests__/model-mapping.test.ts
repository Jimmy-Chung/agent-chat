import { describe, it, expect } from 'vitest'
import { buildModelOptions, buildModelMappingPayload } from '../lib/model-mapping'

describe('AIT-201 — model 别名映射', () => {
  // TC-201-01: claude-code 用接口 models 渲染别名下拉
  it('无映射时下拉项 = 别名本身，value=label', () => {
    const opts = buildModelOptions(['opus', 'sonnet', 'haiku'], undefined)
    expect(opts).toEqual([
      { value: 'opus', label: 'opus' },
      { value: 'sonnet', label: 'sonnet' },
      { value: 'haiku', label: 'haiku' },
    ])
  })

  // TC-201-02: 有 modelMapping 时展示「别名 → 真实模型」
  it('有映射时 label 显示「别名 → 真实」，value 仍为别名（透传给 adapter）', () => {
    const opts = buildModelOptions(
      ['opus', 'sonnet', 'haiku'],
      { opus: 'glm5.1', sonnet: 'glm5.0' },
    )
    expect(opts).toEqual([
      { value: 'opus', label: 'opus → glm5.1' },
      { value: 'sonnet', label: 'sonnet → glm5.0' },
      { value: 'haiku', label: 'haiku' }, // 未配档位 → 显示别名，官方默认
    ])
    // 关键：透传值是别名，不是真实模型
    expect(opts.map((o) => o.value)).toEqual(['opus', 'sonnet', 'haiku'])
  })

  it('models 为空/undefined 时返回空数组', () => {
    expect(buildModelOptions(undefined, { opus: 'x' })).toEqual([])
    expect(buildModelOptions([], undefined)).toEqual([])
  })

  // TC-201-03: 编辑表单录入映射构造 payload
  it('表单构造 payload：去空白、丢弃空档', () => {
    expect(buildModelMappingPayload({ opus: ' glm5.1 ', sonnet: '', haiku: 'glm-air' }))
      .toEqual({ opus: 'glm5.1', haiku: 'glm-air' })
  })

  it('全空 → 空对象（清除全部映射的 PATCH 语义）', () => {
    expect(buildModelMappingPayload({ opus: '', sonnet: '  ', haiku: '' })).toEqual({})
  })
})
