import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createSpatialRelay } from './spatial-relay.mjs'

class Socket extends EventEmitter {
  readyState = 1
  bufferedAmount = 0
  messages = []
  send(text) { this.messages.push(JSON.parse(text)) }
  close(code) { this.closeCode = code; this.readyState = 3; this.emit('close') }
  receive(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false) }
}
const url = (role, sessionId = 'a') => new URL('ws://localhost/?role=' + role + '&sessionId=' + sessionId)
const pose = (sequence = 1) => ({
  type: 'spatial-pose', source: 'fixture', sessionId: 'a', sequence, sampledAtMs: 1000,
  trackingState: 'normal', reason: 'ready', positionMeters: [1, 2, 3], quaternion: [0, 0, 0, 1],
})
describe('isolated spatial relay', () => {
  it('does not claim any existing video or pose role', () => {
    const relay = createSpatialRelay()
    for (const role of ['browser', 'phone', 'browser-pose', 'phone-pose', 'phone-webrtc']) {
      expect(relay.accept(new Socket(), url(role))).toBe(false)
    }
  })
  it('announces connection generation before forwarding valid metadata only', () => {
    const relay = createSpatialRelay(() => 1234)
    const browser = new Socket(), phone = new Socket()
    relay.accept(browser, url('browser-spatial'))
    expect(browser.messages[0].connected).toBe(false)
    relay.accept(phone, url('phone-spatial'))
    phone.receive({ ...pose(), image: 'private' })
    const message = browser.messages.at(-1)
    expect(message.bridgeReceivedAtMs).toBe(1234)
    expect(message.connectionId).toBe(browser.messages[1].connectionId)
    expect(message).not.toHaveProperty('image')
    expect(phone.messages.at(-1)).toEqual({ type: 'spatial-ack', sessionId: 'a', sequence: 1 })
    phone.receive(pose()); phone.receive({ ...pose(2), sessionId: 'old' })
    expect(browser.messages).toHaveLength(3)
    phone.close()
    expect(browser.messages.at(-1).connected).toBe(false)
  })
  it('rejects late messages and close callbacks from a replaced producer', () => {
    const relay = createSpatialRelay()
    const browser = new Socket(), first = new Socket(), second = new Socket()
    relay.accept(browser, url('browser-spatial')); relay.accept(first, url('phone-spatial'))
    const oldId = browser.messages.at(-1).connectionId
    relay.accept(second, url('phone-spatial'))
    expect(first.closeCode).toBe(4002)
    expect(browser.messages.at(-1).connectionId).not.toBe(oldId)
    first.receive(pose()); first.emit('close'); second.receive(pose())
    expect(browser.messages.at(-1).type).toBe('spatial-pose')
  })
  it('drops congested samples and forwards the next fresh sample without a backlog', () => {
    const relay = createSpatialRelay(), browser = new Socket(), phone = new Socket()
    relay.accept(browser, url('browser-spatial')); relay.accept(phone, url('phone-spatial'))
    browser.bufferedAmount = 20000; phone.receive(pose())
    browser.bufferedAmount = 0; phone.receive(pose(2))
    expect(browser.messages.filter((m) => m.type === 'spatial-pose').map((m) => m.sequence)).toEqual([2])
  })
  it('supports the existing clock exchange without sending it to browsers', () => {
    const relay = createSpatialRelay(() => 1200), phone = new Socket()
    relay.accept(phone, url('phone-spatial'))
    phone.receive({ type: 'clock-sync', requestId: 5, phoneSendAtPreciseMs: 1100.25 })
    expect(phone.messages[0]).toMatchObject({ type: 'clock-sync-reply', requestId: 5, phoneSendAtPreciseMs: 1100.25, bridgeReceiveAtPreciseMs: 1200 })
  })
  it('closes a congested browser instead of losing a session change', () => {
    const relay = createSpatialRelay(), browser = new Socket(), phone = new Socket()
    relay.accept(browser, url('browser-spatial'))
    browser.bufferedAmount = 20000
    relay.accept(phone, url('phone-spatial'))
    expect(browser.closeCode).toBe(4008)
  })
  it('releases every spatial socket during bridge shutdown', () => {
    const relay = createSpatialRelay(), browser = new Socket(), phone = new Socket()
    relay.accept(browser, url('browser-spatial')); relay.accept(phone, url('phone-spatial'))
    relay.shutdown()
    expect(browser.closeCode).toBe(1001)
    expect(phone.closeCode).toBe(1001)
  })
})
