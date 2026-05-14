export function getLocalDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function isSameLocalDay(a: number, b: number): boolean {
  return getLocalDayKey(a) === getLocalDayKey(b)
}

export function shouldShowDateDivider(
  previousTimestamp: number | null,
  currentTimestamp: number,
): boolean {
  if (!currentTimestamp) return false
  if (previousTimestamp == null) return true
  return !isSameLocalDay(previousTimestamp, currentTimestamp)
}

export function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function formatDateDivider(timestamp: number, nowTimestamp = Date.now()): string {
  const date = new Date(timestamp)
  const now = new Date(nowTimestamp)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  const time = formatMessageTime(timestamp)

  if (isSameLocalDay(timestamp, now.getTime())) {
    return `今天 · ${time}`
  }

  if (isSameLocalDay(timestamp, yesterday.getTime())) {
    return `昨天 · ${time}`
  }

  const day = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)

  return `${day} · ${time}`
}
