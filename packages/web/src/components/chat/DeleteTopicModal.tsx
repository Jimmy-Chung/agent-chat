'use client'

import { useState, useEffect, useCallback } from 'react'
import { useArtifactStore } from '@/stores/artifact-store'
import { getWsClient } from '@/lib/ws-client'

const EMPTY_ARTIFACTS: import('@agent-chat/protocol').Artifact[] = []

const MIME_CHIP: Record<string, { bg: string; color: string; border: string; label: string }> = {
  xlsx: { bg: 'rgba(48,209,88,.16)', color: '#6FE39A', border: 'rgba(48,209,88,.30)', label: 'XLS' },
  xls: { bg: 'rgba(48,209,88,.16)', color: '#6FE39A', border: 'rgba(48,209,88,.30)', label: 'XLS' },
  pdf: { bg: 'rgba(255,69,58,.16)', color: '#FF8B82', border: 'rgba(255,69,58,.30)', label: 'PDF' },
  png: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'PNG' },
  jpg: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'JPG' },
  jpeg: { bg: 'rgba(142,140,255,.18)', color: '#B9B7FF', border: 'rgba(142,140,255,.34)', label: 'JPG' },
  md: { bg: 'rgba(247,194,107,.16)', color: 'var(--role-cron)', border: 'rgba(247,194,107,.32)', label: 'MD' },
  json: { bg: 'var(--glass-2)', color: 'var(--fg-regular)', border: 'var(--hairline)', label: 'JSON' },
  csv: { bg: 'rgba(48,209,88,.10)', color: '#6FE39A', border: 'rgba(48,209,88,.22)', label: 'CSV' },
}

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface DeleteTopicModalProps {
  topicId: string
  topicName: string
  onClose: () => void
}

