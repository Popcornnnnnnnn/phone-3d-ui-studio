import { IPHONE_17_SCENE } from '../../shared/phoneGeometry.mjs'
export { IPHONE_17_MM, IPHONE_17_DISPLAY, IPHONE_17_SCENE, MODEL_HEIGHT, millimetersToScene } from '../../shared/phoneGeometry.mjs'

export const STUDIO_FLOOR_Y = -1.6
export const TABLETOP_PHONE_CENTER_Y =
  STUDIO_FLOOR_Y + IPHONE_17_SCENE.depth / 2 + 0.01
export const TABLETOP_PHONE_MOTION_CENTER_Y =
  STUDIO_FLOOR_Y + IPHONE_17_SCENE.height / 2 + 0.01

interface QuaternionComponents {
  x: number
  y: number
  z: number
  w: number
}

// Keep the oriented phone above the studio floor. A fixed center height makes
// a lifted phone rotate through the table; the support radius makes its lowest
// rail/glass edge act like the physical contact point instead.
export function groundedTabletopPhoneCenterY(value: QuaternionComponents) {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1
  const x = value.x / length
  const y = value.y / length
  const z = value.z / length
  const w = value.w / length
  const worldUpAlongLocalX = 2 * (x * y + z * w)
  const worldUpAlongLocalY = 1 - 2 * (x * x + z * z)
  const worldUpAlongLocalZ = 2 * (y * z - x * w)
  const supportRadius =
    Math.abs(worldUpAlongLocalX) * (IPHONE_17_SCENE.width / 2) +
    Math.abs(worldUpAlongLocalY) * (IPHONE_17_SCENE.height / 2) +
    Math.abs(worldUpAlongLocalZ) * (IPHONE_17_SCENE.depth / 2)

  return STUDIO_FLOOR_Y + 0.01 + supportRadius
}

export type ReviewView = 'calibration' | 'hero' | 'side' | 'front' | 'back'
export type ScreenOrientation = 'portrait' | 'landscape'
