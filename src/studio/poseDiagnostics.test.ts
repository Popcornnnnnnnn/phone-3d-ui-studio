import { describe, expect, it } from 'vitest'
import { multiplyQuaternions, type QuaternionTuple } from './liveProtocol'
import {
  buildPoseAccuracySnapshot,
  quaternionAngularDistance,
  quaternionAxisAngle,
  STANDARD_TABLETOP_QUATERNION,
} from './poseDiagnostics'

const SQRT_HALF = Math.SQRT1_2

describe('pose diagnostics', () => {
  it('reports no rotation for the identity quaternion', () => {
    expect(quaternionAxisAngle([0, 0, 0, 1]).angleDegrees).toBeCloseTo(0)
  })

  it('extracts a 90 degree rotation around sensor Z', () => {
    const rotation = quaternionAxisAngle([0, 0, SQRT_HALF, SQRT_HALF])
    expect(rotation.angleDegrees).toBeCloseTo(90)
    expect(rotation.axis).toEqual([0, 0, 1])
  })

  it('maps a flat-phone 90 degree turn onto the world table axis', () => {
    const sensorTurn: QuaternionTuple = [0, 0, SQRT_HALF, SQRT_HALF]
    const target = multiplyQuaternions(
      STANDARD_TABLETOP_QUATERNION,
      sensorTurn,
    )
    const snapshot = buildPoseAccuracySnapshot(sensorTurn, target, target)

    expect(snapshot.sensorAngleDegrees).toBeCloseTo(90)
    expect(snapshot.targetAngleDegrees).toBeCloseTo(90)
    expect(snapshot.renderedAngleDegrees).toBeCloseTo(90)
    expect(snapshot.targetWorldAxis[1]).toBeCloseTo(1)
    expect(snapshot.tableAxisAlignmentPercent).toBeCloseTo(100)
    expect(snapshot.trackingErrorDegrees).toBeCloseTo(0)
    expect(snapshot.verdict).toBe('Pass')
  })

  it('separates rendering lag from the sensor and target angle', () => {
    const sensorTurn: QuaternionTuple = [0, 0, SQRT_HALF, SQRT_HALF]
    const target = multiplyQuaternions(
      STANDARD_TABLETOP_QUATERNION,
      sensorTurn,
    )
    const rendered60 = multiplyQuaternions(STANDARD_TABLETOP_QUATERNION, [
      0,
      0,
      0.5,
      Math.sqrt(3) / 2,
    ])
    const snapshot = buildPoseAccuracySnapshot(sensorTurn, target, rendered60)

    expect(snapshot.trackingErrorDegrees).toBeCloseTo(30)
    expect(snapshot.verdict).toBe('Hold steady')
    expect(quaternionAngularDistance(target, rendered60)).toBeCloseTo(30)
  })
})
