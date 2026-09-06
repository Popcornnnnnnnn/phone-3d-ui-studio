import { randomUUID } from 'node:crypto'
import { initMarblePhysics, MarbleWorld, PHYSICS_DT } from './marble-world.mjs'
import { cameraToBody, makeCalibration, applyCalibration } from '../shared/spatialMath.mjs'
import { MARBLE_GEOMETRY } from '../shared/marbleMath.mjs'
import { parseWorldCommand } from '../shared/worldProtocol.mjs'

export class MarbleService {
  constructor(now = Date.now, { autoTick = true } = {}) {
    this.now = now; this.autoTick = autoTick; this.peers = new Map(); this.worldId = randomUUID()
    this.epoch = 0; this.sequence = 0; this.ownerId = null; this.core = null; this.calibration = null
    this.phoneSource = null; this.latest = null; this.poseReceivedAt = -Infinity; this.phoneCapable = false
    this.phase = 'waiting'; this.reason = 'Start Spatial tracking on the iPhone.'
    this.engineReady = false; this.active = false; this.lastTick = now(); this.lastSnapshot = -Infinity; this.accumulator = 0
  }
  addPeer(socket, role) {
    if (!this.peers.has(socket)) this.peers.set(socket, { socket, role, id: randomUUID(), enabled: false, awaiting: null, pending: null, commands: new Map() })
  }
  setPhone(source) {
    this.phoneSource = source; this.latest = null; this.source = null; this.phoneCapable = false
    if (this.active) this.pause('iPhone connection changed. Restore tracking and start a new round.')
  }
  removePeer(socket) {
    const peer = this.peers.get(socket)
    if (peer?.id === this.ownerId) { this.pause('Control page disconnected. Start a new round to take control.'); this.ownerId = null }
    this.peers.delete(socket)
  }
  receivePose(message, at = this.now()) {
    this.source = message.source
    if (message.trackingState !== 'normal') {
      this.latest = null
      if (this.active) this.pause(message.reason)
    } else if (message.type === 'spatial-pose') {
      this.latest = message; this.poseReceivedAt = at
      if (this.core && this.phase === 'running' && this.calibration && this.fresh(at)) {
        this.core.setPhoneTarget(applyCalibration(cameraToBody(message), this.calibration))
      }
    }
  }
  fresh(at = this.now()) {
    const s = this.latest
    if (!s || !this.phoneSource || !this.phoneCapable || at - this.poseReceivedAt > 250 || s.clockOffsetMs === null || s.clockRttMs === null || s.clockRttMs > 50) return false
    const age = at - (s.sampledAtMs + s.clockOffsetMs)
    return age >= -50 && age <= 250
  }
  control(peer, message) {
    if (peer.socket.readyState !== 1) return
    if (peer.socket.bufferedAmount > 16 * 1024) { peer.socket.close(4008, 'world control congested'); return }
    peer.socket.send(JSON.stringify(message))
  }
  offer(peer, snapshot) {
    if (!peer.enabled || peer.socket.readyState !== 1) return
    if (peer.awaiting) { peer.pending = snapshot; return }
    if (peer.socket.bufferedAmount > 16 * 1024) { peer.socket.close(4008, 'world snapshot congested'); return }
    peer.awaiting = { sequence: snapshot.sequence, sentAt: this.now() }
    peer.socket.send(JSON.stringify(snapshot))
  }
  handle(socket, value) {
    if (!value?.type?.startsWith('world-')) return false
    const peer = this.peers.get(socket)
    if (!peer) return true
    if (value.type === 'world-hello' && value.protocolVersion === 1) {
      peer.enabled = true
      if (peer.role === 'phone' && this.phoneSource?.socket === socket) this.phoneCapable = true
      this.control(peer, { type: 'world-welcome', protocolVersion: 1, clientId: peer.id, worldId: this.worldId })
      if (!this.initializing) this.initializing = initMarblePhysics().then(() => { this.engineReady = true }).catch(() => { this.reason = 'Physics could not initialize. Restart the bridge.' })
      if (this.autoTick && !this.timer) { this.lastTick = this.now(); this.timer = setInterval(() => this.tick(), 8); this.timer.unref?.() }
      this.emitSnapshot()
      return true
    }
    if (!peer.enabled || value.protocolVersion !== 1 || value.worldId !== this.worldId) return true
    if (value.type === 'world-ack') {
      if (peer.awaiting?.sequence !== value.sequence) return true
      peer.awaiting = null
      const pending = peer.pending; peer.pending = null
      if (pending) this.offer(peer, pending)
      return true
    }
    const command = parseWorldCommand(value)
    if (!command) return true
    if (peer.commands.has(command.commandId)) { this.control(peer, peer.commands.get(command.commandId)); return true }
    let reason = '', ok = false
    if (command.epoch !== this.epoch) reason = 'Round changed. Use the current controls.'
    else if (peer.role === 'phone' && !['pause', 'stop'].includes(command.action)) reason = 'Start and control rounds from the Mac.'
    else if (command.action === 'start') {
      if (this.phase === 'running' && this.ownerId !== peer.id) reason = 'Another page controls this round.'
      else if (!this.engineReady || !this.fresh()) reason = 'Wait for normal tracking and clock synchronization.'
      else {
        const calibration = makeCalibration(cameraToBody(this.latest))
        if (!calibration) reason = 'Hold screen up, with the phone top toward the Mac.'
        else {
          this.core?.free(); this.calibration = calibration
          this.core = new MarbleWorld(applyCalibration(cameraToBody(this.latest), calibration))
          this.ownerId = peer.id; this.epoch++; this.phase = 'running'; this.active = true
          this.reason = 'Tilt toward the right opening to pour the marble.'
          this.accumulator = 0; this.lastTick = this.now(); ok = true
        }
      }
    } else if (peer.role !== 'phone' && this.ownerId !== peer.id) reason = 'This page is an observer.'
    else if (command.action === 'pause') { this.pause('Round paused. Restore tracking and start a new round.'); this.ownerId = null; ok = true }
    else if (command.action === 'stop') {
      this.core?.free(); this.core = null; this.calibration = null; this.active = false; this.ownerId = null
      this.epoch++; this.phase = 'ready'; ok = true
    } else if (!this.core || !this.fresh() || !['running', 'lost'].includes(this.phase)) reason = 'Restore tracking and start a new round.'
    else if (command.action === 'reset') {
      this.core.resetBall(applyCalibration(cameraToBody(this.latest), this.calibration))
      this.epoch++; this.phase = 'running'; this.reason = 'Ball reset. Tilt toward the right opening.'; ok = true
    } else if (command.action === 'return') {
      ok = this.core.launchReturn(); reason = ok ? 'Move the phone into the marked catch zone.' : 'Wait until the ball rests on the ground.'
      if (ok) this.reason = reason
    }
    const result = { type: 'world-result', protocolVersion: 1, commandId: command.commandId, ok, reason, epoch: this.epoch }
    peer.commands.set(command.commandId, result)
    if (peer.commands.size > 128) peer.commands.delete(peer.commands.keys().next().value)
    this.control(peer, result); this.emitSnapshot()
    return true
  }
  pause(reason) {
    if (!this.active) return
    if (this.phase !== 'paused') this.epoch++
    this.phase = 'paused'; this.reason = reason; this.accumulator = 0
  }
  tick(at = this.now()) {
    const elapsed = at - this.lastTick; this.lastTick = at
    if (this.active && this.phase === 'running' && (!this.fresh(at) || elapsed > 250 || elapsed < 0)) {
      this.pause('Tracking paused or delayed. Restore tracking and start a new round.')
    }
    for (const peer of this.peers.values()) {
      if (peer.awaiting && at - peer.awaiting.sentAt > 250 && (peer.id === this.ownerId || peer.role === 'phone')) this.pause('A display stopped receiving fresh state. Reconnect and start a new round.')
      if (peer.awaiting && at - peer.awaiting.sentAt > 1000) peer.socket.close(4008, 'world snapshot receipt timed out')
    }
    if (this.phase === 'running' && this.core) {
      this.accumulator += elapsed / 1000
      let steps = 0
      while (this.accumulator >= PHYSICS_DT && steps++ < 8) { this.core.step(); this.accumulator -= PHYSICS_DT }
      if (this.core.lost) { this.phase = 'lost'; this.reason = 'Ball left the workspace. Reset ball to try again.' }
    }
    if (at - this.lastSnapshot >= (this.phase === 'running' ? 1000 / 60 : 100)) { this.lastSnapshot = at; this.emitSnapshot() }
  }
  snapshot() {
    let phase = this.phase, reason = this.reason
    if (!this.active) {
      phase = !this.phoneSource ? 'waiting' : !this.phoneCapable ? 'unsupported' : this.fresh() && this.engineReady ? 'ready' : 'waiting'
      reason = !this.phoneSource ? 'Open the iPhone app and start Spatial tracking.' : !this.phoneCapable ? 'Install the S2 iPhone app to use Marble.' : phase === 'ready' ? 'Hold screen up, top toward the Mac, then start round.' : 'Waiting for normal tracking and clock synchronization.'
    }
    if (phase === 'running' && this.core) {
      reason = this.core.canReturn ? 'Click Return, then move the phone into the fixed catch zone.'
        : this.core.region === 'returning' ? 'Catch the descending marble in the marked zone.'
        : this.core.region === 'phone' && this.core.catchCount > 0 ? 'Caught! Tilt right to pour again.'
        : this.core.region === 'world' ? 'Let the marble settle on the ground.' : reason
    }
    return { type: 'world-snapshot', protocolVersion: 1, worldId: this.worldId, epoch: this.epoch,
      sequence: this.sequence++, serverTimeMs: this.now(), phase, reason, ownerId: this.ownerId,
      phoneSessionId: this.phoneSource?.sessionId ?? null, phoneConnectionId: this.phoneSource?.connectionId ?? null,
      source: this.source ?? null, active: this.active, canStart: this.engineReady && this.fresh(),
      geometry: MARBLE_GEOMETRY,
      phone: null, ball: null, catchCount: 0, catchTarget: [0, 0.2, 0], region: 'phone', canReturn: false,
      ...this.core?.snapshot(),
    }
  }
  emitSnapshot() { const s = this.snapshot(); for (const peer of this.peers.values()) this.offer(peer, s) }
  shutdown() { clearInterval(this.timer); this.core?.free(); this.core = null; this.peers.clear() }
}
