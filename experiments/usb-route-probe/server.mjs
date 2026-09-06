import net from 'node:net'
import { WebSocketServer } from 'ws'

const port = Number.parseInt(process.env.USB_ROUTE_PROBE_PORT ?? '4331', 10)
const webSocketPort = Number.parseInt(
  process.env.USB_ROUTE_PROBE_WEBSOCKET_PORT ?? '4332',
  10,
)

const server = net.createServer({ allowHalfOpen: false }, (socket) => {
  const acceptedAt = new Date().toISOString()
  const peer = {
    acceptedAt,
    event: 'accepted',
    localAddress: socket.localAddress,
    localPort: socket.localPort,
    remoteAddress: socket.remoteAddress,
    remoteFamily: socket.remoteFamily,
    remotePort: socket.remotePort,
  }
  process.stdout.write(`${JSON.stringify(peer)}\n`)

  let pending = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line) continue
      let payload = line
      try {
        payload = JSON.parse(line)
      } catch {
        // Preserve malformed input in the evidence log instead of hiding it.
      }
      process.stdout.write(`${JSON.stringify({ ...peer, event: 'payload', payload })}\n`)
    }
  })
  socket.on('error', (error) => {
    process.stdout.write(`${JSON.stringify({ ...peer, event: 'socket-error', error: error.message })}\n`)
  })
})

server.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({ event: 'server-error', error: error.message })}\n`)
  process.exitCode = 1
})

server.listen({ host: '::', port, ipv6Only: false }, () => {
  process.stdout.write(`${JSON.stringify({ event: 'listening', address: server.address() })}\n`)
})

const webSocketServer = new WebSocketServer({
  host: '::',
  port: webSocketPort,
})

webSocketServer.on('listening', () => {
  process.stdout.write(`${JSON.stringify({ event: 'ws-listening', address: webSocketServer.address() })}\n`)
})

webSocketServer.on('connection', (socket, request) => {
  const peer = {
    acceptedAt: new Date().toISOString(),
    event: 'ws-accepted',
    localAddress: request.socket.localAddress,
    localPort: request.socket.localPort,
    remoteAddress: request.socket.remoteAddress,
    remoteFamily: request.socket.remoteFamily,
    remotePort: request.socket.remotePort,
    url: request.url,
  }
  process.stdout.write(`${JSON.stringify(peer)}\n`)
  socket.on('message', (data) => {
    const text = data.toString('utf8')
    let payload = text
    try {
      payload = JSON.parse(text)
    } catch {
      // Preserve malformed input in the evidence log instead of hiding it.
    }
    process.stdout.write(`${JSON.stringify({ ...peer, event: 'ws-payload', payload })}\n`)
  })
})
