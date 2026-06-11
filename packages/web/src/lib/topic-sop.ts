import type { Topic } from '@agent-chat/protocol'

/**
 * Resolve the SOP workflow mounted on a topic for display. Reads the
 * sopWorkflow snapshot embedded in the topic spec at creation time, so the
 * badge reflects what the session was actually created with even if the
 * template was later edited or deleted.
 */
export function resolveTopicSopNames(topic: Pick<Topic, 'programming_spec_json' | 'general_spec_json' | 'sop_template_id'>): string[] {
  for (const specJson of [topic.programming_spec_json, topic.general_spec_json]) {
    if (!specJson) continue
    try {
      const spec = JSON.parse(specJson) as {
        sopWorkflow?: { selectedSops?: Array<{ name?: unknown; order?: unknown }> }
      }
      const selected = spec.sopWorkflow?.selectedSops
      if (!Array.isArray(selected)) continue
      const names = [...selected]
        .sort((a, b) => (typeof a.order === 'number' ? a.order : 0) - (typeof b.order === 'number' ? b.order : 0))
        .map((entry) => (typeof entry.name === 'string' ? entry.name.trim() : ''))
        .filter(Boolean)
      if (names.length > 0) return names
    } catch {
      // 旧话题的 spec json 可能不是合法 JSON，忽略即可
    }
  }
  return []
}

export function topicSopBadgeLabel(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `SOP · ${names[0]}`
  return `SOP ×${names.length} · ${names[0]}`
}
