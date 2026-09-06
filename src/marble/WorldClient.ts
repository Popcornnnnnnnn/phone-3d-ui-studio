import { parseWorldSnapshot, WORLD_VERSION, type WorldSnapshot, type WorldAction } from '../../shared/worldProtocol.mjs'
import { interpolateSnapshot } from '../../shared/marbleMath.mjs'
import type { MarbleSettings } from '../../shared/marbleSettings.mjs'

export class WorldClient {
  clientId: string | null = null
  worldId: string | null = null
  latest: WorldSnapshot | null = null
  visual: WorldSnapshot | null = null
  frames: WorldSnapshot[] = []
  receivedAt = -Infinity
  needsRestart = false
  connected = false
  message = 'Connecting to the shared world.'
  send: (value: object) => void = () => {}
  recording = false
  records: object[] = []
  droppedRecords = 0
  record(value: object) { if (this.recording) { if (this.records.length < 100_000) this.records.push(value); else this.droppedRecords++ } }
  get isOwner() { return !!this.clientId && this.latest?.ownerId === this.clientId }
  receive(value: unknown, now = Date.now()) {
    if (!value || typeof value !== 'object') return
    const v = value as Record<string, unknown>
    if (v.type === 'world-welcome' && v.protocolVersion === WORLD_VERSION && typeof v.clientId === 'string' && typeof v.worldId === 'string') {
      if (this.worldId !== v.worldId) { this.latest = null; this.frames = []; this.visual = null }
      this.worldId = v.worldId; this.clientId = v.clientId; this.connected = true; return
    }
    if (v.type === 'world-upgrade') { this.message = 'Update the bridge and iPhone app for Elastic Tray.'; return }
    if (v.type === 'world-welcome' && v.protocolVersion !== WORLD_VERSION) { this.message = 'Update the bridge for Elastic Tray v2.'; return }
    if (v.type === 'world-result' && typeof v.reason === 'string') { this.message = v.reason; return }
    const s = parseWorldSnapshot(v)
    if (!s || s.worldId !== this.worldId || (this.latest && (s.epoch < this.latest.epoch || s.sequence <= this.latest.sequence))) return
    const previous = this.latest
    const gap = now - this.receivedAt > 250 || now - s.serverTimeMs > 250 || s.serverTimeMs - now > 50
    const epochChanged = previous?.epoch !== s.epoch
    this.latest = s; this.receivedAt = now; this.connected = true
    this.send({ type: 'world-ack', protocolVersion: WORLD_VERSION, worldId: s.worldId, sequence: s.sequence })
    this.record({ event: 'world-received', receivedAtMs: now, ...s })
    if (epochChanged) { this.frames = []; this.needsRestart = false }
    if (gap && previous?.phase === 'running' && !epochChanged) this.stale()
    if (now - s.serverTimeMs > 250 || s.serverTimeMs - now > 50) this.stale()
    if (!this.needsRestart) this.frames.push(s)
    if (this.frames.length > 120) this.frames.shift()
    if (!s.active) { this.visual = s; this.needsRestart = false }
    this.message = this.needsRestart ? 'Display paused. Start a new round after tracking recovers.' : s.reason
  }
  command(action: WorldAction, settings?: MarbleSettings) {
    if (!this.latest || !this.worldId || !this.connected) return
    this.send({ type: 'world-command', protocolVersion: WORLD_VERSION, worldId: this.worldId, epoch: this.latest.epoch,
      commandId: crypto.randomUUID(), action, ...(action === 'start' && settings ? { settings } : {}) })
  }
  stale() {
    if (this.needsRestart) return
    this.needsRestart = true; this.message = 'Display paused. Reconnect and start a new round.'
    if (this.isOwner) this.command('pause')
  }
  disconnect() { this.stale(); this.connected = false; this.message = 'Bridge disconnected. Reconnecting…' }
  checkFreshness(now = Date.now()) { if (this.latest?.phase === 'running' && now - this.receivedAt > 250) this.stale() }
  render(now = Date.now()) {
    this.checkFreshness(now)
    if (!this.latest) return null
    if (this.latest.phase !== 'running' || this.needsRestart) return this.visual ?? this.latest
    const time = now - this.latest.geometry.interpolationMs
    let a: WorldSnapshot | undefined, b = this.frames[0] ?? this.latest
    for (const frame of this.frames) { b = frame; if (frame.serverTimeMs >= time) break; a = frame }
    this.visual = interpolateSnapshot(a, b, time)
    this.record({ event: 'render-submission', atMs: now, sequence: this.visual.sequence, epoch: this.visual.epoch,
      phone: this.visual.phone, balls: this.visual.balls, activeBallId: this.visual.activeBallId })
    return this.visual
  }
  startRecording() { this.records = []; this.droppedRecords = 0; this.recording = true }
  report() { this.recording = false; return { schema: 'phone3d.marble.v2', units: 'meters',
    evidence: 'Software states and render submissions; not physical acceptance or visible latency.', droppedRecords: this.droppedRecords, records: this.records } }
}
