import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PairingScanCard } from '../components/PairingScanCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('PairingScanCard', () => {
  afterEach(() => cleanup())

  it('shows upload and paste options by default', () => {
    render(<PairingScanCard />)

    expect(screen.getByRole('button', { name: '上传二维码图片' })).toBeTruthy()
    expect(screen.getByPlaceholderText('粘贴 https://…/pair?session=…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '拍照识别二维码' })).toBeNull()
  })

  it('shows a camera capture option for mobile pairing', () => {
    const { container } = render(<PairingScanCard showCameraOption />)

    expect(screen.getByRole('button', { name: '拍照识别二维码' })).toBeTruthy()
    expect(container.querySelector('input[capture="environment"]')).toBeTruthy()
  })
})