export function DeleteTopicModal({ topicId, topicName, onClose }: DeleteTopicModalProps) {
  const [strategy, setStrategy] = useState<'pool' | 'delete'>('delete')
  const topicArtifacts = useArtifactStore((s) => s.byTopic[topicId] ?? EMPTY_ARTIFACTS)
  const artifactCount = topicArtifacts.length

  const handleDelete = useCallback(() => {
    getWsClient().send({
      type: 'topic.delete',
      data: {
        id: topicId,
        artifactStrategy: strategy,
      },
    })
    onClose()
  }, [topicId, strategy, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Build mime chips for preview row
  const extCounts: Record<string, number> = {}
  for (const a of topicArtifacts) {
    const ext = getExt(a.name)
    extCounts[ext] = (extCounts[ext] ?? 0) + 1
  }
  const uniqueExts = Object.keys(extCounts).slice(0, 4)
  const overflowCount = artifactCount - uniqueExts.length

  // Summary text
  const names = topicArtifacts.slice(0, 2).map((a) => a.name)
  const summaryPrefix = names.join('、')
  const totalSize = topicArtifacts.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden"
        style={{
          width: 'min(480px, calc(100vw - 32px))',
          borderRadius: 'var(--r-modal, 24px)',
          background: 'var(--glass-modal, rgba(20,22,27,0.72))',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)',
          backdropFilter: 'blur(60px) saturate(200%)',
          border: '1px solid var(--hairline-2, rgba(255,255,255,0.14))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,69,58,0.08)',
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3.5" style={{ padding: '22px 24px 14px' }}>
          <div
            className="grid shrink-0 place-items-center"
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: 'rgba(255,69,58,.14)',
              border: '1px solid rgba(255,69,58,.32)',
              color: '#FF8B82',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 0 22px rgba(255,69,58,.16)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--fg-strong)' }}>
              删除 <span style={{ color: 'var(--fg-strong)' }}>「{topicName}」</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--fg-regular)', letterSpacing: '-0.005em', lineHeight: 1.5 }}>
              {artifactCount > 0 ? (
                <>此话题包含 <b style={{ color: 'var(--fg-strong)', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{artifactCount}</b> 个产物引用，删除话题前请选择这些引用的处理方式：</>
              ) : (
                <>删除此话题? 对话历史将被清除,无法恢复。</>
              )}
            </div>
          </div>
        </div>

        {/* Artifact preview row */}
        {artifactCount > 0 && (
          <div
            className="flex items-center gap-2"
            style={{ margin: '2px 24px 4px', padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,.28)', border: '1px solid var(--hairline)', fontSize: 11.5, color: 'var(--fg-dim)' }}
          >
            <div className="flex items-center">
              {uniqueExts.map((ext) => {
                const chip = MIME_CHIP[ext]
                return (
                  <div
                    key={ext}
                    className="grid place-items-center"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8.5,
                      fontWeight: 700,
                      letterSpacing: '.04em',
                      marginLeft: -6,
                      border: '1px solid rgba(0,0,0,.4)',
                      boxShadow: '0 1px 3px rgba(0,0,0,.4)',
                      background: chip?.bg ?? 'var(--glass-1)',
                      color: chip?.color ?? 'var(--fg-regular)',
                      ...(uniqueExts.indexOf(ext) === 0 ? { marginLeft: 0 } : {}),
                    }}
                  >
                    {chip?.label ?? ext.toUpperCase().slice(0, 3)}
                  </div>
                )
              })}
              {overflowCount > 0 && (
                <div
                  className="grid place-items-center"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8.5,
                    fontWeight: 700,
                    marginLeft: -6,
                    background: 'var(--glass-1)',
                    color: 'var(--fg-regular)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  +{overflowCount}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1" style={{ color: 'var(--fg-regular)', fontSize: 12.5 }}>
              {summaryPrefix && <b style={{ color: 'var(--fg-strong)', fontWeight: 600 }}>{summaryPrefix}</b>}
              {artifactCount > 2 ? ` 等 ${artifactCount} 个文件` : artifactCount === 2 ? '' : ''}
              {totalSize > 0 ? ` · 共 ${formatSize(totalSize)}` : ''}
            </div>
          </div>
        )}

        {/* Radio options */}
        {artifactCount > 0 && (
          <div className="flex flex-col gap-2.5" style={{ padding: '14px 16px 4px' }}>
            {/* Option 1: Pool */}
            <button
              type="button"
              onClick={() => setStrategy('pool')}
              className="flex items-start gap-3 text-left transition-all duration-150"
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                border: strategy === 'pool' ? '1px solid rgba(10,132,255,.42)' : '1px solid var(--hairline)',
                background: strategy === 'pool' ? 'rgba(10,132,255,.10)' : 'rgba(255,255,255,0.03)',
                boxShadow: strategy === 'pool' ? 'inset 0 0 0 1px rgba(10,132,255,.18)' : 'none',
              }}
            >
              <div
                className="mt-0.5 grid shrink-0 place-items-center"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: strategy === 'pool' ? '1.5px solid var(--role-user)' : '1.5px solid var(--hairline-2)',
                  background: strategy === 'pool' ? 'rgba(10,132,255,.18)' : 'rgba(0,0,0,.18)',
                }}
              >
                {strategy === 'pool' && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--role-user)', boxShadow: '0 0 6px rgba(10,132,255,.55)' }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>
                  保留引用到产物池
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.5, letterSpacing: '-0.005em' }}>
                  {artifactCount} 个产物引用会迁移到 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4 }}>系统话题 · 产物池</code>，后续在任何话题里都能用 <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'rgba(0,0,0,.32)', border: '1px solid var(--hairline)', padding: '0 5px', borderRadius: 4 }}>@</code> 引用。不会删除 adapter 本机文件。
                </div>
              </div>
            </button>

            {/* Option 2: Delete */}
            <button
              type="button"
              onClick={() => setStrategy('delete')}
              className="flex items-start gap-3 text-left transition-all duration-150"
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                border: strategy === 'delete' ? '1px solid rgba(10,132,255,.42)' : '1px solid var(--hairline)',
                background: strategy === 'delete' ? 'rgba(10,132,255,.10)' : 'rgba(255,255,255,0.03)',
                boxShadow: strategy === 'delete' ? 'inset 0 0 0 1px rgba(10,132,255,.18)' : 'none',
              }}
            >
              <div
                className="mt-0.5 grid shrink-0 place-items-center"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: strategy === 'delete' ? '1.5px solid var(--role-user)' : '1.5px solid var(--hairline-2)',
                  background: strategy === 'delete' ? 'rgba(10,132,255,.18)' : 'rgba(0,0,0,.18)',
                }}
              >
                {strategy === 'delete' && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--role-user)', boxShadow: '0 0 6px rgba(10,132,255,.55)' }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-strong)', letterSpacing: '-0.01em' }}>
                  删除这些产物引用
                  <span
                    className="inline-flex items-center gap-1"
                    style={{
                      height: 18,
                      padding: '0 7px',
                      borderRadius: 9,
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: '.04em',
                      background: 'rgba(48,209,88,.14)',
                      color: '#6FE39A',
                      border: '1px solid rgba(48,209,88,.30)',
                      textTransform: 'uppercase',
                    }}
                  >
                    默认
                  </span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--fg-dim)', lineHeight: 1.5, letterSpacing: '-0.005em' }}>
                  从 agent-chat 移除这 {artifactCount} 个引用，不进入产物池；不会删除 adapter 本机文件。话题对话历史会被删除，<b style={{ color: '#FFAFA8', fontWeight: 600 }}>无法恢复</b>。
                </div>
              </div>
            </button>
          </div>
        )}

        {/* No artifacts: simple delete */}
        {artifactCount === 0 && <div style={{ height: 14 }} />}

        {/* Footer */}
        <div
          className="flex items-center gap-2.5"
          style={{
            marginTop: 14,
            padding: '14px 20px',
            borderTop: '1px solid var(--hairline)',
            background: 'rgba(0,0,0,0.20)',
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            <kbd style={{ background: 'var(--glass-1)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10, color: 'var(--fg-regular)' }}>Esc</kbd>
            {' '}取消
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center"
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                background: 'var(--glass-1)',
                border: '1px solid var(--hairline)',
                color: 'var(--fg-regular)',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5"
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                background: 'linear-gradient(180deg, #FF6B62 0%, #FF453A 50%, #C82A1F 100%)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.20), inset 0 -1px 0 rgba(0,0,0,.15), 0 4px 14px rgba(255,69,58,.32)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 6" />
              </svg>
              确认删除
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
