import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@agent-chat/protocol'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
  allowedDevOrigins: ['127.0.0.1', 'localhost', '.jimmy-jam.com'],
}

export default nextConfig
