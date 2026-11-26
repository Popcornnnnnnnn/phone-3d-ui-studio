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
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.onclose?.() }
  emitOpen() { this.onopen?.() }
  emitJson(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

describe('webPlayProtocol and RoomConnection', () => {
  it('generates, normalizes, and formats 6-character unambiguous room codes', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(normalizeRoomCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `)).toBe(code)
    expect(formatRoomCode(code)).toBe(`${code.slice(0, 3)}-${code.slice(3)}`)
    expect(normalizeRoomCode('O0I1L!')).toBeNull()
  })

  it('validates web-pose, web-action, and web-ui-event packets', () => {
    expect(parseWebPlayMessage({ type: 'web-action', action: 'toss', strength: 1.1 })).toEqual({
      type: 'web-action',
      action: 'toss',
      strength: 1.1,
    })
    expect(parseWebPlayMessage({ type: 'web-pose', seq: 1, sentAtMs: 100, quaternion: [0, 0, 0, 1] })).not.toBeNull()
    expect(parseWebPlayMessage({ type: 'web-pose', seq: -1, sentAtMs: 100, quaternion: [0, 0, 0, 1] })).toBeNull()
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
})
