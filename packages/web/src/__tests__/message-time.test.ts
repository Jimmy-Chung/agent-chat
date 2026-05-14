import { describe, expect, it } from 'vitest'
import {
  formatDateDivider,
  getLocalDayKey,
  isSameLocalDay,
  shouldShowDateDivider,
} from '../lib/message-time'

describe('message time helpers', () => {
  it('groups timestamps by browser local day', () => {
    const first = new Date(2026, 4, 13, 9, 0).getTime()
    const second = new Date(2026, 4, 13, 23, 59).getTime()
    const nextDay = new Date(2026, 4, 14, 0, 1).getTime()

    expect(getLocalDayKey(first)).toBe(getLocalDayKey(second))
    expect(isSameLocalDay(first, second)).toBe(true)
    expect(isSameLocalDay(second, nextDay)).toBe(false)
  })

  it('shows a divider for the first message and when the local day changes', () => {
    const may13 = new Date(2026, 4, 13, 23, 59).getTime()
    const may14 = new Date(2026, 4, 14, 0, 1).getTime()
    const may14Later = new Date(2026, 4, 14, 8, 30).getTime()

    expect(shouldShowDateDivider(null, may13)).toBe(true)
    expect(shouldShowDateDivider(may13, may14)).toBe(true)
    expect(shouldShowDateDivider(may14, may14Later)).toBe(false)
  })

  it('formats today, yesterday, and older dividers', () => {
    const now = new Date(2026, 4, 13, 12, 0).getTime()
    const today = new Date(2026, 4, 13, 9, 30).getTime()
    const yesterday = new Date(2026, 4, 12, 9, 30).getTime()
    const older = new Date(2026, 4, 10, 9, 30).getTime()

    expect(formatDateDivider(today, now)).toContain('今天')
    expect(formatDateDivider(yesterday, now)).toContain('昨天')
    expect(formatDateDivider(older, now)).toContain('5/10')
  })
})
