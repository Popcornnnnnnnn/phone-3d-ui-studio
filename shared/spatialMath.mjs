import { Quaternion, Vector3 } from 'three'
import { IPHONE_17_MM, IPHONE_17_SCENE, MODEL_HEIGHT } from './phoneGeometry.mjs'

export const SPATIAL_MODEL_SCALE = IPHONE_17_MM.height / 1000 / MODEL_HEIGHT
export const SPATIAL_START = [0, 0.2, 0]
// Approximate main-camera geometry, preserved from S1.
export const CAMERA_IN_BODY = [0.43 * SPATIAL_MODEL_SCALE, 1.08 * SPATIAL_MODEL_SCALE,
  (-IPHONE_17_SCENE.depth / 2 - 0.046) * SPATIAL_MODEL_SCALE]
export const CAMERA_FROM_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
export function cameraToBody(sample) {
  const rotation = new Quaternion(...sample.quaternion).multiply(CAMERA_FROM_BODY).normalize()
  const position = new Vector3(...sample.positionMeters).sub(new Vector3(...CAMERA_IN_BODY).applyQuaternion(rotation))
  return { position: position.toArray(), quaternion: rotation.toArray() }
}
export function makeCalibration(body) {
  const top = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...body.quaternion))
  if (Math.hypot(top.x, top.z) < 0.2) return null
  return { origin: new Vector3(...body.position),
    yaw: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(top.x, -top.z)) }
}
export function applyCalibration(body, calibration) {
  return { position: new Vector3(...body.position).sub(calibration.origin).applyQuaternion(calibration.yaw).add(new Vector3(...SPATIAL_START)).toArray(),
    quaternion: calibration.yaw.clone().multiply(new Quaternion(...body.quaternion)).normalize().toArray() }
}
