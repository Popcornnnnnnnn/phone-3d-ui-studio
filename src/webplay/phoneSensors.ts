import { Euler, Quaternion, Vector3 } from 'three'
import { applyCalibration, makeCalibration, SPATIAL_START } from '../../shared/spatialMath.mjs'
import type { Quat } from '../../shared/spatialProtocol.mjs'

const DEG_TO_RAD = Math.PI / 180
const WORLD_FROM_ENU = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)

export interface HandheldCalibration {
  yaw: Quaternion
  pitchOffset: Quaternion
}

/**
 * Converts W3C DeviceOrientationEvent Euler angles (intrinsic Z-X'-Y'' in ENU)
 * into our Three.js workspace body quaternion (+X right, +Y up, -Z forward).
 */
export function orientationToBodyQuaternion(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg = 0,
): Quat {
  const euler = new Euler(
    betaDeg * DEG_TO_RAD,
    gammaDeg * DEG_TO_RAD,
    alphaDeg * DEG_TO_RAD,
    'ZXY',
  )
  const qEnu = new Quaternion().setFromEuler(euler)
  const qWorld = WORLD_FROM_ENU.clone().multiply(qEnu)
  if (screenAngleDeg !== 0) {
    qWorld.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -screenAngleDeg * DEG_TO_RAD))
  }
  return qWorld.normalize().toArray() as Quat
}

/**
 * Captures yaw-only origin calibration for Desktop Paired mode, preserving real
 * pitch and roll relative to world gravity.
 */
export function calibrateTabletopYaw(bodyQuaternion: Quat) {
  return makeCalibration({ position: SPATIAL_START, quaternion: bodyQuaternion })
}

export function applyTabletopYaw(
  bodyQuaternion: Quat,
  calibration: ReturnType<typeof makeCalibration>,
): Quat {
  if (!calibration) return bodyQuaternion
  return applyCalibration({ position: SPATIAL_START, quaternion: bodyQuaternion }, calibration).quaternion
}

/**
 * Captures comfortable handheld neutral orientation for Phone Solo mode:
 * removes heading yaw and compensates up to ±50° of comfortable reading tilt
 * so holding the phone naturally feels level.
 */
export function calibrateHandheldNeutral(bodyQuaternion: Quat): HandheldCalibration {
  const top = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...bodyQuaternion))
  const yawAngle = Math.hypot(top.x, top.z) >= 0.15 ? Math.atan2(top.x, -top.z) : 0
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawAngle)
  const yawed = yaw.clone().multiply(new Quaternion(...bodyQuaternion)).normalize()
  const localUp = new Vector3(0, 0, 1).applyQuaternion(yawed)
  // Measure forward/back pitch of screen normal relative to world +Y.
  const rawPitch = Math.atan2(localUp.z, localUp.y)
  const clampedPitch = Math.max(-50 * DEG_TO_RAD, Math.min(50 * DEG_TO_RAD, rawPitch))
  const pitchOffset = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -clampedPitch)
  return { yaw, pitchOffset }
}

export function applyHandheldNeutral(
  bodyQuaternion: Quat,
  calibration: HandheldCalibration | null,
): Quat {
  if (!calibration) return bodyQuaternion
  return calibration.pitchOffset
    .clone()
    .multiply(calibration.yaw)
    .multiply(new Quaternion(...bodyQuaternion))
    .normalize()
    .toArray() as Quat
}

export class FlickDetector {
  private lastTriggeredAtMs = -Infinity
  private readonly thresholdMs2: number
  private readonly cooldownMs: number

  constructor(thresholdMs2 = 5.5, cooldownMs = 280) {
    this.thresholdMs2 = thresholdMs2
    this.cooldownMs = cooldownMs
  }

  sample(
    accel: { x?: number | null; y?: number | null; z?: number | null } | null | undefined,
    nowMs = performance.now(),
  ): number | null {
    if (!accel) return null
    const ax = accel.x ?? 0
    const ay = accel.y ?? 0
    const az = accel.z ?? 0
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) return null
    if (nowMs - this.lastTriggeredAtMs < this.cooldownMs) return null

    // Upward wrist flick produces positive Z acceleration (out of screen) or combined upward surge.
    const upward = az
    const total = Math.hypot(ax, ay, az)
    if (upward < this.thresholdMs2 && !(total > this.thresholdMs2 * 1.45 && upward > 2.2)) {
      return null
    }
    this.lastTriggeredAtMs = nowMs
    const normalized = Math.max(0.55, Math.min(1.4, (Math.max(upward, total * 0.7) - this.thresholdMs2) / 9 + 0.75))
    return Number(normalized.toFixed(3))
  }

  reset() {
    this.lastTriggeredAtMs = -Infinity
  }
}

export type MotionPermissionResult = 'granted' | 'denied' | 'unsupported'

interface MotionEventConstructorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * Requests iOS 13+ DeviceOrientation and DeviceMotion permissions synchronously
 * inside a user tap handler so Safari preserves user activation.
 */
export async function requestMotionPermissions(): Promise<MotionPermissionResult> {
  if (typeof window === 'undefined') return 'unsupported'
  const orientCtor = window.DeviceOrientationEvent as unknown as MotionEventConstructorWithPermission | undefined
  const motionCtor = window.DeviceMotionEvent as unknown as MotionEventConstructorWithPermission | undefined
  if (!orientCtor && !motionCtor) return 'unsupported'

  const requests: Array<Promise<'granted' | 'denied'>> = []
  if (typeof orientCtor?.requestPermission === 'function') {
    requests.push(orientCtor.requestPermission())
  }
  if (typeof motionCtor?.requestPermission === 'function') {
    requests.push(motionCtor.requestPermission())
  }

  if (requests.length === 0) {
    return 'granted'
  }

  try {
    const results = await Promise.all(requests)
    return results.every((r) => r === 'granted') ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
