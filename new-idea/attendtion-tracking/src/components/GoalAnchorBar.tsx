import { GoalAnchor } from '../types'
import { Target, AlertCircle, ChevronLeft } from 'lucide-react'

interface Props {
  anchor: GoalAnchor | null
  maxGoalDistance: number
  onSettingsClick: () => void
  parentGoal?: string      // 上一层目标文字，有则显示返回按钮
  onBack?: () => void      // 点击返回按钮
}

function DistanceBar({ value }: { value: number }) {
  const color =
    value < 0.35
      ? 'bg-emerald-500'
      : value < 0.65
      ? 'bg-yellow-400'
      : 'bg-orange-500'

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span className="whitespace-nowrap">目标距离</span>
      <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className={value >= 0.65 ? 'text-orange-400 font-medium' : ''}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  )
}

export default function GoalAnchorBar({
  anchor,
  maxGoalDistance,
  onSettingsClick,
  parentGoal,
  onBack,
}: Props) {
  const isDistant = maxGoalDistance >= 0.65
  const isVeryDistant = maxGoalDistance >= 0.8

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 gap-3
        bg-gray-950 border-b border-gray-800
        transition-all duration-500
        ${isVeryDistant ? 'animate-glow border-orange-700/60' : ''}
      `}
    >
      {/* 返回按钮（钻入子层级时显示） */}
      {onBack && parentGoal && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200
            px-2 py-1 rounded border border-gray-700 hover:border-gray-500
            transition-colors flex-shrink-0 bg-gray-900"
        >
          <ChevronLeft size={12} />
          <span className="truncate max-w-[120px]">{parentGoal}</span>
        </button>
      )}

      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center
          ${isDistant ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}
          ${isVeryDistant ? 'animate-pulse-slow' : ''}
        `}
      >
        {isDistant ? <AlertCircle size={14} /> : <Target size={14} />}
      </div>

      <div className="flex-1 min-w-0">
        {anchor ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-500 flex-shrink-0">
              {onBack ? '子目标' : '目标'}
            </span>
            <span className="text-sm text-gray-100 font-medium truncate">
              {anchor.normalized_goal || anchor.raw_query}
            </span>
            {anchor.normalized_goal &&
              anchor.normalized_goal !== anchor.raw_query && (
                <span
                  className="text-xs text-gray-600 truncate hidden md:block"
                  title={anchor.raw_query}
                >
                  （原文：{anchor.raw_query.slice(0, 60)}
                  {anchor.raw_query.length > 60 ? '…' : ''}）
                </span>
              )}
          </div>
        ) : (
          <span className="text-sm text-gray-600">
            上传 Claude Code JSONL 文件开始分析
          </span>
        )}
      </div>

      {anchor && <DistanceBar value={maxGoalDistance} />}

      {isDistant && (
        <span className="text-xs text-orange-400/80 hidden lg:block whitespace-nowrap">
          当前行为与起始目标距离拉大，是有意为之吗？
        </span>
      )}

      <button
        onClick={onSettingsClick}
        className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-300
          px-2 py-1 rounded border border-gray-800 hover:border-gray-600
          transition-colors"
      >
        模型配置
      </button>
    </div>
  )
}
