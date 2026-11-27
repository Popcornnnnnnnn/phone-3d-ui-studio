import {
  normalizeRoomCode,
  parseWebPlayMessage,
  ROOM_REPLACED_CLOSE_CODE,
} from '../../shared/webPlayProtocol.mjs'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ROOM_RELAY: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

type Role = 'desktop' | 'phone'

interface SocketAttachment {
  role?: Role
  connId?: string
  generation?: number
  superseded?: boolean
  closed?: boolean
}

export interface CfWebSocket extends WebSocket {
  serializeAttachment?(value: unknown): void
  deserializeAttachment?(): unknown
}

export interface CfDurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

const WS_CLOSING = 2
const WS_CLOSED = 3

const RELAYED_TYPES = new Set([
  'rtc-offer',
  'rtc-answer',
  'rtc-ice',
  'web-pose',
  'web-action',
  'web-ui-event',
  'web-device',
  'web-world',
])

function readAttachment(ws: CfWebSocket): SocketAttachment | undefined {
  try {
    const raw = ws.deserializeAttachment?.()
    if (raw && typeof raw === 'object') {
      return raw as SocketAttachment
    }
  } catch {
    // ignore
  }
  return undefined
}

function writeAttachment(ws: CfWebSocket, value: SocketAttachment): void {
  try {
    ws.serializeAttachment?.(value)
  } catch {
    // ignore closed/closing socket attachment errors
  }
}

function isRole(value: unknown): value is Role {
  return value === 'desktop' || value === 'phone'
}

export class RoomRelay {
  private readonly ctx: CfDurableObjectState
  private readonly inactiveSockets = new WeakSet<CfWebSocket>()
  private readonly activeConnIds: Record<Role, string | null> = { desktop: null, phone: null }
  private readonly generations: Record<Role, number> = { desktop: 0, phone: 0 }
  private connSeq = 0

  constructor(ctx: CfDurableObjectState) {
    this.ctx = ctx
  }

  private nextConnId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    this.connSeq += 1
    return `conn-${Date.now()}-${this.connSeq}`
  }

  private isSocketOpen(ws: CfWebSocket): boolean {
    const state = (ws as { readyState?: number }).readyState
    return state !== WS_CLOSING && state !== WS_CLOSED
  }

  private isSocketActive(ws: CfWebSocket, expectedRole?: Role): boolean {
    if (this.inactiveSockets.has(ws)) return false
    if (!this.isSocketOpen(ws)) return false
    const attachment = readAttachment(ws)
    if (attachment?.superseded || attachment?.closed) return false
    if (expectedRole && attachment?.role && attachment.role !== expectedRole) return false
    const role = expectedRole ?? attachment?.role
    if (role && isRole(role)) {
      const currentConnId = this.activeConnIds[role]
      if (currentConnId && attachment?.connId && attachment.connId !== currentConnId) {
        return false
      }
    }
    return true
  }

  private getActiveSockets(role: Role): CfWebSocket[] {
    const sockets = this.ctx.getWebSockets(role) as CfWebSocket[]
    const active = sockets.filter((sock) => this.isSocketActive(sock, role))
    if (active.length <= 1) return active
    let maxGen = -1
    for (const sock of active) {
      const gen = readAttachment(sock)?.generation ?? 0
      if (gen > maxGen) maxGen = gen
    }
    return active.filter((sock) => (readAttachment(sock)?.generation ?? 0) === maxGen)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/)
    const roomCode = match ? normalizeRoomCode(decodeURIComponent(match[1])) : null
    const role = url.searchParams.get('role')
    if (!roomCode || !isRole(role)) {
      return new Response('Invalid room code or role', { status: 400 })
    }

    const pair = new (globalThis as unknown as {
      WebSocketPair: new () => { 0: WebSocket; 1: CfWebSocket }
    }).WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    const existingSockets = this.ctx.getWebSockets(role) as CfWebSocket[]
    let maxGen = this.generations[role]
    for (const existing of existingSockets) {
      const prev = readAttachment(existing)
      if (typeof prev?.generation === 'number' && prev.generation > maxGen) {
        maxGen = prev.generation
      }
      this.inactiveSockets.add(existing)
      writeAttachment(existing, {
        ...prev,
        role,
        superseded: true,
      })
      try {
        existing.close(ROOM_REPLACED_CLOSE_CODE, 'Replaced by new connection')
      } catch {
        // ignore
      }
    }

    const generation = maxGen + 1
    const connId = this.nextConnId()
    this.generations[role] = generation
    this.activeConnIds[role] = connId

    this.ctx.acceptWebSocket(server, [role])
    writeAttachment(server, {
      role,
      connId,
      generation,
      superseded: false,
      closed: false,
    })

    const peerRole: Role = role === 'desktop' ? 'phone' : 'desktop'
    const peers = this.getActiveSockets(peerRole)

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

    const attachment = readAttachment(ws)
    const role = attachment?.role
    if (!isRole(role)) return
    if (!this.isSocketActive(ws, role)) return
    const activeForRole = this.getActiveSockets(role)
    if (!activeForRole.includes(ws)) return

    let json: unknown
    try {
      json = JSON.parse(message)
    } catch {
      return
    }
    const parsed = parseWebPlayMessage(json)
    if (!parsed) return

    if (parsed.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong', atMs: parsed.atMs }))
      } catch {
        // ignore
      }
      return
    }
    if (!RELAYED_TYPES.has(parsed.type)) return

    const peerRole: Role = role === 'desktop' ? 'phone' : 'desktop'
    const payload = JSON.stringify(parsed)
    for (const peer of this.getActiveSockets(peerRole)) {
      try {
        peer.send(payload)
      } catch {
        // ignore
      }
    }
  }

  private handleSocketClose(ws: CfWebSocket) {
    const attachment = readAttachment(ws)
    const role = attachment?.role
    if (!isRole(role)) return
    if (this.inactiveSockets.has(ws) || attachment?.superseded || attachment?.closed) return

    this.inactiveSockets.add(ws)
    writeAttachment(ws, {
      ...attachment,
      role,
      closed: true,
    })
    if (attachment?.connId && this.activeConnIds[role] === attachment.connId) {
      this.activeConnIds[role] = null
    }

    const remainingActive = this.getActiveSockets(role).filter((sock) => sock !== ws)
    if (remainingActive.length > 0) return

    const peerRole: Role = role === 'desktop' ? 'phone' : 'desktop'
    const payload = JSON.stringify({ type: 'peer-left', role })
    for (const peer of this.getActiveSockets(peerRole)) {
      try {
        peer.send(payload)
      } catch {
        // ignore
      }
    }
  }

  async webSocketClose(ws: CfWebSocket) {
    this.handleSocketClose(ws)
  }

  async webSocketError(ws: CfWebSocket) {
    this.handleSocketClose(ws)
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
