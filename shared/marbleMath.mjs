import { Quaternion, Vector3 } from 'three'
import { IPHONE_17_MM } from './phoneGeometry.mjs'
import { SPATIAL_MODEL_SCALE, SPATIAL_START } from './spatialMath.mjs'
import { DEFAULT_MARBLE_SETTINGS } from './marbleSettings.mjs'

export const MARBLE_GEOMETRY = Object.freeze({
  width: IPHONE_17_MM.displayWidth / 1000, height: IPHONE_17_MM.displayHeight / 1000,
  screenZ: IPHONE_17_MM.depth / 2000 + 0.0008 * SPATIAL_MODEL_SCALE,
  cornerRadius: 0.135 * SPATIAL_MODEL_SCALE,
  radius: DEFAULT_MARBLE_SETTINGS.ballDiameterMm / 2000, exitHalfWidth: 0.020, wallHeight: 0.012,
  interpolationMs: 50, gravity: 1.5,
})
export function marbleGeometry(settings) {
  return { ...MARBLE_GEOMETRY, radius: settings.ballDiameterMm / 2000 }
}
export function scaleMarbleTranslation(phone, scale) {
  return { position: phone.position.map((value, axis) => SPATIAL_START[axis] + (value - SPATIAL_START[axis]) * scale),
    quaternion: [...phone.quaternion] }
}
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
  // Project only the sphere's intersection with the finite shallow slot [-g.radius, 0].
  // A distant sphere behind the phone must stay in the world, never on its screen.
  const separation = Math.max(depth, -g.radius - depth, 0)
  const visibleRadius = separation >= radius ? 0 : Math.sqrt(radius * radius - separation * separation)
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
  if (!a || a.epoch !== b.epoch || !a.phone || !b.phone || b.phase !== 'running') return b
  const t = Math.max(0, Math.min(1, (time - a.serverTimeMs) / Math.max(1, b.serverTimeMs - a.serverTimeMs)))
  // Birth, retirement and impact metadata become visible at their own sample time.
  const discrete = t < 1 ? a : b
  return { ...discrete, phone: interpolateTransform(a.phone, b.phone, t),
    balls: discrete.balls.map((ball) => {
      const from = a.balls.find((v) => v.id === ball.id), to = b.balls.find((v) => v.id === ball.id)
      return from && to ? { ...ball, ...interpolateTransform(from, to, t) } : ball
    }) }
}
