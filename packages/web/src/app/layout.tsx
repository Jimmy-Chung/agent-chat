import type { Metadata, Viewport } from 'next'
import './globals.css'
import { WsProvider } from '@/components/WsProvider'
import { PushSetup } from '@/components/PushSetup'
import { ToastViewport } from '@/components/ToastViewport'

export const metadata: Metadata = {
  title: 'Helm',
  description: 'Take the helm of your CLI agents — PI, Claude Code & Codex from one GUI.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
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
        <PushSetup />
        <ToastViewport />
      </body>
    </html>
  )
}
