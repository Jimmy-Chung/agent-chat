import { ProgressInfo } from '../hooks/useTraceProcessor'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface Props { progress: ProgressInfo }

function formatMs(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

const PHASE_LABELS: Record<string, string> = {
  idle: '空闲', parsing: '解析 JSONL…', aggregating: '聚合事件…',
  interpreting: 'AI 分析中…', detecting: '检测语义分支…',
  done: '完成', error: '出错',
}

export default function ProgressPanel({ progress }: Props) {
  const { phase, overall, label, elapsedMs, error } = progress
  if (phase === 'idle') return null

  const isDone = phase === 'done'
  const isError = phase === 'error'
  const isActive = !isDone && !isError

  return (
    <div className={`rounded-lg border px-3 py-3 space-y-2
      ${isError ? 'bg-red-950/40 border-red-900/60'
        : isDone ? 'bg-emerald-950/30 border-emerald-900/40'
        : 'bg-gray-900 border-gray-800'}`}
    >
      <div className="flex items-center gap-2">
        {isError
          ? <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
          : isDone
          ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
          : <Loader2 size={13} className="text-blue-400 animate-spin flex-shrink-0" />}
        <span className={`text-xs font-medium ${isError ? 'text-red-300' : isDone ? 'text-emerald-300' : 'text-gray-200'}`}>
          {PHASE_LABELS[phase] ?? phase}
        </span>
        {(isDone || isActive) && elapsedMs > 0 && (
          <span className="text-[10px] text-gray-600 ml-auto">{formatMs(elapsedMs)}</span>
        )}
      </div>

      {!isError && (
        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.round(overall * 100)}%` }}
          />
        </div>
      )}

      {label && (
        <p className="text-[10px] text-gray-500 truncate">{label}</p>
      )}

      {isError && error && (
        <p className="text-xs text-red-400 leading-relaxed">{error}</p>
      )}
    </div>
  )
}
