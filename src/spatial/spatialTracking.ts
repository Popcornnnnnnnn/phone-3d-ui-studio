import { Quaternion, Vector3 } from 'three'
import { IPHONE_17_MM, IPHONE_17_SCENE, MODEL_HEIGHT } from '../model/iphone17'
import { parseSpatialMessage, SPATIAL_STALE_MS, type SpatialPose, type Vec3, type Quat } from '../../shared/spatialProtocol.mjs'

export const SPATIAL_MODEL_SCALE = IPHONE_17_MM.height / 1000 / MODEL_HEIGHT
export const SPATIAL_START: Vec3 = [0, 0.2, 0]
// Geometric approximation from RearCameraSystem, not a measured optical center.
export const CAMERA_IN_BODY: Vec3 = [
  0.43 * SPATIAL_MODEL_SCALE, 1.08 * SPATIAL_MODEL_SCALE,
  (-IPHONE_17_SCENE.depth / 2 - 0.046) * SPATIAL_MODEL_SCALE,
]
// ARCamera +X points toward the phone bottom, +Y toward its right, +Z out of its screen.
export const CAMERA_FROM_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
export interface Transform { position: Vec3; quaternion: Quat }
export interface Calibration { origin: Vector3; yaw: Quaternion }
export type TrackingPhase = 'connecting' | 'disconnected' | 'initializing' | 'calibrate' | 'tracking' | 'limited' | 'stale' | 'error'

export function cameraToBody(sample: Pick<SpatialPose, 'positionMeters' | 'quaternion'>): Transform {
  const rotation = new Quaternion(...sample.quaternion).multiply(CAMERA_FROM_BODY).normalize()
  const position = new Vector3(...sample.positionMeters).sub(new Vector3(...CAMERA_IN_BODY).applyQuaternion(rotation))
  return { position: position.toArray(), quaternion: rotation.toArray() }
}
export function makeCalibration(body: Transform): Calibration | null {
  const top = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...body.quaternion))
  if (Math.hypot(top.x, top.z) < 0.2) return null
  return {
    origin: new Vector3(...body.position),
    yaw: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(top.x, -top.z)),
  }
}
export function applyCalibration(body: Transform, calibration: Calibration): Transform {
  return {
    position: new Vector3(...body.position).sub(calibration.origin).applyQuaternion(calibration.yaw).add(new Vector3(...SPATIAL_START)).toArray(),
    quaternion: calibration.yaw.clone().multiply(new Quaternion(...body.quaternion)).normalize().toArray(),
  }
}

