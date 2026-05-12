type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

let _level: LogLevel = 'info'

export function setLogLevel(level: LogLevel) {
  _level = level
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[_level]) return
  const entry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...extra,
  }
  const str = JSON.stringify(entry)
  switch (level) {
    case 'error':
    case 'fatal':
      console.error(str)
      break
    case 'warn':
      console.warn(str)
      break
    default:
      console.log(str)
  }
}

function pinoLog(level: LogLevel, msgOrObj: string | Record<string, unknown>, extra?: unknown) {
  if (typeof msgOrObj === 'string') {
    log(level, msgOrObj, extra as Record<string, unknown> | undefined)
  } else {
    log(level, typeof extra === 'string' ? extra : '', msgOrObj)
  }
}

export const logger = {
  debug: (msgOrObj: string | Record<string, unknown>, extra?: unknown) => pinoLog('debug', msgOrObj, extra),
  info: (msgOrObj: string | Record<string, unknown>, extra?: unknown) => pinoLog('info', msgOrObj, extra),
  warn: (msgOrObj: string | Record<string, unknown>, extra?: unknown) => pinoLog('warn', msgOrObj, extra),
  error: (msgOrObj: string | Record<string, unknown>, extra?: unknown) => pinoLog('error', msgOrObj, extra),
  fatal: (msgOrObj: string | Record<string, unknown>, extra?: unknown) => pinoLog('fatal', msgOrObj, extra),
}
