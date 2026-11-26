import { normalizeRoomCode, parseWebPlayMessage } from '../../shared/webPlayProtocol.mjs'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ROOM_RELAY: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

interface CfWebSocket extends WebSocket {
  serializeAttachment?(value: unknown): void
  deserializeAttachment?(): unknown
}

interface CfDurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

const RELAYED_TYPES = new Set([
  'rtc-offer',
  'rtc-answer',
  'rtc-ice',
  'web-pose',
  'web-action',
  'web-ui-event',
  'web-world',
])

export class RoomRelay {
  private readonly ctx: CfDurableObjectState

  constructor(ctx: CfDurableObjectState) {
    this.ctx = ctx
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/)
    const roomCode = match ? normalizeRoomCode(decodeURIComponent(match[1])) : null
    const role = url.searchParams.get('role')
    if (!roomCode || (role !== 'desktop' && role !== 'phone')) {
      return new Response('Invalid room code or role', { status: 400 })
    }

    const pair = new (globalThis as unknown as {
      WebSocketPair: new () => { 0: WebSocket; 1: CfWebSocket }
    }).WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    for (const existing of this.ctx.getWebSockets(role)) {
      try {
        existing.close(4001, 'Replaced by new connection')
      } catch {
        // ignore
      }
    }

    this.ctx.acceptWebSocket(server, [role])
    server.serializeAttachment?.({ role })

    const peerRole = role === 'desktop' ? 'phone' : 'desktop'
    const peers = this.ctx.getWebSockets(peerRole)

    server.send(
      JSON.stringify({
        type: 'room-joined',
        roomCode,
        role,
        peerConnected: peers.length > 0,
      }),
    )

    for (const peer of peers) {
      try {
        peer.send(JSON.stringify({ type: 'peer-joined', role }))
      } catch {
        // ignore closed peer
      }
    }

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    let json: unknown
    try {
      json = JSON.parse(message)
    } catch {
      return
    }
    const parsed = parseWebPlayMessage(json)
    if (!parsed) return

    if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', atMs: parsed.atMs }))
      return
    }
    if (!RELAYED_TYPES.has(parsed.type)) return

    const attachment = ws.deserializeAttachment?.() as { role?: 'desktop' | 'phone' } | undefined
    const role = attachment?.role
    if (role !== 'desktop' && role !== 'phone') return
    const peerRole = role === 'desktop' ? 'phone' : 'desktop'

    const payload = JSON.stringify(parsed)
    for (const peer of this.ctx.getWebSockets(peerRole)) {
      try {
        peer.send(payload)
      } catch {
        // ignore
      }
    }
  }

  async webSocketClose(ws: CfWebSocket) {
    const attachment = ws.deserializeAttachment?.() as { role?: 'desktop' | 'phone' } | undefined
    const role = attachment?.role
    if (role !== 'desktop' && role !== 'phone') return
    const peerRole = role === 'desktop' ? 'phone' : 'desktop'
    const payload = JSON.stringify({ type: 'peer-left', role })
    for (const peer of this.ctx.getWebSockets(peerRole)) {
      try {
        peer.send(payload)
      } catch {
        // ignore
      }
    }
  }

  async webSocketError(ws: CfWebSocket) {
    await this.webSocketClose(ws)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/)
    if (match) {
      const code = normalizeRoomCode(decodeURIComponent(match[1]))
      if (!code) {
        return new Response('Invalid room code', { status: 400 })
      }
      const id = env.ROOM_RELAY.idFromName(code)
      const stub = env.ROOM_RELAY.get(id)
      return stub.fetch(request)
    }

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'phone-3d-ui-studio' })
    }

    return env.ASSETS.fetch(request)
  },
}
