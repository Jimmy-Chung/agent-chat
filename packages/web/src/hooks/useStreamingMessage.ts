'use client'

import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message-store'

/**
 * Hook that tracks streaming state for a given topic.
 * Returns the accumulated streaming text and whether a message is currently streaming.
 */
export function useStreamingMessage(_topicId: string | null) {
  const streamingMessageId = useMessageStore((s) => s.streamingMessageId)
  const streamingText = useMessageStore((s) =>
    streamingMessageId ? s.streamingText[streamingMessageId] ?? '' : '',
  )

  const isStreaming = streamingMessageId !== null

  // Expose helper to get streaming text for a specific message ID
  const getStreamingText = useCallback(
    (messageId: string): string => {
      return useMessageStore.getState().streamingText[messageId] ?? ''
    },
    [],
  )

  return { isStreaming, streamingMessageId, streamingText, getStreamingText }
}
