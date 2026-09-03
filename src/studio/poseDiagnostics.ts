import {
  multiplyQuaternions,
  normalizeQuaternion,
  type QuaternionTuple,
} from './liveProtocol'

// The calibrated phone lies screen-up. Local +Z becomes world +Y and the
// Dynamic Island/top edge points toward world -Z.
export const STANDARD_TABLETOP_QUATERNION: QuaternionTuple = [
  -Math.SQRT1_2,
  0,
  0,
  Math.SQRT1_2,
]

export interface QuaternionRotation {
  angleDegrees: number
  axis: readonly [x: number, y: number, z: number]
}

export interface PoseAccuracySnapshot {
  sensorAngleDegrees: number
  targetAngleDegrees: number
  renderedAngleDegrees: number
  trackingErrorDegrees: number
  tableAxisAlignmentPercent: number
  targetWorldAxis: readonly [x: number, y: number, z: number]
  verdict:
    | 'Ready'
    | 'Rotate to 90°'
    | 'Hold steady'
    | 'Transform mismatch'
    | 'Axis mismatch'
    | 'Pass'
}

function inverseQuaternion(value: QuaternionTuple): QuaternionTuple {
  const quaternion = normalizeQuaternion(value)
  return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]]
}

function canonicalQuaternion(value: QuaternionTuple): QuaternionTuple {
  const quaternion = normalizeQuaternion(value)
  return quaternion[3] < 0
    ? [-quaternion[0], -quaternion[1], -quaternion[2], -quaternion[3]]
    : quaternion
}

export function quaternionAxisAngle(
  value: QuaternionTuple,
): QuaternionRotation {
  const [x, y, z, w] = canonicalQuaternion(value)
  const clampedW = Math.min(1, Math.max(-1, w))
  const angleRadians = 2 * Math.acos(clampedW)
  const axisLength = Math.hypot(x, y, z)

  return {
    angleDegrees: (angleRadians * 180) / Math.PI,
    axis:
      axisLength < 1e-7
        ? [0, 0, 0]
        : [x / axisLength, y / axisLength, z / axisLength],
  }
}

// World-space rotation that moves `from` to `to`.
export function quaternionDelta(
  from: QuaternionTuple,
  to: QuaternionTuple,
): QuaternionTuple {
  return normalizeQuaternion(
    multiplyQuaternions(normalizeQuaternion(to), inverseQuaternion(from)),
  )
}

export function quaternionAngularDistance(
  left: QuaternionTuple,
  right: QuaternionTuple,
) {
  return quaternionAxisAngle(quaternionDelta(left, right)).angleDegrees
}

export function buildPoseAccuracySnapshot(
  latestSensorRelative: QuaternionTuple,
  targetQuaternion: QuaternionTuple,
  renderedQuaternion: QuaternionTuple,
): PoseAccuracySnapshot {
  const sensor = quaternionAxisAngle(latestSensorRelative)
  const target = quaternionAxisAngle(
    quaternionDelta(STANDARD_TABLETOP_QUATERNION, targetQuaternion),
  )
  const rendered = quaternionAxisAngle(
    quaternionDelta(STANDARD_TABLETOP_QUATERNION, renderedQuaternion),
  )
  const trackingErrorDegrees = quaternionAngularDistance(
    renderedQuaternion,
    targetQuaternion,
  )
  const tableAxisAlignmentPercent = Math.abs(target.axis[1]) * 100
  const sensorTargetError = Math.abs(
    sensor.angleDegrees - target.angleDegrees,
  )

  let verdict: PoseAccuracySnapshot['verdict'] = 'Pass'
  if (sensor.angleDegrees < 10) verdict = 'Ready'
  else if (sensor.angleDegrees < 80 || sensor.angleDegrees > 100) {
    verdict = 'Rotate to 90°'
  } else if (trackingErrorDegrees > 5) verdict = 'Hold steady'
  else if (sensorTargetError > 3) verdict = 'Transform mismatch'
  else if (tableAxisAlignmentPercent < 90) verdict = 'Axis mismatch'

  return {
    sensorAngleDegrees: sensor.angleDegrees,
    targetAngleDegrees: target.angleDegrees,
    renderedAngleDegrees: rendered.angleDegrees,
    trackingErrorDegrees,
    tableAxisAlignmentPercent,
    targetWorldAxis: target.axis,
    verdict,
  }
}
