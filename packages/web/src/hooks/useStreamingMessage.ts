'use client'

import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message-store'

/**
 * Hook that tracks streaming state for a given topic.
 * Returns the accumulated streaming text and whether a message is currently streaming.
 */
export function useStreamingMessage(topicId: string | null) {
  const streamingTopicId = useMessageStore((s) => s.streamingTopicId)
  const isStreaming = topicId !== null && streamingTopicId === topicId

  const getStreamingText = useCallback(
    (messageId: string): string => {
      return useMessageStore.getState().streamingText[messageId] ?? ''
    },
    [],
  )

  return { isStreaming, streamingTopicId, getStreamingText }
}
