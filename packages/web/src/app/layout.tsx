import type { Metadata, Viewport } from 'next'
import './globals.css'
import { WsProvider } from '@/components/WsProvider'

export const metadata: Metadata = {
  title: 'agent-chat',
  description: 'Agent-friendly personal IM',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0b0c0f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <WsProvider>{children}</WsProvider>
      </body>
    </html>
  )
}
