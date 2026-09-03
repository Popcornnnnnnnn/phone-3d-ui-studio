import {
  multiplyQuaternions,
  normalizeQuaternion,
  type QuaternionTuple,
  type Vector3Tuple,
} from './liveProtocol'

export const ULTRA_REQUESTED_POSE_HZ = 200
export const MAX_POSE_PREDICTION_MS = 30
export const NEXT_RENDER_ESTIMATE_MS = 8

export function posePredictionHorizonMs(
  sampledAtMacMs: number | null,
  receivedAtMacMs: number,
) {
  if (sampledAtMacMs === null) return NEXT_RENDER_ESTIMATE_MS
  return Math.min(
    MAX_POSE_PREDICTION_MS,
    Math.max(0, receivedAtMacMs - sampledAtMacMs) + NEXT_RENDER_ESTIMATE_MS,
  )
}

export function predictQuaternion(
  quaternion: QuaternionTuple,
  rotationRate: Vector3Tuple,
  horizonMs: number,
): QuaternionTuple {
  const angularSpeed = Math.hypot(...rotationRate)
  if (angularSpeed < 1e-7 || horizonMs <= 0) {
    return normalizeQuaternion(quaternion)
  }

  const angle = angularSpeed * (horizonMs / 1_000)
  const halfAngle = angle / 2
  const scale = Math.sin(halfAngle) / angularSpeed
  const delta: QuaternionTuple = [
    rotationRate[0] * scale,
    rotationRate[1] * scale,
    rotationRate[2] * scale,
    Math.cos(halfAngle),
  ]

  // CMRotationRate is expressed in the device frame, so append the small
  // predicted rotation on the current attitude's local side.
  return normalizeQuaternion(multiplyQuaternions(quaternion, delta))
}
