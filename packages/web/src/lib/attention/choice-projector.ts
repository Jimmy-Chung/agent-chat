import type { TraceExchange, TraceNode } from './types'

export interface DecisionOption {
  id: string
  label: string
  selected: boolean
}

export interface DecisionNode {
  id: string
  question: string
  options: DecisionOption[]
  selectedOptionId: string | null
  sourceExchangeId: string
  affectedNodeIds: string[]
}

export interface ChoiceProjection {
  decisions: DecisionNode[]
}

function inferOptions(exchange: TraceExchange): DecisionOption[] {
  const explicit = (exchange as unknown as { options?: string[] }).options
  if (explicit?.length) {
    return explicit.map((label, index) => ({ id: `opt_${index + 1}`, label, selected: false }))
  }

  const summary = exchange.assistant_summary
  const optionMatches = [...summary.matchAll(/([ABC123])[\).、:：]\s*([\s\S]*?)(?=\s+[ABC123][\).、:：]|$)/g)]
  if (optionMatches.length) {
    return optionMatches.map((m) => ({ id: String(m[1]), label: m[2].trim(), selected: false }))
  }
  return []
}

function choiceMatchesOption(choice: string, option: DecisionOption): boolean {
  const c = choice.trim().toLowerCase()
  return c.includes(option.id.toLowerCase()) || c.includes(option.label.toLowerCase())
}

function findQuestionExchange(exchanges: TraceExchange[], choiceIndex: number): TraceExchange | null {
  for (let i = choiceIndex - 1; i >= 0; i--) {
    const ex = exchanges[i]
    if (ex.assistant_actions.includes('ask') || ex.assistant_actions.includes('options')) return ex
  }
  return null
}

export function projectChoices(nodes: TraceNode[]): ChoiceProjection {
  const decisions: DecisionNode[] = []
  const allExchanges = nodes.flatMap((node) => (node.exchanges ?? []).map((exchange) => ({ node, exchange })))

  for (let i = 0; i < allExchanges.length; i++) {
    const { exchange } = allExchanges[i]
    if (exchange.user_kind !== 'choice') continue
    const questionExchange = findQuestionExchange(allExchanges.map((x) => x.exchange), i)
    if (!questionExchange) continue

    const selectedText = exchange.user_message
    const options = inferOptions(questionExchange).map((option) => ({
      ...option,
      selected: choiceMatchesOption(selectedText, option),
    }))
    const selected = options.find((option) => option.selected) ?? null
    const affectedNodeIds = allExchanges
      .slice(i)
      .map((x) => x.node.id)
      .filter((id, idx, arr) => arr.indexOf(id) === idx)

    decisions.push({
      id: `decision_${questionExchange.id}_${exchange.id}`,
      question: questionExchange.assistant_summary || questionExchange.user_message,
      options,
      selectedOptionId: selected?.id ?? null,
      sourceExchangeId: exchange.id,
      affectedNodeIds,
    })
  }

  return { decisions }
}