export class SpatialTracker {
  phase: TrackingPhase = 'connecting'
  reason = 'Connecting to the local bridge.'
  sessionId: string | null = null
  connectionId: string | null = null
  sequence = -1
  latest: SpatialPose | null = null
  source: SpatialPose['source'] | null = null
  receivedAtMs = -Infinity
  calibration: Calibration | null = null
  rendered: Transform = { position: [...SPATIAL_START], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
  renderedAtMs: number | null = null
  bridgeReceivedAtMs: number | null = null
  revision = 0
  recording = false
  records: object[] = []
  recordLimit = 40_000
  droppedRecords = 0
  private record(value: object) {
    if (!this.recording) return
    if (this.records.length < this.recordLimit) this.records.push(value)
    else this.droppedRecords += 1
  }
  startRecording() { this.records = []; this.droppedRecords = 0; this.recording = true }
  invalidate(phase: TrackingPhase, reason: string) {
    if (this.calibration) this.revision += 1
    this.calibration = null
    this.phase = phase
    this.reason = reason
  }
  disconnect(reason = 'Open the iPhone app and start Spatial tracking.') {
    this.invalidate('disconnected', reason)
    this.sessionId = null; this.connectionId = null; this.latest = null; this.source = null; this.sequence = -1
  }
  receive(value: unknown, now = Date.now()) {
    if (!value || typeof value !== 'object') return
    const envelope = value as Record<string, unknown>
    if (envelope.type === 'spatial-link') {
      if (envelope.connected !== true) { this.disconnect(); return }
      if (typeof envelope.sessionId !== 'string' || typeof envelope.connectionId !== 'string') return
      if (this.connectionId === envelope.connectionId && this.sessionId === envelope.sessionId) return
      this.invalidate('initializing', 'Waiting for a fresh tracking frame.')
      this.sessionId = envelope.sessionId; this.connectionId = envelope.connectionId
      this.sequence = -1; this.latest = null; this.source = null
      this.record({ event: 'session', atMs: now, sessionId: this.sessionId, connectionId: this.connectionId })
      return
    }
    const sample = parseSpatialMessage(value)
    if (!sample || sample.sessionId !== this.sessionId ||
        envelope.connectionId !== this.connectionId || sample.sequence <= this.sequence) return
    this.sequence = sample.sequence
    this.source = sample.source
    this.record({ event: 'received', receivedAtMs: now, ...sample, connectionId: this.connectionId, bridgeReceivedAtMs: envelope.bridgeReceivedAtMs })
    if (sample.trackingState !== 'normal') {
      this.latest = null
      const phase = ['denied', 'unsupported', 'error'].includes(sample.trackingState) ? 'error'
        : sample.trackingState === 'initializing' ? 'initializing' : 'limited'
      this.invalidate(phase, sample.reason)
      return
    }
    if (sample.type !== 'spatial-pose') return
    // Detect a gap even when a timer/render was throttled while the tab was hidden.
    if (now - this.receivedAtMs > SPATIAL_STALE_MS && this.calibration) {
      this.invalidate('stale', 'Tracking resumed. Set origin again to continue.')
    }
    this.latest = sample
    this.receivedAtMs = now
    this.bridgeReceivedAtMs = typeof envelope.bridgeReceivedAtMs === 'number' ? envelope.bridgeReceivedAtMs : null
    if (this.isFresh(now)) {
      this.phase = this.calibration ? 'tracking' : 'calibrate'
      this.reason = this.calibration ? 'Live position and orientation.' : 'Tracking is ready. Hold the phone screen-up and set origin.'
    } else this.invalidate('stale', 'The latest tracking sample is delayed. Wait for fresh tracking.')
  }
  sampleAge(now = Date.now()): number | null {
    const s = this.latest
    if (!s || s.clockOffsetMs === null || s.clockRttMs === null || s.clockRttMs > 50) return null
    const age = now - (s.sampledAtMs + s.clockOffsetMs)
    return age >= -50 ? Math.max(0, age) : null
  }
  isFresh(now = Date.now()) {
    return this.latest !== null && now - this.receivedAtMs <= SPATIAL_STALE_MS &&
      (this.sampleAge(now) ?? 0) <= SPATIAL_STALE_MS
  }
  checkFreshness(now = Date.now()) {
    if (this.latest && !this.isFresh(now)) {
      this.invalidate('stale', 'Tracking paused or delayed. Restore tracking, then set origin again.')
    }
  }
  setOrigin(now = Date.now()) {
    this.checkFreshness(now)
    if (!this.isFresh(now) || !this.latest) return false
    const calibration = makeCalibration(cameraToBody(this.latest))
    if (!calibration) {
      this.reason = 'Hold the screen facing up, with its top pointing toward the Mac.'
      return false
    }
    this.calibration = calibration; this.phase = 'tracking'; this.revision += 1
    this.reason = 'Origin set. Move the phone in any direction.'
    this.record({ event: 'calibration', atMs: now, origin: calibration.origin.toArray(), yaw: calibration.yaw.toArray() })
    return true
  }
  render(now = Date.now()) {
    this.checkFreshness(now)
    if (this.phase === 'tracking' && this.calibration && this.latest) {
      this.rendered = applyCalibration(cameraToBody(this.latest), this.calibration)
      this.renderedAtMs = now
      this.record({ event: 'render-submission', atMs: now, sessionId: this.sessionId,
        sequence: this.sequence, sampleAgeMs: this.sampleAge(now), ...this.rendered })
    }
    return this.rendered
  }
  report() {
    this.recording = false
    return { schema: 'phone3d.spatial.v1', units: 'meters', origin: 'ARCamera',
      cameraInBodyApproxMeters: CAMERA_IN_BODY, initialDisplayPositionMeters: SPATIAL_START,
      timingEvidence: 'CPU render submission, not visible photon latency',
      physicalAcceptance: 'not established by this telemetry', droppedRecords: this.droppedRecords, records: this.records }
  }
}
