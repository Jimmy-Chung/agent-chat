import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@agent-chat/protocol'],
}

export default nextConfig
