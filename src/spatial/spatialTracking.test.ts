import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { parseSpatialMessage, type SpatialPose, type Quat, type Vec3 } from '../../shared/spatialProtocol.mjs'
import { CAMERA_FROM_BODY, CAMERA_IN_BODY, SPATIAL_MODEL_SCALE, SPATIAL_START, SpatialTracker, applyCalibration, cameraToBody, makeCalibration } from './spatialTracking'

const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
function pose(sequence = 1, bodyPosition: Vec3 = [1, 2, 3], bodyRotation = flat, extra = {}) {
  return {
    type: 'spatial-pose' as const, source: 'fixture' as const, sessionId: 'session-a', connectionId: 'connection-a',
    sequence, sampledAtMs: 1000, trackingState: 'normal' as const, reason: 'ready',
    clockOffsetMs: null, clockRttMs: null,
    positionMeters: new Vector3(...bodyPosition).add(new Vector3(...CAMERA_IN_BODY).applyQuaternion(bodyRotation)).toArray(),
    quaternion: bodyRotation.clone().multiply(CAMERA_FROM_BODY.clone().invert()).toArray(),
    ...extra,
  }
}
function connected() {
  const tracker = new SpatialTracker()
  tracker.receive({ type: 'spatial-link', connected: true, sessionId: 'session-a', connectionId: 'connection-a' }, 1000)
  tracker.receive(pose(), 1000)
  return tracker
}
function closeVector(actual: number[], expected: number[]) {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 7))
}
describe('spatial coordinates', () => {
  it('scales a three-unit asset to its physical height in meters', () => {
    expect(3 * SPATIAL_MODEL_SCALE).toBeCloseTo(0.14961, 9)
  })
  it('maps an identity AR camera basis to device right, top and screen axes', () => {
    const body = cameraToBody({ positionMeters: [0, 0, 0], quaternion: [0, 0, 0, 1] })
    const q = new Quaternion(...body.quaternion)
    closeVector(new Vector3(1, 0, 0).applyQuaternion(q).toArray(), [0, 1, 0])
    closeVector(new Vector3(0, 1, 0).applyQuaternion(q).toArray(), [-1, 0, 0])
    closeVector(new Vector3(0, 0, 1).applyQuaternion(q).toArray(), [0, 0, 1])
  })
  it('undoes the fixed camera basis and lever arm in any device orientation', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.3)
    const body = cameraToBody(pose(1, [0.3, 0.8, -0.5], q))
    closeVector(body.position, [0.3, 0.8, -0.5])
    expect(new Quaternion(...body.quaternion).angleTo(q)).toBeLessThan(1e-7)
  })
  it('calibrates yaw and translation without erasing tilt', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.8).multiply(flat)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35))
    const body = cameraToBody(pose(1, [1, 2, 3], q))
    const result = applyCalibration(body, makeCalibration(body)!)
    closeVector(result.position, SPATIAL_START)
    expect(new Quaternion(...result.quaternion).angleTo(flat)).toBeCloseTo(0.35, 7)
    // Yaw must preserve gravity even for a tilted origin.
    const normal = new Vector3(0, 0, 1).applyQuaternion(q)
    const calibratedNormal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...result.quaternion))
    expect(calibratedNormal.y).toBeCloseTo(normal.y, 8)
  })
  it('rejects an upright top edge that cannot define a horizontal heading', () => {
    expect(makeCalibration({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] })).toBeNull()
  })
})
describe('spatial lifecycle and rendered pose', () => {
  it.each([0, 1, 2])('renders a 20 cm translation on axis %i without grounding or camera compensation', (axis) => {
    const tracker = connected()
    expect(tracker.setOrigin(1000)).toBe(true)
    const position: Vec3 = [1, 2, 3]; position[axis] += 0.2
    tracker.receive(pose(2, position), 1100)
    const expected = [...SPATIAL_START]; expected[axis] += 0.2
    closeVector(tracker.render(1100).position, expected)
  })
  it('rotates about the estimated body origin without inventing translation', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    tracker.receive(pose(2, [1, 2, 3], new Quaternion()), 1100)
    closeVector(tracker.render(1100).position, SPATIAL_START)
    expect(new Quaternion(...tracker.rendered.quaternion).angleTo(new Quaternion())).toBeLessThan(1e-7)
  })
  it('freezes on stale data and demands recalibration after recovery', () => {
    const tracker = connected(); tracker.setOrigin(1000); tracker.render(1000)
    const frozen = structuredClone(tracker.rendered)
    tracker.render(1251)
    expect(tracker.phase).toBe('stale')
    tracker.receive(pose(2, [4, 5, 6]), 1300)
    expect(tracker.phase).toBe('calibrate')
    expect(tracker.render(1300)).toEqual(frozen)
    tracker.setOrigin(1300)
    closeVector(tracker.render(1300).position, SPATIAL_START)
  })
  it('detects a gap even if render and interval timers were suspended', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    tracker.receive(pose(2), 1500)
    expect(tracker.phase).toBe('calibrate')
    expect(tracker.calibration).toBeNull()
  })
  it('invalidates on a status-only interruption, and never calibrates from an old normal pose', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    tracker.receive({ ...pose(2), type: 'spatial-status', trackingState: 'limited', reason: 'Camera obstructed' }, 1100)
    expect(tracker.phase).toBe('limited')
    expect(tracker.setOrigin(1100)).toBe(false)
    tracker.receive(pose(3), 1110)
    expect(tracker.phase).toBe('calibrate')
  })
  it('ignores old sessions, old connections, duplicate sequences and invalid quaternions', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    for (const sample of [
      pose(4, [9, 9, 9], flat, { sessionId: 'old' }),
      pose(4, [9, 9, 9], flat, { connectionId: 'old' }),
      pose(1, [9, 9, 9]),
      pose(4, [9, 9, 9], flat, { quaternion: [0, 0, 0, 0] }),
    ]) tracker.receive(sample, 1100)
    expect(tracker.sequence).toBe(1)
    closeVector(tracker.render(1100).position, SPATIAL_START)
  })
  it('requires origin again after reconnect even when AR session id is unchanged', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    tracker.receive({ type: 'spatial-link', connected: true, sessionId: 'session-a', connectionId: 'connection-b' }, 1100)
    expect(tracker.setOrigin(1100)).toBe(false)
    tracker.receive(pose(2), 1100)
    expect(tracker.latest).toBeNull()
    tracker.receive(pose(3, [1, 2, 3], flat, { connectionId: 'connection-b' }), 1110)
    expect(tracker.phase).toBe('calibrate')
  })
  it('does not show cross-device timing without usable synchronization', () => {
    const tracker = connected()
    expect(tracker.sampleAge(1100)).toBeNull()
    tracker.receive(pose(2, [1, 2, 3], flat, { clockOffsetMs: 50, clockRttMs: 4 }), 1100)
    expect(tracker.sampleAge(1100)).toBe(50)
    tracker.receive(pose(3, [1, 2, 3], flat, { clockOffsetMs: 50, clockRttMs: 90 }), 1110)
    expect(tracker.sampleAge(1110)).toBeNull()
  })
  it('rejects packets whose synchronized sample is already too old', () => {
    const tracker = connected(); tracker.setOrigin(1000)
    tracker.receive(pose(2, [1, 2, 3], flat, { sampledAtMs: 1, clockOffsetMs: 0, clockRttMs: 2 }), 1100)
    expect(tracker.phase).toBe('stale')
    expect(tracker.setOrigin(1100)).toBe(false)
  })
  it('records raw camera and calibrated render data separately and bounds recording', () => {
    const tracker = connected(); tracker.startRecording(); tracker.recordLimit = 3
    tracker.setOrigin(1000); tracker.receive(pose(2), 1100); tracker.render(1100); tracker.render(1110)
    const report = tracker.report()
    expect(report.records).toHaveLength(3)
    expect(report.droppedRecords).toBe(1)
    expect(report.records.map((r) => (r as { event: string }).event)).toEqual(['calibration', 'received', 'render-submission'])
  })
  it('strips unrecognized fields, including image data', () => {
    expect(parseSpatialMessage({ ...pose(), image: 'not allowed' })).not.toHaveProperty('image')
    expect(parseSpatialMessage({ ...pose(), positionMeters: [NaN, 0, 0] })).toBeNull()
    expect(parseSpatialMessage({ ...pose(), quaternion: [0, 0, 0, 1] as Quat }) as SpatialPose).not.toBeNull()
  })
})
