import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  // Overridable so an isolated dev instance (e.g. e2e against local wrangler)
  // doesn't share .next with an already-running dev server and corrupt chunks.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@agent-chat/protocol'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
  allowedDevOrigins: ['127.0.0.1', 'localhost', '.jimmy-jam.com'],
}

export default nextConfig
