import { Quaternion, Vector3 } from 'three'
import { IPHONE_17_MM } from './phoneGeometry.mjs'
import { SPATIAL_MODEL_SCALE } from './spatialMath.mjs'

export const MARBLE_GEOMETRY = Object.freeze({
  width: IPHONE_17_MM.displayWidth / 1000, height: IPHONE_17_MM.displayHeight / 1000,
  screenZ: IPHONE_17_MM.depth / 2000 + 0.0008 * SPATIAL_MODEL_SCALE,
  cornerRadius: 0.135 * SPATIAL_MODEL_SCALE,
  radius: 0.006, exitHalfWidth: 0.020, wallHeight: 0.012,
  interpolationMs: 50, gravity: 1.5,
})
export function insideScreen(x, y, g = MARBLE_GEOMETRY) {
  const dx = Math.abs(x) - (g.width / 2 - g.cornerRadius)
  const dy = Math.abs(y) - (g.height / 2 - g.cornerRadius)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) <= g.cornerRadius
}
export function localToWorld(point, phone) {
  return new Vector3(...point).applyQuaternion(new Quaternion(...phone.quaternion)).add(new Vector3(...phone.position)).toArray()
}
export function worldToLocal(point, phone) {
  return new Vector3(...point).sub(new Vector3(...phone.position)).applyQuaternion(new Quaternion(...phone.quaternion).invert()).toArray()
}
export function projectMarble(ball, phone, g = MARBLE_GEOMETRY) {
  const local = worldToLocal(ball.position, phone)
  const depth = local[2] - g.screenZ
  const radius = ball.radius ?? g.radius
  // The phone displays the part of the sphere intersecting / behind its screen.
  const visibleRadius = depth >= radius ? 0 : depth <= 0 ? radius : Math.sqrt(radius * radius - depth * depth)
  const q = new Quaternion(...phone.quaternion).invert().multiply(new Quaternion(...ball.quaternion))
  return { local, depth, radius: visibleRadius,
    marker: new Vector3(0, 0, 1).applyQuaternion(q).toArray(),
    u: 0.5 + local[0] / g.width, v: 0.5 - local[1] / g.height }
}
export function interpolateTransform(a, b, t) {
  return { position: new Vector3(...a.position).lerp(new Vector3(...b.position), t).toArray(),
    quaternion: new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion), t).toArray() }
}
export function interpolateSnapshot(a, b, time) {
  if (!a || a.epoch !== b.epoch || !a.phone || !b.phone || !a.ball || !b.ball || b.phase !== 'running') return b
  const t = Math.max(0, Math.min(1, (time - a.serverTimeMs) / Math.max(1, b.serverTimeMs - a.serverTimeMs)))
  return { ...b, phone: interpolateTransform(a.phone, b.phone, t),
    ball: { ...b.ball, ...interpolateTransform(a.ball, b.ball, t) } }
}
