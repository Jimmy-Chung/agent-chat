import { NextRequest, NextResponse } from 'next/server'

const PI_ADAPTER_URL = process.env.PI_ADAPTER_URL || ''
const PI_ADAPTER_TOKEN = process.env.PI_ADAPTER_TOKEN || ''

function getMcpEndpoint(): string {
  const url = new URL(PI_ADAPTER_URL)
  const proto = url.protocol === 'wss:' ? 'https:' : 'http:'
  return `${proto}//${url.host}/api/agent-chat/v1/mcp`
}

function parseCommand(cmd: string): { command: string; args: string[] } {
  const parts = cmd.trim().split(/\s+/)
  return { command: parts[0], args: parts.slice(1) }
}

export async function POST(req: NextRequest) {
  if (!PI_ADAPTER_URL) {
    return NextResponse.json({ error: 'PI_ADAPTER_URL not configured' }, { status: 500 })
  }

  const body = await req.json()

  // Transform flat command string into adapter's spec format
  const adapterBody: Record<string, unknown> = {
    action: body.action,
    name: body.name,
    scope: body.scope,
    projectDir: body.projectDir,
  }
  if (body.action === 'add' && typeof body.command === 'string' && body.command.trim()) {
    const parsed = parseCommand(body.command)
    adapterBody.spec = {
      transport: 'stdio',
      command: parsed.command,
      args: parsed.args,
    }
  }

  const mcpUrl = getMcpEndpoint()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (PI_ADAPTER_TOKEN) headers['Authorization'] = `Bearer ${PI_ADAPTER_TOKEN}`

  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(adapterBody),
    signal: AbortSignal.timeout(15_000),
  })

  const text = await res.text()

  if (!res.ok) {
    return NextResponse.json(
      { error: `adapter returned HTTP ${res.status}`, detail: text.slice(0, 500) },
      { status: res.status },
    )
  }

  return new NextResponse(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
