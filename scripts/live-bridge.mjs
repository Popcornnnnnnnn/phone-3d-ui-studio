import http from 'node:http'
import os from 'node:os'
import { WebSocket, WebSocketServer } from 'ws'

const port = Number.parseInt(process.env.PHONE_BRIDGE_PORT ?? '4319', 10)
const host = process.env.PHONE_BRIDGE_HOST ?? '0.0.0.0'
const clients = new Map()
const pendingFrameMetadata = new Map()
const diagnostics = {
  receiverSamples: [],
  encoderSamples: [],
  benchmarkEvents: [],
}

function retainDiagnostic(collection, sample) {
  collection.push({ ...sample, bridgeReceivedAtMs: Date.now() })
  if (collection.length > 300) collection.splice(0, collection.length - 300)
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function counts() {
  let browsers = 0
  let phones = 0
  let webrtcBrowsers = 0
  let webrtcPhones = 0

  for (const role of clients.values()) {
    if (role === 'browser') browsers += 1
    if (role === 'phone') phones += 1
    if (role === 'browser-webrtc') webrtcBrowsers += 1
    if (role === 'phone-webrtc') webrtcPhones += 1
  }

  return { browsers, phones, webrtcBrowsers, webrtcPhones }
}

function broadcastStatus() {
  const message = JSON.stringify({ type: 'bridge-status', ...counts() })

  for (const [client, role] of clients) {
    if (
      (role === 'browser' || role === 'browser-pose') &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(message)
    }
  }
}

function broadcastToBrowsers(data, isBinary) {
  for (const [client, role] of clients) {
    if (
      role === 'browser' &&
      client.readyState === WebSocket.OPEN &&
      client.bufferedAmount < 8 * 1024 * 1024
    ) {
      client.send(data, { binary: isBinary })
    }
  }
}

function broadcastToFramePhones(data) {
  for (const [client, role] of clients) {
    if (role === 'phone' && client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

function broadcastToPoseBrowsers(data) {
  for (const [client, role] of clients) {
    if (
      role === 'browser-pose' &&
      client.readyState === WebSocket.OPEN &&
      client.bufferedAmount < 256 * 1024
    ) {
      client.send(data)
    }
  }
}

function broadcastToPosePhones(data) {
  for (const [client, role] of clients) {
    if (role === 'phone-pose' && client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

const signalingBacklog = {
  'browser-webrtc': [],
  'phone-webrtc': [],
}

function oppositeWebRTCRole(role) {
  return role === 'browser-webrtc' ? 'phone-webrtc' : 'browser-webrtc'
}

function relayWebRTC(role, data) {
  const targetRole = oppositeWebRTCRole(role)
  const text = data.toString()
  for (const [client, clientRole] of clients) {
    if (clientRole === targetRole && client.readyState === WebSocket.OPEN) {
      // `ws` sends Buffer values as binary by default. WebRTC signaling must
      // stay a text frame because URLSessionWebSocketTask dispatches binary
      // frames through a different case on iOS.
      client.send(text)
    }
  }

  // Retain the active session's signaling so a phone-side reconnect can
  // receive the offer and candidates without forcing a browser refresh.
  const backlog = signalingBacklog[role]
  backlog.push(text)
  if (backlog.length > 64) backlog.shift()
}

function flushWebRTCBacklog(role, socket) {
  const sourceRole = oppositeWebRTCRole(role)
  const backlog = signalingBacklog[sourceRole]
  for (const message of backlog) socket.send(message)
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ...counts() }))
    return
  }

  if (request.url === '/diagnostics') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ...diagnostics }))
    return
  }

  response.writeHead(404)
  response.end()
})

const sockets = new WebSocketServer({ server, maxPayload: 12 * 1024 * 1024 })

