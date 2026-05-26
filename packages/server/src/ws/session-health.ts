export interface SessionHealthPayload {
  topicId: string
  state: 'connected'
  piSessionId: string
}

export function buildConnectedSessionHealthPayload(input: {
  topicId: string
  piSessionId?: string | null
  isAttached: boolean
}): SessionHealthPayload | null {
  if (!input.piSessionId || !input.isAttached) return null
  return {
    topicId: input.topicId,
    state: 'connected',
    piSessionId: input.piSessionId,
  }
}
