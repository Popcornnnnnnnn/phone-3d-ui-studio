import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RoomRelay, type CfDurableObjectState, type CfWebSocket } from './index'

class MockCfWebSocket {
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = 1
  sent: string[] = []
  closedWith: { code?: number; reason?: string } | null = null
  private attachment: unknown = undefined

  send(data: string) {
    if (this.readyState !== 1) {
      throw new Error('Socket not open')
    }
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason }
    this.readyState = MockCfWebSocket.CLOSING
  }

  serializeAttachment(value: unknown) {
    this.attachment = value
  }

  deserializeAttachment() {
    return this.attachment
  }

  parsedSent(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
  }
}

class MockDurableObjectState implements CfDurableObjectState {
  private readonly tagged = new Map<string, Set<MockCfWebSocket>>()

  acceptWebSocket(ws: WebSocket, tags: string[] = []) {
    for (const tag of tags) {
      let set = this.tagged.get(tag)
      if (!set) {
        set = new Set()
        this.tagged.set(tag, set)
      }
      set.add(ws as unknown as MockCfWebSocket)
    }
  }

  getWebSockets(tag?: string): WebSocket[] {
    if (!tag) {
      const all = new Set<MockCfWebSocket>()
      for (const set of this.tagged.values()) {
        for (const ws of set) all.add(ws)
      }
      return [...all] as unknown as WebSocket[]
    }
    return [...(this.tagged.get(tag) ?? [])] as unknown as WebSocket[]
  }

  removeSocket(ws: MockCfWebSocket) {
    ws.readyState = MockCfWebSocket.CLOSED
    for (const set of this.tagged.values()) {
      set.delete(ws)
    }
  }
}

