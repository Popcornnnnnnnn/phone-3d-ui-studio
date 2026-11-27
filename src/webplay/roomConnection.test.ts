import { describe, expect, it, vi } from 'vitest'
import { generateRoomCode, normalizeRoomCode, formatRoomCode, parseWebPlayMessage } from '../../shared/webPlayProtocol.mjs'
import { RoomConnection, type RoomConnectionStatus } from './roomConnection'

class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 'closed'; this.onclose?.() }
  open() { this.readyState = 'open'; this.onopen?.() }
}

class FakeWebSocket {
  static OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null = null
  send(data: string) { this.sent.push(data) }
  close(code?: number, reason?: string) {
    this.closed = true
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  emitOpen() { this.onopen?.() }
  emitJson(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  emitClose(code = 1006, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
}

describe('webPlayProtocol and RoomConnection', () => {
  it('generates, normalizes, and formats 6-character unambiguous room codes', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(normalizeRoomCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `)).toBe(code)
    expect(formatRoomCode(code)).toBe(`${code.slice(0, 3)}-${code.slice(3)}`)
    expect(normalizeRoomCode('O0I1L!')).toBeNull()
  })

  it('validates web-pose, web-action, web-ui-event, and web-device packets', () => {
    expect(parseWebPlayMessage({ type: 'web-action', action: 'toss', strength: 1.1 })).toEqual({
      type: 'web-action',
      action: 'toss',
      strength: 1.1,
    })
    expect(parseWebPlayMessage({ type: 'web-pose', seq: 1, sentAtMs: 100, quaternion: [0, 0, 0, 1] })).not.toBeNull()
    expect(parseWebPlayMessage({ type: 'web-pose', seq: -1, sentAtMs: 100, quaternion: [0, 0, 0, 1] })).toBeNull()
    expect(parseWebPlayMessage({
      type: 'web-device',
      platform: 'android',
      screenWidth: 412,
      screenHeight: 915,
      dpr: 2.625,
      modelHint: 'Pixel 9 Pro',
      preferredProfileId: 'android-adaptive',
      preferredFinishId: 'deep-blue',
    })).toEqual({
      type: 'web-device',
      platform: 'android',
      screenWidth: 412,
      screenHeight: 915,
      dpr: 2.625,
      modelHint: 'Pixel 9 Pro',
      preferredProfileId: 'android-adaptive',
      preferredFinishId: 'deep-blue',
    })
    expect(parseWebPlayMessage({ type: 'web-device', platform: 'ios', screenWidth: 50, screenHeight: 800, dpr: 3 })).toBeNull()
  })

  it('transitions waiting-peer -> paired-relay -> paired-p2p and routes messages over DataChannel once open', async () => {
    const statuses: RoomConnectionStatus[] = []
    const received: unknown[] = []
    let socketInstance: FakeWebSocket | null = null
    let dcInstance: FakeDataChannel | null = null

    function MockWS() {
      const ws = new FakeWebSocket()
      socketInstance = ws
      return ws
    }
    class MockPC {
      onicecandidate: unknown = null
      onconnectionstatechange: unknown = null
      ondatachannel: unknown = null
      createDataChannel() {
        dcInstance = new FakeDataChannel()
        return dcInstance
      }
      async createOffer() { return { type: 'offer' as const, sdp: 'v=0\r\n' } }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      async addIceCandidate() {}
      close() {}
    }

    const conn = new RoomConnection({
      roomCode: 'ABCDEF',
      role: 'desktop',
      signalingOrigin: 'https://example.com',
      onStatus: (s) => statuses.push(s),
      onMessage: (m) => received.push(m),
      WebSocketCtor: MockWS as unknown as typeof WebSocket,
      RTCPeerConnectionCtor: MockPC as unknown as typeof RTCPeerConnection,
    })

    conn.connect()
    socketInstance!.emitOpen()
    socketInstance!.emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'desktop', peerConnected: false })
    expect(conn.getStatus()).toBe('waiting-peer')

    socketInstance!.emitJson({ type: 'peer-joined', role: 'phone' })
    expect(conn.getStatus()).toBe('paired-relay')
    await vi.waitFor(() => expect(dcInstance).not.toBeNull())

    // Before DataChannel opens, messages travel over WebSocket relay.
    conn.send({ type: 'web-action', action: 'add-ball' })
    expect(socketInstance!.sent.some((s) => s.includes('add-ball'))).toBe(true)

    // Once DataChannel opens, messages switch to DataChannel.
    dcInstance!.open()
    expect(conn.getStatus()).toBe('paired-p2p')
    conn.send({ type: 'web-action', action: 'toss' })
    expect(dcInstance!.sent.some((s) => s.includes('toss'))).toBe(true)

    dcInstance!.onmessage?.({ data: JSON.stringify({ type: 'web-action', action: 'recenter' }) })
    expect(received).toHaveLength(1)
    expect(statuses).toEqual(['connecting', 'waiting-peer', 'paired-relay', 'paired-p2p'])
    conn.close()
  })

  it('stops auto-reconnecting when closed with code 4001 (Replaced by new connection)', () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeWebSocket[] = []
      const statuses: RoomConnectionStatus[] = []
      const errors: string[] = []

      function MockWS() {
        const ws = new FakeWebSocket()
        sockets.push(ws)
        return ws
      }

      const conn = new RoomConnection({
        roomCode: 'ABCDEF',
        role: 'desktop',
        signalingOrigin: 'https://example.com',
        onStatus: (s) => statuses.push(s),
        onError: (e) => errors.push(e),
        WebSocketCtor: MockWS as unknown as typeof WebSocket,
      })

      conn.connect()
      expect(sockets).toHaveLength(1)
      sockets[0].emitOpen()
      sockets[0].emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'desktop', peerConnected: false })
      expect(conn.getStatus()).toBe('waiting-peer')

      // Server evicts this socket with 4001
      sockets[0].emitClose(4001, 'Replaced by new connection')
      expect(conn.getStatus()).toBe('replaced')
      expect(errors).toEqual(['Replaced by new connection'])

      // Advancing timers well past backoff must NOT open another WebSocket
      vi.advanceTimersByTime(60_000)
      expect(sockets).toHaveLength(1)
      expect(statuses).toEqual(['connecting', 'waiting-peer', 'replaced'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('tears down existing P2P DataChannel on peer-joined so phone does not route to evicted desktop', async () => {
    const statuses: RoomConnectionStatus[] = []
    let socketInstance: FakeWebSocket | null = null
    let closedPcCount = 0
    const createdChannels: FakeDataChannel[] = []

    function MockWS() {
      const ws = new FakeWebSocket()
      socketInstance = ws
      return ws
    }
    class MockPC {
      onicecandidate: unknown = null
      onconnectionstatechange: unknown = null
      ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null
      async setRemoteDescription() {}
      async createAnswer() { return { type: 'answer' as const, sdp: 'v=0\r\nanswer' } }
      async setLocalDescription() {}
      async addIceCandidate() {}
      close() { closedPcCount += 1 }
      emitIncomingChannel() {
        const dc = new FakeDataChannel()
        createdChannels.push(dc)
        this.ondatachannel?.({ channel: dc })
        return dc
      }
    }

    let lastPc: MockPC | null = null
    function MockPCCtor() {
      lastPc = new MockPC()
      return lastPc
    }

    const conn = new RoomConnection({
      roomCode: 'ABCDEF',
      role: 'phone',
      signalingOrigin: 'https://example.com',
      onStatus: (s) => statuses.push(s),
      WebSocketCtor: MockWS as unknown as typeof WebSocket,
      RTCPeerConnectionCtor: MockPCCtor as unknown as typeof RTCPeerConnection,
    })

    conn.connect()
    socketInstance!.emitOpen()
    socketInstance!.emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'phone', peerConnected: true })
    socketInstance!.emitJson({ type: 'rtc-offer', sdp: 'v=0\r\noffer-1' })
    await vi.waitFor(() => expect(lastPc).not.toBeNull())

    const oldDc = lastPc!.emitIncomingChannel()
    oldDc.open()
    expect(conn.getStatus()).toBe('paired-p2p')

    // Desktop 2 replaces Desktop 1 -> relay sends peer-joined without peer-left
    socketInstance!.emitJson({ type: 'peer-joined', role: 'desktop' })
    expect(conn.getStatus()).toBe('paired-relay')
    expect(closedPcCount).toBe(1)
    expect(oldDc.readyState).toBe('closed')

    // Subsequent sends MUST go over WebSocket relay to Desktop 2, NOT the evicted oldDc
    oldDc.sent.length = 0
    socketInstance!.sent.length = 0
    expect(conn.send({ type: 'web-action', action: 'toss' })).toBe(true)
    expect(oldDc.sent).toHaveLength(0)
    expect(socketInstance!.sent.some((s) => s.includes('toss'))).toBe(true)

    expect(statuses).toEqual(['connecting', 'paired-relay', 'paired-p2p', 'paired-relay'])
    conn.close()
  })

  it('suppresses stale rtc-offer and rtc-answer if peer is torn down during setLocalDescription', async () => {
    // 1) Desktop offerer race during setLocalDescription
    let desktopSocket: FakeWebSocket | null = null
    let resolveDesktopSetLocal!: () => void
    const desktopSetLocalPromise = new Promise<void>((res) => { resolveDesktopSetLocal = res })

    function DesktopWS() {
      desktopSocket = new FakeWebSocket()
      return desktopSocket
    }
    class SlowDesktopPC {
      onicecandidate: unknown = null
      onconnectionstatechange: unknown = null
      ondatachannel: unknown = null
      createDataChannel() { return new FakeDataChannel() }
      async createOffer() { return { type: 'offer' as const, sdp: 'v=0\r\nstale-offer' } }
      async setLocalDescription() { await desktopSetLocalPromise }
      async setRemoteDescription() {}
      async addIceCandidate() {}
      close() {}
    }

    const desktopConn = new RoomConnection({
      roomCode: 'ABCDEF',
      role: 'desktop',
      signalingOrigin: 'https://example.com',
      WebSocketCtor: DesktopWS as unknown as typeof WebSocket,
      RTCPeerConnectionCtor: SlowDesktopPC as unknown as typeof RTCPeerConnection,
    })

    desktopConn.connect()
    desktopSocket!.emitOpen()
    desktopSocket!.emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'desktop', peerConnected: true })
    await Promise.resolve()
    // Peer leaves while setLocalDescription is still in flight
    desktopSocket!.emitJson({ type: 'peer-left', role: 'phone' })
    resolveDesktopSetLocal()
    await Promise.resolve()
    await Promise.resolve()
    expect(desktopSocket!.sent.some((s) => s.includes('stale-offer'))).toBe(false)
    desktopConn.close()

    // 2) Phone answerer race during setLocalDescription
    let phoneSocket: FakeWebSocket | null = null
    let resolvePhoneSetLocal!: () => void
    const phoneSetLocalPromise = new Promise<void>((res) => { resolvePhoneSetLocal = res })

    function PhoneWS() {
      phoneSocket = new FakeWebSocket()
      return phoneSocket
    }
    class SlowPhonePC {
      onicecandidate: unknown = null
      onconnectionstatechange: unknown = null
      ondatachannel: unknown = null
      async setRemoteDescription() {}
      async createAnswer() { return { type: 'answer' as const, sdp: 'v=0\r\nstale-answer' } }
      async setLocalDescription() { await phoneSetLocalPromise }
      async addIceCandidate() {}
      close() {}
    }

    const phoneConn = new RoomConnection({
      roomCode: 'ABCDEF',
      role: 'phone',
      signalingOrigin: 'https://example.com',
      WebSocketCtor: PhoneWS as unknown as typeof WebSocket,
      RTCPeerConnectionCtor: SlowPhonePC as unknown as typeof RTCPeerConnection,
    })

    phoneConn.connect()
    phoneSocket!.emitOpen()
    phoneSocket!.emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'phone', peerConnected: true })
    phoneSocket!.emitJson({ type: 'rtc-offer', sdp: 'v=0\r\noffer-1' })
    await Promise.resolve()
    await Promise.resolve()
    phoneSocket!.emitJson({ type: 'peer-left', role: 'desktop' })
    resolvePhoneSetLocal()
    await Promise.resolve()
    await Promise.resolve()
    expect(phoneSocket!.sent.some((s) => s.includes('stale-answer'))).toBe(false)
    phoneConn.close()
  })

  it('buffers early rtc-ice candidates until setRemoteDescription resolves and closes previous socket on reconnect', async () => {
    const sockets: FakeWebSocket[] = []
    const addedCandidates: RTCIceCandidateInit[] = []
    let resolveRemoteDesc!: () => void
    const remoteDescPromise = new Promise<void>((res) => { resolveRemoteDesc = res })
    let remoteDescDone = false

    function MockWS() {
      const ws = new FakeWebSocket()
      sockets.push(ws)
      return ws
    }
    class DeferredRemotePC {
      onicecandidate: unknown = null
      onconnectionstatechange: unknown = null
      ondatachannel: unknown = null
      async setRemoteDescription() {
        await remoteDescPromise
        remoteDescDone = true
      }
      async createAnswer() { return { type: 'answer' as const, sdp: 'v=0\r\nanswer' } }
      async setLocalDescription() {}
      async addIceCandidate(c: RTCIceCandidateInit) {
        if (!remoteDescDone) {
          throw new Error('InvalidStateError: remote description not set yet')
        }
        addedCandidates.push(c)
      }
      close() {}
    }

    const conn = new RoomConnection({
      roomCode: 'ABCDEF',
      role: 'phone',
      signalingOrigin: 'https://example.com',
      WebSocketCtor: MockWS as unknown as typeof WebSocket,
      RTCPeerConnectionCtor: DeferredRemotePC as unknown as typeof RTCPeerConnection,
    })

    // Calling connect() twice must cleanly close the first socket
    conn.connect()
    expect(sockets).toHaveLength(1)
    conn.connect()
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)

    sockets[1].emitOpen()
    sockets[1].emitJson({ type: 'room-joined', roomCode: 'ABCDEF', role: 'phone', peerConnected: true })
    sockets[1].emitJson({ type: 'rtc-offer', sdp: 'v=0\r\noffer' })

    // Early ICE candidates arrive before setRemoteDescription resolves
    const cand1 = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }
    const cand2 = { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 }
    sockets[1].emitJson({ type: 'rtc-ice', candidate: cand1 })
    sockets[1].emitJson({ type: 'rtc-ice', candidate: cand2 })
    expect(addedCandidates).toEqual([])

    resolveRemoteDesc()
    await vi.waitFor(() => expect(addedCandidates).toEqual([cand1, cand2]))
    await vi.waitFor(() => expect(sockets[1].sent.some((s) => s.includes('rtc-answer'))).toBe(true))
    conn.close()
  })
})
