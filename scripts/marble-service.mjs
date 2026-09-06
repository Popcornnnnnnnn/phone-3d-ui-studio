import { randomUUID } from 'node:crypto'
import { TrayMotion } from './tray-motion.mjs'
import { initMarblePhysics, isTrayUp, MarbleWorld, PHYSICS_DT } from './marble-world.mjs'
import { cameraToBody, makeCalibration, applyCalibration } from '../shared/spatialMath.mjs'
import { marbleGeometry, scaleMarbleTranslation } from '../shared/marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS } from '../shared/marbleSettings.mjs'
import { parseWorldCommand, WORLD_VERSION } from '../shared/worldProtocol.mjs'

// A v1 client can still show an actionable upgrade notice and send receipts without breaking S1.
function legacySnapshot(s) {
  return { ...s, protocolVersion: 1, phase: 'unsupported', reason: 'Elastic Tray needs the v2 iPhone app and Web page. Update the app and reload the page.',
    active: false, ownerId: null, canStart: false, canReturn: false, catchCount: 0, catchTarget: [0, 0.2, 0], region: 'phone', phone: null, ball: null }
}
export class MarbleService {
  constructor(now = Date.now, { autoTick = true } = {}) {
    this.now = now; this.autoTick = autoTick; this.peers = new Map(); this.worldId = randomUUID()
    this.epoch = 0; this.sequence = 0; this.ownerId = null; this.core = null; this.calibration = null; this.motion = null
    this.phoneSource = null; this.latest = null; this.poseReceivedAt = -Infinity; this.phoneCapable = false
    this.phase = 'waiting'; this.reason = 'Start Spatial tracking on the iPhone.'
    this.settings = { ...DEFAULT_MARBLE_SETTINGS }
    this.engineReady = false; this.active = false; this.lastTick = now(); this.lastSnapshot = -Infinity; this.accumulator = 0
  }
  addPeer(socket, role) {
    if (!this.peers.has(socket)) this.peers.set(socket, { socket, role, id: randomUUID(), version: null, awaiting: null, pending: null, commands: new Map() })
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
      if (this.motion && this.phase === 'running' && this.calibration && this.fresh(at)) {
        const result = this.motion.push(applyCalibration(cameraToBody(message), this.calibration), message.sampledAtMs)
        if (result === 'jump') this.pause('Tracking jumped. Hold the phone above a textured surface and recalibrate.')
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
    if (!peer.version || peer.socket.readyState !== 1) return
    if (peer.awaiting) { peer.pending = snapshot; return }
    if (peer.socket.bufferedAmount > 16 * 1024) { peer.socket.close(4008, 'world snapshot congested'); return }
    peer.awaiting = { sequence: snapshot.sequence, sentAt: this.now() }
    peer.socket.send(JSON.stringify(peer.version === 1 ? legacySnapshot(snapshot) : snapshot))
  }
  handle(socket, value) {
    if (!value?.type?.startsWith('world-')) return false
    const peer = this.peers.get(socket)
    if (!peer) return true
    if (value.type === 'world-hello') {
      if (![1, WORLD_VERSION].includes(value.protocolVersion)) {
        this.control(peer, { type: 'world-upgrade', protocolVersion: WORLD_VERSION, reason: 'Update the iPhone app and reload the Web page.' }); return true
      }
      peer.version = value.protocolVersion
      if (peer.role === 'phone' && this.phoneSource?.socket === socket) this.phoneCapable = peer.version === WORLD_VERSION
      this.control(peer, { type: 'world-welcome', protocolVersion: peer.version, clientId: peer.id, worldId: this.worldId })
      if (peer.version === WORLD_VERSION && !this.initializing) this.initializing = initMarblePhysics().then(() => { this.engineReady = true }).catch(() => { this.reason = 'Physics could not initialize. Restart the bridge.' })
      if (this.autoTick && !this.timer) { this.lastTick = this.now(); this.timer = setInterval(() => this.tick(), 8); this.timer.unref?.() }
      this.emitSnapshot(); return true
    }
    if (!peer.version || value.protocolVersion !== peer.version || value.worldId !== this.worldId) return true
    if (value.type === 'world-ack') {
      if (peer.awaiting?.sequence !== value.sequence) return true
      peer.awaiting = null
      const pending = peer.pending; peer.pending = null
      if (pending) this.offer(peer, pending)
      return true
    }
    if (value.type !== 'world-command') return true
    if (typeof value.commandId !== 'string' || value.commandId.length < 1 || value.commandId.length > 128) return true
    if (peer.commands.has(value.commandId)) { this.control(peer, peer.commands.get(value.commandId)); return true }
    const command = parseWorldCommand(value)
    let reason = '', ok = false
    if (!command) reason = 'This command is not supported. Update the app and reload the page.'
    else if (command.epoch !== this.epoch) reason = 'Round changed. Use the current controls.'
    else if (peer.role === 'phone' && this.phoneSource?.socket !== socket) reason = 'This iPhone connection is no longer current.'
    else if (peer.role === 'phone' && command.action === 'start') reason = 'Start and calibrate from the Mac.'
    else if (command.action === 'start') {
      if (this.phase === 'running' && this.ownerId !== peer.id) reason = 'Another page controls this round.'
      else if (!this.engineReady || !this.fresh()) reason = 'Wait for normal tracking and clock synchronization.'
      else {
        const body = cameraToBody(this.latest), calibration = makeCalibration(body)
        if (!calibration || !isTrayUp(body)) reason = 'Hold the screen facing up and nearly level, with the top toward the Mac.'
        else {
          const settings = command.settings ?? this.settings
          const next = new MarbleWorld(applyCalibration(body, calibration), settings)
          this.core?.free(); this.calibration = calibration; this.settings = { ...settings }; this.core = next
          this.motion = new TrayMotion(this.core.phone, this.latest.sampledAtMs, this.now())
          this.ownerId = peer.id; this.epoch++; this.phase = 'running'; this.active = true
          this.reason = 'Gently lift the tray to toss the ball, then catch it.'
          this.accumulator = 0; this.lastTick = this.now(); ok = true
        }
      }
    } else if (peer.role !== 'phone' && this.ownerId !== peer.id) reason = 'This page is an observer.'
    else if (command.action === 'pause') { this.pause('Round paused. Restore tracking and start a new round.'); this.ownerId = null; ok = true }
    else if (command.action === 'stop') {
      this.core?.free(); this.core = null; this.calibration = null; this.motion = null; this.active = false; this.ownerId = null
      this.epoch++; this.phase = 'ready'; ok = true
    } else if (!this.core || !this.fresh() || this.phase !== 'running') reason = 'Restore tracking and start a new round.'
    else if (command.action === 'add-ball') {
      // Check both the latest sample and the simulated tray, without teleporting the kinematic body.
      const up = isTrayUp(cameraToBody(this.latest))
      ok = up && this.core.addBall()
      reason = ok ? 'New ball added. Gently toss and catch it.' : this.core.activeBallId ? 'Keep playing the current ball.' : 'Hold the screen facing up and nearly level to add a ball.'
    }
    const result = { type: 'world-result', protocolVersion: peer.version, commandId: value.commandId, ok, reason, epoch: this.epoch }
    peer.commands.set(value.commandId, result)
    if (peer.commands.size > 128) peer.commands.delete(peer.commands.keys().next().value)
    this.control(peer, result); this.emitSnapshot(); return true
  }
  pause(reason) {
    if (!this.active) return
    if (this.phase !== 'paused') this.epoch++
    this.phase = 'paused'; this.reason = reason; this.accumulator = 0
  }
  tick(at = this.now()) {
    const elapsed = at - this.lastTick; this.lastTick = at
    if (this.active && this.phase === 'running' && (!this.fresh(at) || elapsed > 250 || elapsed < 0)) this.pause('Tracking paused or delayed. Keep the app open, check the local network, then start a new round.')
    for (const peer of this.peers.values()) {
      if (peer.awaiting && at - peer.awaiting.sentAt > 250 && (peer.id === this.ownerId || peer.role === 'phone')) this.pause('A display stopped receiving fresh state. Check the local network and start a new round.')
      if (peer.awaiting && at - peer.awaiting.sentAt > 1000) peer.socket.close(4008, 'world snapshot receipt timed out')
    }
    if (this.phase === 'running' && this.core) {
      this.accumulator += elapsed / 1000
      let steps = 0
      while (this.accumulator >= PHYSICS_DT && steps++ < 8) {
        const stepAt = at - this.accumulator * 1000 + PHYSICS_DT * 1000
        const phone = this.motion.step(stepAt, PHYSICS_DT)
        if (!phone) { this.pause('Phone motion samples stopped. Restore tracking and recalibrate.'); break }
        // Keep jump detection in true meters; scale only the reconstructed tray
        // translation, before physics and both renderers receive the same pose.
        this.core.setPhoneTarget(scaleMarbleTranslation(phone, this.settings.movementScale))
        this.core.step(stepAt); this.accumulator -= PHYSICS_DT
      }
    }
    if (at - this.lastSnapshot >= (this.phase === 'running' ? 1000 / 60 : 100)) { this.lastSnapshot = at; this.emitSnapshot() }
  }
  snapshot() {
    let phase = this.phase, reason = this.reason
    const fresh = this.fresh()
    if (!this.active) {
      phase = !this.phoneSource ? 'waiting' : !this.phoneCapable ? 'unsupported' : fresh && this.engineReady ? 'ready' : 'waiting'
      reason = !this.phoneSource ? 'Open the iPhone app on the same local network and start Spatial tracking.' : !this.phoneCapable ? 'Install the v2 Elastic Tray app to use this mode.' : phase === 'ready' ? 'Screen up, top toward the Mac. Start to set your origin.' : 'Waiting for normal tracking and clock synchronization. Keep the app in the foreground.'
    } else if (phase === 'running' && this.core) {
      reason = !this.core.activeBallId ? this.core.lastOutcome : this.core.region === 'air' ? 'Move the tray under the ball to catch it.' : this.core.hitCount > 0 ? 'Nice contact. Gently toss the ball again.' : 'Gently lift the tray to toss the ball, then catch it.'
      if (!this.core.activeBallId && !this.core.canAddBall) reason = 'Hold the screen facing up and nearly level, then tap Add ball on your phone.'
    }
    const state = this.core?.snapshot()
    return { type: 'world-snapshot', protocolVersion: WORLD_VERSION, worldId: this.worldId, epoch: this.epoch,
      sequence: this.sequence++, serverTimeMs: this.now(), phase, reason, ownerId: this.ownerId,
      phoneSessionId: this.phoneSource?.sessionId ?? null, phoneConnectionId: this.phoneSource?.connectionId ?? null,
      source: this.source ?? null, active: this.active, canStart: this.engineReady && fresh,
      geometry: this.core?.geometry ?? marbleGeometry(this.settings), settings: { ...this.settings },
      phone: null, balls: [], activeBallId: null, hitCount: 0, lastImpact: null, region: 'needs-ball',
      motion: this.motion?.diagnostics() ?? null,
      ...state, canAddBall: !!state?.canAddBall && phase === 'running' && fresh && isTrayUp(cameraToBody(this.latest)),
    }
  }
  emitSnapshot() { const s = this.snapshot(); for (const peer of this.peers.values()) this.offer(peer, s) }
  shutdown() { clearInterval(this.timer); this.core?.free(); this.core = null; this.peers.clear() }
}