sockets.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const role = url.searchParams.get('role')

  if (
    role !== 'browser' &&
    role !== 'browser-pose' &&
    role !== 'phone' &&
    role !== 'phone-pose' &&
    role !== 'browser-webrtc' &&
    role !== 'phone-webrtc'
  ) {
    socket.close(1008, 'unsupported bridge role')
    return
  }

  clients.set(socket, role)
  if (role === 'browser-webrtc') {
    // A fresh browser offer starts a fresh peer session; stale answers and ICE
    // candidates from an earlier tab must never leak into it.
    signalingBacklog['browser-webrtc'].length = 0
    signalingBacklog['phone-webrtc'].length = 0
  }
  if (role === 'browser-webrtc' || role === 'phone-webrtc') {
    flushWebRTCBacklog(role, socket)
  }
  broadcastStatus()

  socket.on('message', (data, isBinary) => {
    if (
      !isBinary &&
      (role === 'browser-webrtc' || role === 'phone-webrtc')
    ) {
      relayWebRTC(role, data)
      return
    }

    if (role === 'browser' && !isBinary) {
      try {
        const message = JSON.parse(data.toString())
        if (message.type === 'request-keyframe') {
          broadcastToFramePhones(JSON.stringify(message))
        }
      } catch {
        // Ignore browser messages that are not bridge control JSON.
      }
      return
    }

    if (role === 'browser-pose' && !isBinary) {
      try {
        const message = JSON.parse(data.toString())
        if (message.type === 'browser-receiver-status') {
          retainDiagnostic(diagnostics.receiverSamples, message)
        } else if (message.type === 'pose-mode') {
          broadcastToPosePhones(JSON.stringify(message))
        }
      } catch {
        // Ignore browser telemetry that is not valid control JSON.
      }
      return
    }

    if (role !== 'phone' && role !== 'phone-pose') return

    if (isBinary && role === 'phone') {
      const bridgeReceivedAtMs = Date.now()
      const metadata = pendingFrameMetadata.get(socket)
      pendingFrameMetadata.delete(socket)

      if (metadata) {
        const bridgeRelayedAtMs = Date.now()
        broadcastToBrowsers(
          JSON.stringify({
            ...metadata,
            bridgeReceivedAtMs,
            bridgeRelayedAtMs,
            payloadBytes: data.byteLength,
          }),
          false,
        )
      }

      broadcastToBrowsers(data, true)
      return
    }

    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }

    if (message.type === 'clock-sync') {
      const bridgeReceiveAtMs = Date.now()
      socket.send(
        JSON.stringify({
          type: 'clock-sync-reply',
          requestId: message.requestId,
          phoneSendAtMs: message.phoneSendAtMs,
          bridgeReceiveAtMs,
          bridgeSendAtMs: Date.now(),
        }),
      )
      return
    }

    if (message.type === 'frame-meta' && role === 'phone') {
      pendingFrameMetadata.set(socket, {
        ...message,
        metadataReceivedAtMs: Date.now(),
      })
      return
    }

    if (message.type === 'pose' && role === 'phone-pose') {
      const bridgeReceivedAtMs = Date.now()
      broadcastToPoseBrowsers(
        JSON.stringify({
          ...message,
          bridgeReceivedAtMs,
          bridgeRelayedAtMs: Date.now(),
        }),
      )
      return
    }

    if (message.type === 'encoder-status' && role === 'phone-pose') {
      retainDiagnostic(diagnostics.encoderSamples, message)
      broadcastToPoseBrowsers(JSON.stringify(message))
      return
    }

    if (message.type === 'benchmark-status' && role === 'phone-pose') {
      retainDiagnostic(diagnostics.benchmarkEvents, message)
      broadcastToPoseBrowsers(JSON.stringify(message))
    }
  })

  socket.on('close', () => {
    clients.delete(socket)
    pendingFrameMetadata.delete(socket)
    broadcastStatus()
  })

  socket.on('error', () => {
    clients.delete(socket)
    pendingFrameMetadata.delete(socket)
    broadcastStatus()
  })
})

server.listen(port, host, () => {
  console.log(`Phone bridge listening on ws://127.0.0.1:${port}/?role=browser`)
  for (const address of localAddresses()) {
    console.log(`iPhone endpoint: ws://${address}:${port}/?role=phone`)
  }
})

function shutdown() {
  for (const client of clients.keys()) client.close(1001, 'bridge shutting down')
  sockets.close(() => server.close())
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
