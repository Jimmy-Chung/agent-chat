import type { Interaction } from '@agent-chat/protocol'
import * as interactionRepo from '../db/repos/interaction.repo'

export interface InteractionHistoryPayload {
  topicId: string
  interactionId: string
  messageId?: string
  interactionKind: 'approval' | 'choice'
  prompt: string
  options?: string[]
  status: 'pending' | 'resolved' | 'timeout'
  response?: string
}

export async function listPendingInteractionHistory(
  topicId: string,
): Promise<InteractionHistoryPayload[]> {
  const interactions = await interactionRepo.listPendingInteractions(topicId)
  return interactions.map(toPayload)
}

function toPayload(interaction: Interaction): InteractionHistoryPayload {
  return {
    topicId: interaction.topic_id,
    interactionId: interaction.id,
    messageId: interaction.message_id ?? undefined,
    interactionKind: interaction.kind,
    prompt: interaction.prompt,
    options: parseOptions(interaction.options_json),
    status: interaction.status,
    response: parseResponse(interaction.response_json),
  }
}

function parseOptions(optionsJson: string | null): string[] | undefined {
  if (!optionsJson) return undefined
  try {
    const parsed = JSON.parse(optionsJson)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined
  } catch {
    return undefined
  }
}

function parseResponse(responseJson: string | null): string | undefined {
  if (!responseJson) return undefined
  try {
    const parsed = JSON.parse(responseJson) as { choice?: string; decision?: string } | string
    if (typeof parsed === 'string') return parsed
    return parsed.choice ?? parsed.decision
  } catch {
    return undefined
  }
}
