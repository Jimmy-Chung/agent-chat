import { useState } from 'react'
import { ProviderConfig } from '../types'
import { X, Eye, EyeOff, CheckCircle } from 'lucide-react'

interface Props {
  config: ProviderConfig
  onSave: (config: ProviderConfig) => void
  onClose: () => void
}

export default function ProviderPanel({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ProviderConfig>({ ...config })
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md bg-gray-950 rounded-xl border border-gray-800 shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-800">
          <span className="text-base font-semibold text-gray-100 flex-1">模型配置</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 正文 */}
        <div className="px-5 py-5 space-y-5">
          {/* 供应商标识 */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
            <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center">
              <span className="text-blue-400 text-xs font-bold">DS</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">DeepSeek</p>
              <p className="text-xs text-gray-500">兼容 OpenAI 接口</p>
            </div>
          </div>

          {/* 接口地址 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">接口地址</label>
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2
                text-sm text-gray-200 placeholder-gray-600
                focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* API 密钥 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">API 密钥</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 pr-10
                  text-sm text-gray-200 placeholder-gray-600
                  focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600
                  hover:text-gray-400 transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-600">
              存储在浏览器 localStorage 中。未填写时使用本地降级方案（无语义解析）。
            </p>
          </div>

          {/* 模型 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">模型</label>
            <select
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2
                text-sm text-gray-200
                focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </select>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
              bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {saved ? (
              <><CheckCircle size={14} />已保存</>
            ) : (
              '保存'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
