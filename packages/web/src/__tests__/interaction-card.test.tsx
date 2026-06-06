import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InteractionCard } from '../components/chat/InteractionCard'
import { useMessageStore } from '../stores/message-store'

const sendMock = vi.fn()

vi.mock('@/lib/ws-client', () => ({
  getWsClient: () => ({ send: sendMock }),
}))

afterEach(() => {
  cleanup()
  sendMock.mockClear()
  useMessageStore.setState({ interactions: {}, focusedMessageTarget: null })
})

describe('InteractionCard', () => {
  it('sends the raw adapter choice instead of the shortened display label', () => {
    const rawChoice = 'Next.js — 前后端一体，React 页面 + API Routes，部署简单'

    render(
      <InteractionCard
        interactionId="toolu_choice_1"
        topicId="topic-1"
        interactionKind="choice"
        prompt="技术栈用哪套？"
        options={[rawChoice]}
        status="pending"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Next\.js/i }))

    expect(sendMock).toHaveBeenCalledWith({
      type: 'user.action',
      data: {
        topicId: 'topic-1',
        action: 'choose',
        interactionId: 'toolu_choice_1',
        choice: rawChoice,
      },
    })
    expect(useMessageStore.getState().interactions.toolu_choice_1.response).toBe(rawChoice)
    expect(useMessageStore.getState().interactions.toolu_choice_1.status).toBe('resolved')
  })
})
