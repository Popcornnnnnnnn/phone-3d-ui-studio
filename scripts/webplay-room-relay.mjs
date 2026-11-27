import { WebSocket, WebSocketServer } from 'ws'
import {
  normalizeRoomCode,
  parseWebPlayMessage,
  ROOM_REPLACED_CLOSE_CODE,
} from '../shared/webPlayProtocol.mjs'

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

export function createWebPlayRoomRelay() {
  const wss = new WebSocketServer({ noServer: true })
  const rooms = new Map()

  function sendJson(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }

  function handleUpgrade(request, socket, head) {
    const reqUrl = new URL(request.url ?? '/', 'http://localhost')
    const match = reqUrl.pathname.match(/^\/api\/room\/([^/]+)$/)
    if (!match) return false

    const roomCode = normalizeRoomCode(decodeURIComponent(match[1]))
    const role = reqUrl.searchParams.get('role')
    if (!roomCode || (role !== 'desktop' && role !== 'phone')) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return true
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      let room = rooms.get(roomCode)
      if (!room) {
        room = { desktop: null, phone: null }
        rooms.set(roomCode, room)
      }

      const previous = room[role]
      room[role] = ws
      if (previous && previous !== ws) {
        try {
          previous.close(ROOM_REPLACED_CLOSE_CODE, 'Replaced by new connection')
        } catch {
          // ignore
        }
      }
      const peerRole = role === 'desktop' ? 'phone' : 'desktop'
      const peer = room[peerRole]

      sendJson(ws, {
        type: 'room-joined',
        roomCode,
        role,
        peerConnected: Boolean(peer && peer.readyState === WebSocket.OPEN),
      })
      if (peer && peer.readyState === WebSocket.OPEN) {
        sendJson(peer, { type: 'peer-joined', role })
      }

      const releaseSocket = () => {
        if (room[role] !== ws) return
        room[role] = null
        sendJson(room[peerRole], { type: 'peer-left', role })
        if (!room.desktop && !room.phone) {
          rooms.delete(roomCode)
        }
      }

      ws.on('message', (data) => {
        if (room[role] !== ws) return
        let json
        try {
          json = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
        } catch {
          return
        }
        const msg = parseWebPlayMessage(json)
        if (!msg) return
        if (msg.type === 'ping') {
          sendJson(ws, { type: 'pong', atMs: msg.atMs })
          return
        }
        if (RELAYED_TYPES.has(msg.type)) {
          sendJson(room[peerRole], msg)
        }
      })

      ws.on('error', releaseSocket)
      ws.on('close', releaseSocket)
    })
    return true
  }

  function attach(httpServer) {
    const onUpgrade = (request, socket, head) => {
      handleUpgrade(request, socket, head)
    }
    httpServer.on('upgrade', onUpgrade)
    return () => {
      httpServer.off('upgrade', onUpgrade)
    }
  }

  function close() {
    for (const room of rooms.values()) {
      try { room.desktop?.close() } catch { /* ignore */ }
      try { room.phone?.close() } catch { /* ignore */ }
    }
    rooms.clear()
    wss.close()
  }

  return { attach, handleUpgrade, close, rooms }
}
