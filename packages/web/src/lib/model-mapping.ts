import { MODEL_ALIASES, type ModelAlias, type ModelMapping } from '@/stores/ws-store'

export interface ModelOption {
  value: string
  label: string
}

/**
 * 话题内模型下拉/列表展示项。value 永远是别名（如 opus），透传给 adapter；
 * 配了映射时 label 显示「opus → glm5.1」，由 adapter 内部用环境变量解析。
 */
export function buildModelOptions(
  models: string[] | undefined,
  mapping: ModelMapping | undefined,
): ModelOption[] {
  return (models ?? []).map((m) => {
    const real = mapping?.[m as keyof ModelMapping]
    return { value: m, label: real ? `${m} → ${real}` : m }
  })
}

/**
 * 从编辑表单的三档输入构造 modelMapping：去空白、丢弃空档。
 * 返回空对象表示清除全部别名映射（PATCH 语义，契约 AIT-200）。
 */
export function buildModelMappingPayload(form: Record<ModelAlias, string>): ModelMapping {
  const mapping: ModelMapping = {}
  for (const alias of MODEL_ALIASES) {
    const real = form[alias]?.trim()
    if (real) mapping[alias] = real
  }
  return mapping
}
