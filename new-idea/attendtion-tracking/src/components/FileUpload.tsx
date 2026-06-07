import { useRef, useState, DragEvent } from 'react'
import { Upload, FileText, AlertCircle, Folder } from 'lucide-react'

interface Props {
  onJsonl: (content: string) => void
}

function isJsonlFile(name: string) {
  return name.endsWith('.jsonl') || name.endsWith('.json')
}

export default function FileUpload({ onJsonl }: Props) {
  const fileRef    = useRef<HTMLInputElement>(null)
  const folderRef  = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]   = useState(false)
  const [mode, setMode]           = useState<'drop' | 'paste'>('drop')
  const [text, setText]           = useState('')
  const [error, setError]         = useState('')
  const [fileCount, setFileCount] = useState(0)

  const processText = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const lines = trimmed.split('\n').filter(Boolean)
    let valid = false
    for (const line of lines) {
      try { JSON.parse(line); valid = true; break } catch { /* continue */ }
    }
    if (!valid) {
      setError('未找到有效的 JSON 行，请确认文件为 JSONL 格式')
      return
    }
    setError('')
    onJsonl(trimmed)
  }

  // 读取多个文件，合并内容后作为一个会话
  const handleFiles = (files: File[]) => {
    const jsonlFiles = files.filter((f) => isJsonlFile(f.name))
    if (!jsonlFiles.length) {
      setError('未找到 .jsonl 文件')
      return
    }
    setError('')
    setFileCount(jsonlFiles.length)

    const results: string[] = new Array(jsonlFiles.length)
    let loaded = 0
    jsonlFiles.forEach((file, idx) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        results[idx] = (e.target?.result as string) ?? ''
        loaded++
        if (loaded === jsonlFiles.length) {
          processText(results.join('\n'))
          setFileCount(0)
        }
      }
      reader.readAsText(file)
    })
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleFiles(files)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 模式切换 */}
      <div className="flex rounded-lg bg-gray-900 p-0.5 gap-0.5">
        {(['drop', 'paste'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 text-xs rounded-md transition-colors
              ${mode === m ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-400'}`}
          >
            {m === 'drop' ? '上传文件' : '粘贴内容'}
          </button>
        ))}
      </div>

      {mode === 'drop' ? (
        <>
          {/* 拖放区域（支持多文件拖入） */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`
              flex flex-col items-center justify-center gap-3 p-6 rounded-xl
              border-2 border-dashed cursor-pointer transition-all
              ${dragging
                ? 'border-blue-500 bg-blue-500/5'
                : 'border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-900'
              }
            `}
          >
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              {dragging
                ? <FileText size={18} className="text-blue-400" />
                : <Upload size={18} className="text-gray-500" />}
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-300">
                {fileCount > 0 ? `正在读取 ${fileCount} 个文件…` : '拖拽文件到此处'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">支持多选 .jsonl 文件</p>
            </div>
            {/* 多选文件 */}
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.json"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) handleFiles(files)
                e.target.value = ''
              }}
            />
          </div>

          {/* 文件夹上传按钮 */}
          <button
            onClick={() => folderRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs
              text-gray-500 hover:text-gray-300 border border-gray-800
              hover:border-gray-600 rounded-lg transition-colors"
          >
            <Folder size={12} />
            选择文件夹（自动读取所有 .jsonl）
          </button>
          {/* 文件夹选择器 */}
          <input
            ref={folderRef}
            type="file"
            // @ts-expect-error webkitdirectory not in TS types
            webkitdirectory=""
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) handleFiles(files)
              e.target.value = ''
            }}
          />
        </>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'{"type":"user","message":{"role":"user","content":"..."}}\n{"type":"assistant",...}'}
            className="w-full h-40 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2
              text-xs text-gray-300 font-mono placeholder-gray-700 resize-none
              focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={() => processText(text)}
            disabled={!text.trim()}
            className="w-full py-2 text-sm font-medium rounded-lg
              bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800
              disabled:text-gray-600 text-white transition-colors"
          >
            加载轨迹
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20
          border border-red-900/50 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
