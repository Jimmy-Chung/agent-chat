'use client'

import { useEffect } from 'react'
import { getWsClient } from '@/lib/ws-client'

export function WsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const client = getWsClient()
    client.connect()
    return () => {
      client.disconnect()
    }
  }, [])

  return <>{children}</>
}
