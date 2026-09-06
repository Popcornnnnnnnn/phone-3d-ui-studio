import { Quaternion, Vector3 } from 'three'
import { interpolateTransform } from '../shared/marbleMath.mjs'

export const TRAY_INPUT_BUFFER_MS = 40
const FILTER_SECONDS = 0.025

// Reconstruct motion in sampling time, not packet-arrival time. A late packet
// must never squeeze a long physical movement into one or two physics steps.
export class TrayMotion {
  constructor(pose, sampledAtMs, nowMs) {
    this.anchor = nowMs - sampledAtMs
    this.samples = [{ at: nowMs, pose: structuredClone(pose) }]
    this.cursor = nowMs - TRAY_INPUT_BUFFER_MS
    this.pose = structuredClone(pose)
    this.lagMs = TRAY_INPUT_BUFFER_MS
    this.speed = 0
  }
  push(pose, sampledAtMs) {
    const at = sampledAtMs + this.anchor, last = this.samples.at(-1), dt = (at - last.at) / 1000
    if (!Number.isFinite(at) || dt <= 0) return 'old'
    const distance = new Vector3(...pose.position).distanceTo(new Vector3(...last.pose.position))
    const angle = new Quaternion(...pose.quaternion).angleTo(new Quaternion(...last.pose.quaternion))
    if (dt > 0.25 || (distance > 0.05 && distance / dt > 2) || (angle > 0.35 && angle / dt > 10)) return 'jump'
    this.samples.push({ at, pose: structuredClone(pose) })
    if (this.samples.length > 128) this.samples.shift()
    return 'accepted'
  }
  step(nowMs, dt) {
    // On underrun, hold the sampling clock. When packets return, play at real
    // speed; do not catch up by accelerating the physical tray.
    this.cursor = Math.min(nowMs - TRAY_INPUT_BUFFER_MS, this.cursor + dt * 1000, this.samples.at(-1).at)
    this.lagMs = nowMs - this.cursor
    if (this.lagMs > 250) return null
    while (this.samples.length > 2 && this.samples[1].at <= this.cursor) this.samples.shift()
    const a = this.samples[0], b = this.samples[1] ?? a
    const t = Math.max(0, Math.min(1, (this.cursor - a.at) / Math.max(1, b.at - a.at)))
    const target = interpolateTransform(a.pose, b.pose, t)
    const filtered = interpolateTransform(this.pose, target, 1 - Math.exp(-dt / FILTER_SECONDS))
    this.speed = new Vector3(...filtered.position).distanceTo(new Vector3(...this.pose.position)) / dt
    this.pose = filtered
    return this.pose
  }
  diagnostics() { return { bufferedSamples: this.samples.length, inputLagMs: this.lagMs, traySpeedMps: this.speed } }
}
