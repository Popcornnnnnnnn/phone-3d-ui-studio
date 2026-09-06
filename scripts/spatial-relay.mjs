import { randomUUID } from 'node:crypto'
import { parseSpatialMessage } from '../shared/spatialProtocol.mjs'

export function createSpatialRelay(now = Date.now) {
  let phone = null
  const browsers = new Set()
  function send(socket, message) {
    if (socket.readyState === 1 && socket.bufferedAmount >= 16 * 1024 && message.type === 'spatial-link') {
      socket.close(4008, 'spatial lifecycle requires a fresh connection')
      return
    }
    if (socket.readyState === 1 && socket.bufferedAmount < 16 * 1024) {
      socket.send(JSON.stringify(message))
    }
  }
  const link = () => ({
    type: 'spatial-link', connected: phone !== null,
    sessionId: phone?.sessionId ?? null, connectionId: phone?.connectionId ?? null,
  })
  function broadcast(message) {
    for (const browser of browsers) send(browser, message)
  }
  function accept(socket, url) {
    const role = url.searchParams.get('role')
    if (role !== 'phone-spatial' && role !== 'browser-spatial') return false
    if (role === 'browser-spatial') {
      browsers.add(socket)
      send(socket, link())
      socket.on('close', () => browsers.delete(socket))
      socket.on('error', () => browsers.delete(socket))
      return true
    }
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId || sessionId.length > 128) {
      socket.close(1008, 'spatial sessionId required')
      return true
    }
    const previous = phone
    const source = { socket, sessionId, connectionId: randomUUID(), sequence: -1 }
    phone = source
    previous?.socket.close(4002, 'spatial producer replaced')
    broadcast(link())
    socket.on('message', (bytes, binary) => {
      if (phone !== source || binary || bytes.length > 4096) return
      let value
      try { value = JSON.parse(bytes.toString()) } catch { return }
      if (value?.type === 'clock-sync') {
        const received = now()
        const sent = value.phoneSendAtPreciseMs ?? value.phoneSendAtMs
        if (!Number.isSafeInteger(value.requestId) || !Number.isFinite(sent)) return
        send(socket, {
          type: 'clock-sync-reply', requestId: value.requestId, clockSyncVersion: 2,
          phoneSendAtMs: Math.trunc(sent), phoneSendAtPreciseMs: sent,
          bridgeReceiveAtMs: Math.trunc(received), bridgeReceiveAtPreciseMs: received,
          bridgeSendAtMs: Math.trunc(now()), bridgeSendAtPreciseMs: now(),
        })
        return
      }
      const message = parseSpatialMessage(value)
      if (!message || message.sessionId !== source.sessionId || message.sequence <= source.sequence) return
      source.sequence = message.sequence
      broadcast({ ...message, connectionId: source.connectionId, bridgeReceivedAtMs: now() })
      send(socket, { type: 'spatial-ack', sessionId, sequence: message.sequence })
    })
    const disconnect = () => {
      if (phone !== source) return
      phone = null
      broadcast(link())
    }
    socket.on('close', disconnect)
    socket.on('error', disconnect)
    return true
  }
  function shutdown() {
    const source = phone
    phone = null
    source?.socket.close(1001, 'bridge shutting down')
    for (const browser of browsers) browser.close(1001, 'bridge shutting down')
    browsers.clear()
  }
  return { accept, shutdown }
}
