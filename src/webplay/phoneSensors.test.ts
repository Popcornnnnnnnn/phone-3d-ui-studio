import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  applyHandheldNeutral,
  applyTabletopYaw,
  calibrateHandheldNeutral,
  calibrateTabletopYaw,
  FlickDetector,
  orientationToBodyQuaternion,
} from './phoneSensors'

describe('phoneSensors', () => {
  it('maps flat screen-up DeviceOrientation (0, 0, 0) to world +Y normal and -Z top', () => {
    const q = new Quaternion(...orientationToBodyQuaternion(0, 0, 0))
    const screenNormal = new Vector3(0, 0, 1).applyQuaternion(q)
    const phoneTop = new Vector3(0, 1, 0).applyQuaternion(q)
    const phoneRight = new Vector3(1, 0, 0).applyQuaternion(q)

    expect(screenNormal.x).toBeCloseTo(0, 5)
    expect(screenNormal.y).toBeCloseTo(1, 5)
    expect(screenNormal.z).toBeCloseTo(0, 5)

    expect(phoneTop.x).toBeCloseTo(0, 5)
    expect(phoneTop.y).toBeCloseTo(0, 5)
    expect(phoneTop.z).toBeCloseTo(-1, 5)

    expect(phoneRight.x).toBeCloseTo(1, 5)
    expect(phoneRight.y).toBeCloseTo(0, 5)
    expect(phoneRight.z).toBeCloseTo(0, 5)
  })

  it('tilting right edge down (gamma > 0) lowers local +X in world Y so ball rolls toward right exit', () => {
    const q = new Quaternion(...orientationToBodyQuaternion(0, 0, 30))
    const phoneRight = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(phoneRight.y).toBeLessThan(-0.45)
  })

  it('tilting top edge up (beta > 0) raises local +Y in world Y', () => {
    const q = new Quaternion(...orientationToBodyQuaternion(0, 30, 0))
    const phoneTop = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(phoneTop.y).toBeGreaterThan(0.45)
  })

  it('tabletop yaw calibration zeros heading while keeping roll and pitch', () => {
    const neutral = orientationToBodyQuaternion(75, 0, 0)
    const cal = calibrateTabletopYaw(neutral)
    expect(cal).not.toBeNull()

    const leveled = applyTabletopYaw(orientationToBodyQuaternion(75, 0, 25), cal)
    const rightAxis = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...leveled))
    expect(rightAxis.y).toBeLessThan(-0.35)
    const topAxis = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...leveled))
    expect(topAxis.z).toBeLessThan(-0.9)
  })

  it('handheld neutral calibration levels a naturally tilted (~35 deg) phone', () => {
    const tiltedHand = orientationToBodyQuaternion(40, 35, 0)
    const cal = calibrateHandheldNeutral(tiltedHand)
    const leveled = new Quaternion(...applyHandheldNeutral(tiltedHand, cal))
    const screenNormal = new Vector3(0, 0, 1).applyQuaternion(leveled)
    expect(screenNormal.y).toBeGreaterThan(0.99)
  })

  it('FlickDetector detects upward linear acceleration with cooldown', () => {
    const detector = new FlickDetector(5.5, 280)
    expect(detector.sample({ x: 0.2, y: 0.1, z: 1.5 }, 100)).toBeNull()
    const strength = detector.sample({ x: 0.3, y: 0.5, z: 8.2 }, 150)
    expect(strength).not.toBeNull()
    expect(strength!).toBeGreaterThanOrEqual(0.55)
    expect(detector.sample({ x: 0.3, y: 0.5, z: 9.0 }, 250)).toBeNull()
    expect(detector.sample({ x: 0.3, y: 0.5, z: 8.0 }, 450)).not.toBeNull()
  })
})
