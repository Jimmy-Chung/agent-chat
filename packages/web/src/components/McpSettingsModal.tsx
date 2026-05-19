'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sendMcpCommand } from '@/lib/ws-client'

interface McpServerEntry {
  name: string
  detail: string
  scope: string
}

interface McpSettingsModalProps {
  onClose: () => void
  projectDir?: string
  topicName?: string
}

function parseListOutput(stdout: string): McpServerEntry[] {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const entries: McpServerEntry[] = []
  for (const line of lines) {
    const match = line.match(/^([^:\s]+):\s*(.+?)(?:\s+\(([^)]+)\))?$/)
    if (!match) continue
    entries.push({ name: match[1], detail: match[2].trim(), scope: '' })
  }
  return entries
}

export function McpSettingsModal({ onClose, projectDir, topicName }: McpSettingsModalProps) {
  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addCommand, setAddCommand] = useState('')

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await sendMcpCommand({ action: 'list', projectDir })
      if (result.exitCode === 0) {
        if (result.servers && result.servers.length > 0) {
          const parsed = parseListOutput(result.stdout)
          const merged = parsed.map((p, i) => ({
            ...p,
            scope: (result.servers?.[i])?.scope ?? 'unknown',
          }))
          setServers(merged.filter((p) => p.name))
        } else {
          setServers(parseListOutput(result.stdout))
        }
      } else {
        setError(result.stderr || `claude mcp list exited with ${result.exitCode}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectDir])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleRemove = useCallback(async (name: string) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return
    setBusyAction(`remove:${name}`)
    setError(null)
    try {
      const result = await sendMcpCommand({ action: 'remove', name, scope: 'project', projectDir })
      if (result.exitCode !== 0) {
        setError(result.stderr || `remove failed (exit ${result.exitCode})`)
      }
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }, [loadList, projectDir])

  const handleAdd = useCallback(async () => {
    const trimmedName = addName.trim()
    const trimmedCmd = addCommand.trim()
    if (!trimmedName) { setError('Name is required'); return }
    if (!trimmedCmd) { setError('Command or URL is required'); return }

    setBusyAction('add')
    setError(null)
    try {
      const result = await sendMcpCommand({ action: 'add', name: trimmedName, command: trimmedCmd, scope: 'project', projectDir })
      if (result.exitCode !== 0) {
        setError(result.stderr || `add failed (exit ${result.exitCode})`)
      } else {
        setAddName('')
        setAddCommand('')
      }
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }, [addName, addCommand, loadList, projectDir])

  const userServers = servers.filter((s) => s.scope === 'user')
  const projectServers = servers.filter((s) => s.scope !== 'user')
  const hasProject = !!projectDir

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col overflow-hidden rounded-2xl"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--hairline)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--fg-strong)' }}>MCP servers</div>
            <div className="text-[12px]" style={{ color: 'var(--fg-dim)' }}>
              {hasProject ? `话题: ${topicName || projectDir}` : '全局配置'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[13px]" style={{ color: 'var(--fg-dim)' }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(255,69,58,0.10)', color: '#FF8B82', border: '1px solid rgba(255,69,58,0.20)' }}>
              {error}
            </div>
          )}

          {/* User scope — read only */}
          {userServers.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12.5px] font-medium" style={{ color: 'var(--fg-regular)' }}>全局 (User)</span>
                <span className="text-[11px]" style={{ color: 'var(--fg-dim)' }}>只读</span>
              </div>
              <ul className="space-y-2">
                {userServers.map((s) => (
                  <li key={s.name} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px]" style={{ color: 'var(--fg-strong)' }}>{s.name}</div>
                      <div className="truncate text-[11.5px]" style={{ color: 'var(--fg-dim)' }}>{s.detail}</div>
                    </div>
                    <span className="text-[10.5px] rounded px-1.5 py-0.5" style={{ color: 'var(--fg-dim)', background: 'var(--glass-2)' }}>user</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Project scope — editable */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-medium" style={{ color: 'var(--fg-regular)' }}>
                {hasProject ? '项目 (Project)' : '项目 (Project)'}
              </span>
              <button type="button" onClick={() => void loadList()} disabled={loading} className="rounded-md px-2 py-1 text-[11.5px]" style={{ color: 'var(--fg-dim)', border: '1px solid var(--hairline)' }}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {projectServers.length === 0 ? (
              <div className="rounded-lg px-3 py-3 text-[12.5px]" style={{ background: 'var(--glass-1)', color: 'var(--fg-dim)' }}>
                {loading ? '加载中…' : '暂无项目级 MCP server'}
              </div>
            ) : (
              <ul className="space-y-2">
                {projectServers.map((s) => (
                  <li key={s.name} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px]" style={{ color: 'var(--fg-strong)' }}>{s.name}</div>
                      <div className="truncate text-[11.5px]" style={{ color: 'var(--fg-dim)' }}>{s.detail}</div>
                    </div>
                    <button type="button" onClick={() => void handleRemove(s.name)} disabled={busyAction === `remove:${s.name}`} className="rounded-md px-2 py-1 text-[11.5px]" style={{ color: '#FF8B82', border: '1px solid rgba(255,69,58,0.22)' }}>
                      {busyAction === `remove:${s.name}` ? '…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add form */}
          <section>
            <div className="mb-2 text-[12.5px] font-medium" style={{ color: 'var(--fg-regular)' }}>添加 MCP server</div>
            {!hasProject && (
              <div className="mb-3 rounded-lg px-3 py-2 text-[11.5px]" style={{ background: 'rgba(255,214,10,0.07)', color: '#F7C26B', border: '1px solid rgba(255,214,10,0.18)' }}>
                当前话题未设置工作目录，将添加为用户级 MCP server。
              </div>
            )}
            <div className="space-y-2">
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="名称 (例如 linear-server)" className="w-full rounded-md px-3 py-2 text-[13px]" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-strong)' }} />
              <input value={addCommand} onChange={(e) => setAddCommand(e.target.value)} placeholder="命令或 URL (例如 npx -y @linear/mcp-server)" className="w-full rounded-md px-3 py-2 text-[13px] font-mono" style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', color: 'var(--fg-strong)' }} />
              <button type="button" onClick={() => void handleAdd()} disabled={busyAction === 'add' || !addName.trim() || !addCommand.trim()} className="rounded-md px-3 py-1.5 text-[12.5px]" style={{ background: 'rgba(10,132,255,0.14)', color: '#6cb1ff', border: '1px solid rgba(10,132,255,0.30)' }}>
                {busyAction === 'add' ? 'Adding…' : 'Add'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