describe('RoomRelay Durable Object', () => {
  const originalWebSocketPair = (globalThis as Record<string, unknown>).WebSocketPair
  const originalResponse = globalThis.Response
  let lastCreatedPair: { client: MockCfWebSocket; server: MockCfWebSocket } | null = null

  beforeEach(() => {
    lastCreatedPair = null
    class FakeWebSocketPair {
      0: MockCfWebSocket
      1: MockCfWebSocket
      constructor() {
        this[0] = new MockCfWebSocket()
        this[1] = new MockCfWebSocket()
        lastCreatedPair = { client: this[0], server: this[1] }
      }
    }
    ;(globalThis as Record<string, unknown>).WebSocketPair = FakeWebSocketPair
    // Node's global Response rejects status 101; stub 101 for unit testing CF Workers upgrade response.
    class CfCompatibleResponse extends originalResponse {
      readonly webSocket?: WebSocket
      constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: WebSocket }) {
        if (init?.status === 101) {
          super(null, { ...init, status: 200 })
          Object.defineProperty(this, 'status', { value: 101 })
          this.webSocket = init.webSocket
        } else {
          super(body, init)
        }
      }
    }
    globalThis.Response = CfCompatibleResponse as typeof Response
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).WebSocketPair = originalWebSocketPair
    globalThis.Response = originalResponse
  })

  async function connectRole(relay: RoomRelay, roomCode: string, role: 'desktop' | 'phone') {
    const req = new Request(`https://example.com/api/room/${roomCode}?role=${role}`, {
      headers: { Upgrade: 'websocket' },
    })
    const res = await relay.fetch(req)
    expect(res.status).toBe(101)
    expect(lastCreatedPair).not.toBeNull()
    return lastCreatedPair!.server
  }

  it('ignores superseded 4001 socket close and late messages without emitting false peer-left', async () => {
    const ctx = new MockDurableObjectState()
    const relay = new RoomRelay(ctx)

    const desktop1 = await connectRole(relay, 'ABC234', 'desktop')
    const phone = await connectRole(relay, 'ABC234', 'phone')
    expect(phone.parsedSent()).toEqual([
      { type: 'room-joined', roomCode: 'ABC234', role: 'phone', peerConnected: true },
    ])

    // Desktop 2 replaces Desktop 1
    const desktop2 = await connectRole(relay, 'ABC234', 'desktop')
    expect(desktop1.closedWith).toEqual({ code: 4001, reason: 'Replaced by new connection' })
    expect(desktop2.parsedSent()).toEqual([
      { type: 'room-joined', roomCode: 'ABC234', role: 'desktop', peerConnected: true },
    ])
    expect(phone.parsedSent()).toEqual([
      { type: 'room-joined', roomCode: 'ABC234', role: 'phone', peerConnected: true },
      { type: 'peer-joined', role: 'desktop' },
    ])

    // Late message from superseded desktop1 (even if socket still looks open in runtime) is dropped
    desktop1.readyState = MockCfWebSocket.OPEN
    await relay.webSocketMessage(
      desktop1 as unknown as CfWebSocket,
      JSON.stringify({ type: 'web-action', action: 'toss', strength: 1 }),
    )
    await relay.webSocketMessage(
      desktop1 as unknown as CfWebSocket,
      JSON.stringify({ type: 'ping', atMs: 123 }),
    )
    expect(phone.parsedSent()).toHaveLength(2)
    expect(desktop1.parsedSent().some((m) => m.type === 'pong')).toBe(false)

    // Delayed webSocketClose from superseded desktop1 must NOT emit peer-left
    await relay.webSocketClose(desktop1 as unknown as CfWebSocket)
    ctx.removeSocket(desktop1)
    expect(phone.parsedSent()).toHaveLength(2)

    // Active desktop2 messages still relay cleanly to phone
    await relay.webSocketMessage(
      desktop2 as unknown as CfWebSocket,
      JSON.stringify({ type: 'web-action', action: 'add-ball' }),
    )
    expect(phone.parsedSent().at(-1)).toEqual({ type: 'web-action', action: 'add-ball' })
  })

  it('survives hibernation when superseded close fires on a fresh RoomRelay instance', async () => {
    const ctx = new MockDurableObjectState()
    const relayBeforeSleep = new RoomRelay(ctx)

    const desktop1 = await connectRole(relayBeforeSleep, 'ABC234', 'desktop')
    const phone = await connectRole(relayBeforeSleep, 'ABC234', 'phone')
    const desktop2 = await connectRole(relayBeforeSleep, 'ABC234', 'desktop')

    // Simulate Durable Object hibernation wake-up with a brand-new RoomRelay instance sharing ctx
    const relayAfterWake = new RoomRelay(ctx)

    // Superseded desktop1 close after wake-up must NOT emit peer-left
    await relayAfterWake.webSocketClose(desktop1 as unknown as CfWebSocket)
    ctx.removeSocket(desktop1)
    expect(phone.parsedSent().filter((m) => m.type === 'peer-left')).toHaveLength(0)

    // Active desktop2 close after wake-up DOES emit peer-left once
    await relayAfterWake.webSocketClose(desktop2 as unknown as CfWebSocket)
    ctx.removeSocket(desktop2)
    expect(phone.parsedSent().filter((m) => m.type === 'peer-left')).toEqual([
      { type: 'peer-left', role: 'desktop' },
    ])
  })

  it('does not emit duplicate peer-left across webSocketError -> webSocketClose or late superseded close after active close', async () => {
    const ctx = new MockDurableObjectState()
    const relay = new RoomRelay(ctx)

    const desktop1 = await connectRole(relay, 'ABC234', 'desktop')
    const phone = await connectRole(relay, 'ABC234', 'phone')
    const desktop2 = await connectRole(relay, 'ABC234', 'desktop')

    // Active desktop2 errors then closes
    await relay.webSocketError(desktop2 as unknown as CfWebSocket)
    await relay.webSocketClose(desktop2 as unknown as CfWebSocket)
    ctx.removeSocket(desktop2)

    // Superseded desktop1 finally fires webSocketClose afterwards
    await relay.webSocketClose(desktop1 as unknown as CfWebSocket)
    ctx.removeSocket(desktop1)

    expect(phone.parsedSent().filter((m) => m.type === 'peer-left')).toEqual([
      { type: 'peer-left', role: 'desktop' },
    ])
  })

  it('excludes closing sockets when computing peerConnected during fetch', async () => {
    const ctx = new MockDurableObjectState()
    const relay = new RoomRelay(ctx)

    const phone = await connectRole(relay, 'ABC234', 'phone')
    // Phone transitions to CLOSING before webSocketClose has run
    phone.readyState = MockCfWebSocket.CLOSING

    const desktop = await connectRole(relay, 'ABC234', 'desktop')
    expect(desktop.parsedSent()).toEqual([
      { type: 'room-joined', roomCode: 'ABC234', role: 'desktop', peerConnected: false },
    ])
  })
})
