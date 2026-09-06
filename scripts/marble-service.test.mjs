import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { MarbleService } from './marble-service.mjs'
import { initMarblePhysics } from './marble-world.mjs'
import { parseWorldSnapshot } from '../shared/worldProtocol.mjs'
let services = []
class Socket { readyState = 1; bufferedAmount = 0; messages = []; send(s) { this.messages.push(JSON.parse(s)) } close() { this.readyState = 3 } }
beforeAll(initMarblePhysics)
afterEach(() => { services.forEach((s) => s.shutdown()); services = [] })
function setup(capable = true) {
  let now = 1000
  const s = new MarbleService(() => now, { autoTick: false }); services.push(s); s.engineReady = true
  const phone = new Socket(), browser = new Socket(), other = new Socket()
  s.addPeer(phone, 'phone'); s.setPhone({ socket: phone, sessionId: 'phone-session', connectionId: 'phone-connection' })
  s.addPeer(browser, 'browser'); s.addPeer(other, 'browser')
  const hello = (socket) => s.handle(socket, { type: 'world-hello', protocolVersion: 2 })
  if (capable) hello(phone)
  hello(browser); hello(other)
  function pose(state = 'normal') { s.receivePose({ type: 'spatial-pose', source: 'fixture', trackingState: state, reason: state,
    sampledAtMs: now, clockOffsetMs: 0, clockRttMs: 1, positionMeters: [0, 0, 0], quaternion: [-0.5, -0.5, -0.5, 0.5] }) }
  function command(socket, action, id = crypto.randomUUID(), epoch = s.epoch) {
    s.handle(socket, { type: 'world-command', protocolVersion: 2, commandId: id, worldId: s.worldId, epoch, action })
    return socket.messages.filter((m) => m.type === 'world-result').at(-1)
  }
  function ack(socket) {
    const p = s.peers.get(socket)
    if (p.awaiting) s.handle(socket, { type: 'world-ack', protocolVersion: 2, worldId: s.worldId, sequence: p.awaiting.sequence })
  }
  pose()
  return { s, phone, browser, other, pose, command, ack, advance: (ms) => { now += ms; s.tick() } }
}
describe('world control, freshness and bounded snapshots', () => {
  it('requires native capability and verified clock without breaking S1', () => {
    const a = setup(false); expect(a.s.snapshot().phase).toBe('unsupported'); expect(a.command(a.browser, 'start').ok).toBe(false)
    const b = setup(); b.s.latest.clockOffsetMs = null
    expect(b.s.snapshot().canStart).toBe(false)
  })
  it('grants one controller and supports explicit takeover after a pause', () => {
    const { s, browser, other, command } = setup()
    expect(command(browser, 'start').ok).toBe(true)
    expect(command(other, 'add-ball').ok).toBe(false)
    expect(command(other, 'start').ok).toBe(false)
    command(browser, 'pause'); expect(command(other, 'start').ok).toBe(true)
    expect(s.ownerId).toBe(s.peers.get(other).id)
  })
  it('deduplicates commands and rejects stale epochs', () => {
    const { s, browser, command } = setup()
    command(browser, 'start', 'start-1', 0); const core = s.core
    expect(command(browser, 'start', 'start-1', 0).ok).toBe(true)
    expect(s.core).toBe(core); expect(s.epoch).toBe(1)
    expect(command(browser, 'reset', 'old-reset', 0).ok).toBe(false)
  })
  it('keeps one unacknowledged snapshot plus only the latest pending one', () => {
    const { s, browser, ack } = setup()
    s.emitSnapshot(); s.emitSnapshot(); s.emitSnapshot()
    const latest = s.peers.get(browser).pending.sequence
    expect(browser.messages.filter((m) => m.type === 'world-snapshot')).toHaveLength(1)
    ack(browser)
    expect(browser.messages.filter((m) => m.type === 'world-snapshot').at(-1).sequence).toBe(latest)
    expect(s.peers.get(browser).pending).toBeNull()
  })
  it('freezes on stale tracking and does not auto-resume or simulate missed time', () => {
    const { s, browser, command, advance, pose } = setup()
    command(browser, 'start'); const before = s.core.snapshot()
    advance(251); expect(s.phase).toBe('paused'); expect(s.core.steps).toBe(0)
    pose(); advance(1); expect(s.phase).toBe('paused'); expect(s.core.snapshot().balls).toEqual(before.balls)
  })
  it('pauses on a missing phone display receipt even while poses continue', () => {
    const { s, browser, command, pose, ack, advance } = setup()
    command(browser, 'start'); ack(browser); advance(200); pose(); ack(browser); advance(51)
    expect(s.phase).toBe('paused'); expect(s.reason).toContain('display')
  })
  it('pauses on owner disconnect and retains fixture identity when tracking is limited', () => {
    const { s, browser, command, pose } = setup()
    command(browser, 'start'); pose('limited')
    expect(s.snapshot().source).toBe('fixture'); expect(s.phase).toBe('paused')
    s.removePeer(browser); expect(s.ownerId).toBeNull()
  })
  it('validates complete snapshots and rejects malformed poses or nonfinite numbers', () => {
    const { s, browser, command } = setup(); command(browser, 'start')
    const snapshot = s.snapshot(); expect(parseWorldSnapshot(snapshot)).not.toBeNull()
    expect(parseWorldSnapshot({ ...snapshot, balls: [{ ...snapshot.balls[0], position: [NaN, 0, 0] }] })).toBeNull()
    expect(parseWorldSnapshot({ ...snapshot, epoch: -1 })).toBeNull()
  })
  it('supports phone addition once, retaining calibration and observer read-only rights', () => {
    const { s, phone, browser, other, command } = setup(); command(browser, 'start')
    const oldId = s.core.activeBallId, calibration = s.calibration, epoch = s.epoch
    s.core.activeBall.body.setTranslation({ x: 0.9, y: -0.4, z: 0 }, true); s.core.step()
    expect(command(other, 'add-ball').ok).toBe(false)
    expect(command(phone, 'add-ball', 'add-once').ok).toBe(true)
    const newId = s.core.activeBallId
    expect(newId).not.toBe(oldId); expect(s.epoch).toBe(epoch); expect(s.calibration).toBe(calibration)
    expect(command(phone, 'add-ball', 'add-once').ok).toBe(true); expect(s.core.activeBallId).toBe(newId)
    expect(command(phone, 'add-ball', 'add-again').ok).toBe(false)
    expect(command(phone, 'return').ok).toBe(false)
  })
  it('gives v1 clients an upgrade state and rejects the removed Return command', () => {
    const { s, phone, browser } = setup()
    s.handle(phone, { type: 'world-hello', protocolVersion: 1 })
    expect(s.snapshot().phase).toBe('unsupported')
    s.handle(browser, { type: 'world-hello', protocolVersion: 1 })
    // A new hello clears the receipt window and sends a compatible upgrade notice.
    const p = s.peers.get(browser)
    if (p.awaiting) s.handle(browser, { type: 'world-ack', protocolVersion: 1, worldId: s.worldId, sequence: p.awaiting.sequence })
    expect(browser.messages.some((m) => m.type === 'world-snapshot' && m.protocolVersion === 1 && m.phase === 'unsupported')).toBe(true)
    s.handle(browser, { type: 'world-command', protocolVersion: 1, commandId: 'legacy-return', worldId: s.worldId, epoch: s.epoch, action: 'return' })
    expect(browser.messages.filter((m) => m.type === 'world-result').at(-1).ok).toBe(false)
  })
  it('new phone connection pauses and requires renewed capability and calibration', () => {
    const { s, browser, command } = setup(); command(browser, 'start')
    const replacement = new Socket(); s.addPeer(replacement, 'phone')
    s.setPhone({ socket: replacement, sessionId: 'replacement', connectionId: 'replacement-connection' })
    expect(s.phase).toBe('paused'); expect(s.snapshot().canStart).toBe(false)
    expect(command(browser, 'start').ok).toBe(false)
  })

})
