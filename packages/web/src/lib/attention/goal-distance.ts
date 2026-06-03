// 目标距离（cosine fallback）—— 无 LLM 时用它估算节点与目标的相关度。
// 中英文混合分词：英文词 + 中文 bigram；停用词过滤；词频向量余弦。
// 也被 S5（色条映射）复用。

const STOP = new Set([
  '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '吗', '吧', '呢', '么', '请', '帮',
  'the', 'a', 'an', 'to', 'of', 'and', 'is', 'are', 'for', 'in', 'on', 'it', 'this', 'that',
])

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  for (const m of lower.matchAll(/[a-z][a-z0-9]+/g)) tokens.push(m[0])
  const han = text.match(/[一-鿿]/g) ?? []
  if (han.length === 1) tokens.push(han[0])
  for (let i = 0; i < han.length - 1; i++) tokens.push(han[i] + han[i + 1])
  return tokens.filter((t) => !STOP.has(t))
}

function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

export function cosineSimilarity(aTokens: string[], bTokens: string[]): number {
  const a = termFreq(aTokens)
  const b = termFreq(bTokens)
  if (a.size === 0 || b.size === 0) return 0
  let dot = 0
  for (const [t, av] of a) {
    const bv = b.get(t)
    if (bv) dot += av * bv
  }
  let na = 0
  for (const v of a.values()) na += v * v
  let nb = 0
  for (const v of b.values()) nb += v * v
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 目标距离：0（紧贴目标）~ 1（完全偏离）。空文本 → 0.5（中性未知）。 */
export function computeGoalDistance(goalText: string, nodeText: string): number {
  if (!goalText.trim() || !nodeText.trim()) return 0.5
  const sim = cosineSimilarity(tokenize(goalText), tokenize(nodeText))
  return Math.min(1, Math.max(0, 1 - sim))
}
