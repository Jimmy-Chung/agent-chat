export interface ErrorDetail {
  code?: unknown
  name?: string
  message: string
  cause?: unknown
  raw?: unknown
}

function tryStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function formatMessage(value: unknown): string {
  if (typeof value === 'string') return value
  return tryStringify(value) ?? String(value)
}

export function errorDetail(value: unknown): ErrorDetail {
  if (value instanceof Error) {
    const record = value as Error & { code?: unknown; cause?: unknown }
    return {
      code: record.code,
      name: value.name,
      message: value.message,
      cause: record.cause,
    }
  }

  const record = getRecord(value)
  if (record) {
    const nested = getRecord(record.error)
    const code = record.code ?? nested?.code
    const message = record.message ?? nested?.message ?? value
    return {
      code,
      name: typeof record.name === 'string' ? record.name : undefined,
      message: formatMessage(message),
      raw: value,
    }
  }

  return { message: String(value) }
}
