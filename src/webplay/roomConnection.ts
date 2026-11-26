import {
  parseWebPlayMessage,
  type WebPlayGameMessage,
  type WebPlayRole,
  type WebPlaySignalMessage,
} from '../../shared/webPlayProtocol.mjs'

export type RoomConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting-peer'
  | 'paired-relay'
  | 'paired-p2p'
  | 'unavailable'
  | 'closed'

export interface RoomConnectionOptions {
  roomCode: string
  role: WebPlayRole
  signalingOrigin?: string
  onStatus?: (status: RoomConnectionStatus) => void
  onMessage?: (message: WebPlayGameMessage) => void
  onError?: (reason: string) => void
  WebSocketCtor?: typeof WebSocket
  RTCPeerConnectionCtor?: typeof RTCPeerConnection
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
]

export function resolveSignalingWsUrl(roomCode: string, role: WebPlayRole, originOverride?: string): string {
  const rawOrigin =
    originOverride ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_ORIGIN) ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4317')
  const url = new URL(rawOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/room/${encodeURIComponent(roomCode)}`
  url.search = `?role=${encodeURIComponent(role)}`
  return url.toString()
}

export class RoomConnection {
  private readonly options: RoomConnectionOptions
  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private status: RoomConnectionStatus = 'idle'
  private everOpened = false
  private closedByUser = false
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private attempt = 0

  constructor(options: RoomConnectionOptions) {
    this.options = options
  }

  getStatus(): RoomConnectionStatus {
    return this.status
  }

  private setStatus(next: RoomConnectionStatus) {
    if (this.status === next) return
    this.status = next
    this.options.onStatus?.(next)
  }

  connect() {
    this.closedByUser = false
    clearTimeout(this.retryTimer)
    this.openSocket()
  }

  private openSocket() {
    const WS = this.options.WebSocketCtor ?? globalThis.WebSocket
    if (!WS) {
      this.setStatus('unavailable')
      return
    }
    this.setStatus('connecting')
    const url = resolveSignalingWsUrl(this.options.roomCode, this.options.role, this.options.signalingOrigin)
    const socket = new WS(url)
    this.ws = socket

    socket.onopen = () => {
      if (this.ws !== socket || this.closedByUser) return
      this.everOpened = true
      this.attempt = 0
    }

    socket.onmessage = (event) => {
      if (this.ws !== socket || this.closedByUser) return
      this.handleRawPayload(event.data)
    }

    socket.onerror = () => {
      // Handled in onclose
    }

    socket.onclose = () => {
      if (this.ws !== socket) return
      this.ws = null
      this.teardownPeer()
      if (this.closedByUser) {
        this.setStatus('closed')
        return
      }
      if (!this.everOpened && this.attempt >= 1) {
        this.setStatus('unavailable')
        return
      }
      this.setStatus(this.everOpened ? 'connecting' : 'unavailable')
      const delayMs = Math.min(800 * 2 ** Math.min(this.attempt++, 4), 6000)
      this.retryTimer = setTimeout(() => {
        if (!this.closedByUser) this.openSocket()
      }, delayMs)
    }
  }

  private handleRawPayload(raw: unknown) {
    if (typeof raw !== 'string') return
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      return
    }
    const msg = parseWebPlayMessage(parsedJson)
    if (!msg) return

    switch (msg.type) {
      case 'room-joined':
        if (msg.peerConnected) {
          this.setStatus('paired-relay')
          if (this.options.role === 'desktop') void this.startPeerAsOfferer()
        } else {
          this.setStatus('waiting-peer')
        }
        return
      case 'peer-joined':
        this.setStatus('paired-relay')
        if (this.options.role === 'desktop') void this.startPeerAsOfferer()
        return
      case 'peer-left':
        this.teardownPeer()
        this.setStatus('waiting-peer')
        return
      case 'rtc-offer':
        if (this.options.role === 'phone') void this.acceptOffer(msg.sdp)
        return
      case 'rtc-answer':
        if (this.options.role === 'desktop' && this.pc) {
          void this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => {})
        }
        return
      case 'rtc-ice':
        if (this.pc) {
          void this.pc.addIceCandidate(msg.candidate).catch(() => {})
        }
        return
      case 'room-error':
        this.options.onError?.(msg.message)
        return
      case 'ping':
        this.sendSignal({ type: 'pong', atMs: msg.atMs })
        return
      case 'pong':
        return
      default:
        this.options.onMessage?.(msg)
    }
  }

  private createPeerConnection(): RTCPeerConnection | null {
    const PC = this.options.RTCPeerConnectionCtor ?? globalThis.RTCPeerConnection
    if (!PC) return null
    this.teardownPeer()
    const pc = new PC({ iceServers: ICE_SERVERS })
    this.pc = pc

    pc.onicecandidate = (event) => {
      if (event.candidate && this.pc === pc) {
        this.sendSignal({ type: 'rtc-ice', candidate: event.candidate.toJSON() })
      }
    }

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.channel?.readyState !== 'open' && this.ws?.readyState === WebSocket.OPEN) {
          this.setStatus('paired-relay')
        }
      }
    }

    return pc
  }

  private bindDataChannel(channel: RTCDataChannel) {
    this.channel = channel
    channel.onopen = () => {
      if (this.channel !== channel) return
      this.setStatus('paired-p2p')
    }
    channel.onclose = () => {
      if (this.channel !== channel) return
      this.channel = null
      if (this.ws?.readyState === WebSocket.OPEN && this.status === 'paired-p2p') {
        this.setStatus('paired-relay')
      }
    }
    channel.onmessage = (event) => {
      if (this.channel !== channel) return
      this.handleRawPayload(event.data)
    }
  }

  private async startPeerAsOfferer() {
    const pc = this.createPeerConnection()
    if (!pc) return
    try {
      const channel = pc.createDataChannel('phone3d', { ordered: true })
      this.bindDataChannel(channel)
      const offer = await pc.createOffer()
      if (this.pc !== pc) return
      await pc.setLocalDescription(offer)
      if (offer.sdp) {
        this.sendSignal({ type: 'rtc-offer', sdp: offer.sdp })
      }
    } catch {
      // Relay remains active seamlessly.
    }
  }

  private async acceptOffer(sdp: string) {
    const pc = this.createPeerConnection()
    if (!pc) return
    pc.ondatachannel = (event) => {
      if (this.pc !== pc) return
      this.bindDataChannel(event.channel)
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp })
      if (this.pc !== pc) return
      const answer = await pc.createAnswer()
      if (this.pc !== pc) return
      await pc.setLocalDescription(answer)
      if (answer.sdp) {
        this.sendSignal({ type: 'rtc-answer', sdp: answer.sdp })
      }
    } catch {
      // Relay remains active seamlessly.
    }
  }

  private teardownPeer() {
    if (this.channel) {
      this.channel.onopen = null
      this.channel.onclose = null
      this.channel.onmessage = null
      try { this.channel.close() } catch { /* ignore */ }
      this.channel = null
    }
    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.onconnectionstatechange = null
      this.pc.ondatachannel = null
      try { this.pc.close() } catch { /* ignore */ }
      this.pc = null
    }
  }

  private sendSignal(msg: WebPlaySignalMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  send(msg: WebPlayGameMessage, options?: { droppable?: boolean }): boolean {
    const payload = JSON.stringify(msg)
    if (this.channel && this.channel.readyState === 'open') {
      if (options?.droppable && this.channel.bufferedAmount > 4096) return false
      this.channel.send(payload)
      return true
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (options?.droppable && this.ws.bufferedAmount > 16384) return false
      this.ws.send(payload)
      return true
    }
    return false
  }

  close() {
    this.closedByUser = true
    clearTimeout(this.retryTimer)
    this.teardownPeer()
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    this.setStatus('closed')
  }
}
