import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createWebPlayRoomRelay } from './webplay-room-relay.mjs'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const queue = []
    const waiters = []
    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString('utf8'))
      if (waiters.length > 0) {
        waiters.shift()(parsed)
      } else {
        queue.push(parsed)
      }
    })
    ws.nextMessage = () =>
      queue.length > 0
        ? Promise.resolve(queue.shift())
        : new Promise((res) => waiters.push(res))
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

describe('webplay room relay', () => {
  it('pairs desktop and phone, relays messages, and notifies on peer disconnect', async () => {
    const server = http.createServer()
    const relay = createWebPlayRoomRelay()
    const detach = relay.attach(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()

    cleanups.push(async () => {
      detach()
      relay.close()
      await new Promise((resolve) => server.close(resolve))
    })

    const desktop = await connectWs(`ws://127.0.0.1:${port}/api/room/ABC234?role=desktop`)
    expect(await desktop.nextMessage()).toEqual({
      type: 'room-joined',
      roomCode: 'ABC234',
      role: 'desktop',
      peerConnected: false,
    })

    const phone = await connectWs(`ws://127.0.0.1:${port}/api/room/ABC234?role=phone`)
    expect(await phone.nextMessage()).toEqual({
      type: 'room-joined',
      roomCode: 'ABC234',
      role: 'phone',
      peerConnected: true,
    })
    expect(await desktop.nextMessage()).toEqual({ type: 'peer-joined', role: 'phone' })

    phone.send(JSON.stringify({ type: 'web-action', action: 'toss', strength: 1 }))
    expect(await desktop.nextMessage()).toEqual({ type: 'web-action', action: 'toss', strength: 1 })

    phone.close()
    expect(await desktop.nextMessage()).toEqual({ type: 'peer-left', role: 'phone' })
    desktop.close()
  })

  it('evicts previous role holder with 4001 without emitting peer-left and handles socket errors safely', async () => {
    const server = http.createServer()
    const relay = createWebPlayRoomRelay()
    const detach = relay.attach(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()

    cleanups.push(async () => {
      detach()
      relay.close()
      await new Promise((resolve) => server.close(resolve))
    })

    const desktop1 = await connectWs(`ws://127.0.0.1:${port}/api/room/ABC234?role=desktop`)
    expect(await desktop1.nextMessage()).toMatchObject({ type: 'room-joined', peerConnected: false })

    const phone = await connectWs(`ws://127.0.0.1:${port}/api/room/ABC234?role=phone`)
    expect(await phone.nextMessage()).toMatchObject({ type: 'room-joined', peerConnected: true })
    expect(await desktop1.nextMessage()).toEqual({ type: 'peer-joined', role: 'phone' })

    const desktop1CloseCode = new Promise((resolve) => {
      desktop1.once('close', (code) => resolve(code))
    })

    const desktop2 = await connectWs(`ws://127.0.0.1:${port}/api/room/ABC234?role=desktop`)
    expect(await desktop2.nextMessage()).toMatchObject({ type: 'room-joined', peerConnected: true })
    expect(await desktop1CloseCode).toBe(4001)
    expect(await phone.nextMessage()).toEqual({ type: 'peer-joined', role: 'desktop' })

    // Verify phone receives desktop2's action directly with no spurious peer-left from desktop1
    desktop2.send(JSON.stringify({ type: 'web-action', action: 'add-ball' }))
    expect(await phone.nextMessage()).toEqual({ type: 'web-action', action: 'add-ball' })

    // Emit an error on server-side desktop2 socket, then close; should not crash and emit peer-left once
    const room = relay.rooms.get('ABC234')
    expect(room?.desktop).toBeTruthy()
    room.desktop.emit('error', new Error('simulated reset'))
    expect(await phone.nextMessage()).toEqual({ type: 'peer-left', role: 'desktop' })

    desktop2.close()
    phone.close()
  })
})
