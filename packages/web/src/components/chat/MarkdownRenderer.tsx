'use client'

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

let highlighterPromise: Promise<import('shiki').Highlighter> | null = null

function getHighlighter(): Promise<import('shiki').Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-dark'],
        langs: [
          'typescript',
          'javascript',
          'python',
          'json',
          'bash',
          'css',
          'html',
          'markdown',
          'tsx',
          'jsx',
          'sql',
          'rust',
          'go',
          'java',
          'yaml',
          'diff',
        ],
      }),
    )
  }
  return highlighterPromise
}

/**
 * Pre-process streaming text to close unclosed markdown syntax.
 * Handles: triple-backtick code blocks, single-backtick inline code, bold (**).
 */
function makeStreamSafe(raw: string): string {
  let text = raw

  // Triple backtick code blocks: if odd count, append closing fence
  const fenceMatches = text.match(/```/g)
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    text += '\n```'
  }

  // Single backtick (inline code): if odd count (ignoring triple backticks by working on text
  // that already has balanced triple backticks), append a closing backtick.
  // We count single backticks that are not part of a triple fence.
  // Simpler approach: count all backtick runs, then check if inline backticks are balanced.
  const singleBacktickCount = (text.match(/(?<!`)`(?!`)/g) || []).length
  if (singleBacktickCount % 2 !== 0) {
    text += '`'
  }

  // Bold (**): if odd count, append closing **
  const boldCount = (text.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    text += '**'
  }

  return text
}

/** React component for lazy syntax-highlighted code blocks. */
function CodeBlock({ code, language }: { code: string; language: string }) {
  // We render server-safe HTML via shiki in an effect and fall back to plain <pre>.
  // For simplicity in streaming, we use a synchronous approach with a cached highlighter.
  return (
    <div
      className="code-block-wrapper"
      style={{
        position: 'relative',
        margin: '0.5rem 0',
        borderRadius: 'var(--radius-lg, 8px)',
        overflow: 'hidden',
      }}
    >
      <HighlightedCode code={code} language={language} />
    </div>
  )
}

/** Inner component that loads shiki asynchronously and renders highlighted code. */
function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    getHighlighter()
      .then((hl) => {
        if (cancelled) return
        try {
          const result = hl.codeToHtml(code, {
            lang: language && hl.getLoadedLanguages().includes(language) ? language : 'text',
            theme: 'github-dark',
          })
          setHtml(result)
        } catch {
          setHtml(null)
        }
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  if (html) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ fontSize: '0.8125rem', lineHeight: '1.5' }}
      />
    )
  }

  // Fallback: plain code block
  return (
    <pre
      style={{
        margin: 0,
        padding: '0.75rem 1rem',
        backgroundColor: 'var(--glass-2, #1e1e2e)',
        color: 'var(--fg-primary, #e0e0e0)',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '0.8125rem',
        lineHeight: '1.5',
        overflowX: 'auto',
        borderRadius: 'var(--radius-lg, 8px)',
      }}
    >
      <code>{code}</code>
    </pre>
  )
}

import * as React from 'react'

interface MarkdownRendererProps {
  content: string
  isStreaming?: boolean
}

export function MarkdownRenderer({ content, isStreaming = false }: MarkdownRendererProps) {
  const processedContent = useMemo(() => {
    if (!isStreaming) return content
    return makeStreamSafe(content)
  }, [content, isStreaming])

  const components = useMemo<Components>(
    () => ({
      code({ className, children, ...props }) {
        const langMatch = className?.match(/language-(\w+)/)
        const language = langMatch?.[1] ?? ''
        const codeString = String(children).replace(/\n$/, '')

        // If there's a language class or the code contains newlines, treat as block
        if (language || codeString.includes('\n')) {
          return <CodeBlock code={codeString} language={language} />
        }

        // Inline code
        return (
          <code
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.8125rem',
              backgroundColor: 'var(--glass-1, rgba(255,255,255,0.06))',
              padding: '0.125rem 0.375rem',
              borderRadius: 'var(--radius-sm, 4px)',
              color: 'var(--fg-primary)',
            }}
            {...props}
          >
            {children}
          </code>
        )
      },
      pre({ children }) {
        // Remove default <pre> wrapper since CodeBlock handles its own container
        return <>{children}</>
      },
      a({ href, children, ...props }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent, #4a9eff)', textDecoration: 'underline' }}
            {...props}
          >
            {children}
          </a>
        )
      },
      table({ children }) {
        return (
          <div style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
            <table
              style={{
                borderCollapse: 'collapse',
                width: '100%',
                fontSize: '0.8125rem',
              }}
            >
              {children}
            </table>
          </div>
        )
      },
      th({ children }) {
        return (
          <th
            style={{
              border: '1px solid var(--stroke-inner, rgba(255,255,255,0.1))',
              padding: '0.375rem 0.75rem',
              textAlign: 'left',
              fontWeight: 600,
              color: 'var(--fg-primary)',
            }}
          >
            {children}
          </th>
        )
      },
      td({ children }) {
        return (
          <td
            style={{
              border: '1px solid var(--stroke-inner, rgba(255,255,255,0.1))',
              padding: '0.375rem 0.75rem',
              color: 'var(--fg-primary)',
            }}
          >
            {children}
          </td>
        )
      },
      p({ children }) {
        return (
          <p style={{ margin: '0.375rem 0', lineHeight: '1.6' }}>
            {children}
          </p>
        )
      },
      ul({ children }) {
        return (
          <ul
            style={{
              margin: '0.375rem 0',
              paddingLeft: '1.25rem',
              listStyleType: 'disc',
            }}
          >
            {children}
          </ul>
        )
      },
      ol({ children }) {
        return (
          <ol
            style={{
              margin: '0.375rem 0',
              paddingLeft: '1.25rem',
              listStyleType: 'decimal',
            }}
          >
            {children}
          </ol>
        )
      },
      li({ children }) {
        return (
          <li style={{ margin: '0.125rem 0', lineHeight: '1.6' }}>
            {children}
          </li>
        )
      },
      blockquote({ children }) {
        return (
          <blockquote
            style={{
              borderLeft: '3px solid var(--accent, #4a9eff)',
              margin: '0.5rem 0',
              padding: '0.25rem 0.75rem',
              color: 'var(--fg-dim)',
            }}
          >
            {children}
          </blockquote>
        )
      },
      h1({ children }) {
        return (
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0.75rem 0 0.375rem' }}>
            {children}
          </h1>
        )
      },
      h2({ children }) {
        return (
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: '0.625rem 0 0.375rem' }}>
            {children}
          </h2>
        )
      },
      h3({ children }) {
        return (
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>
            {children}
          </h3>
        )
      },
      hr() {
        return (
          <hr
            style={{
              border: 'none',
              borderTop: '1px solid var(--stroke-inner, rgba(255,255,255,0.1))',
              margin: '0.75rem 0',
            }}
          />
        )
      },
    }),
    [],
  )

  return (
    <div
      className="markdown-body"
      style={{
        fontSize: '0.875rem',
        lineHeight: '1.6',
        color: 'var(--fg-primary)',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
