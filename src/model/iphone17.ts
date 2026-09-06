export const IPHONE_17_MM = {
  width: 71.45,
  height: 149.61,
  depth: 7.95,
  glassWidth: 69.45,
  glassHeight: 147.61,
  displayWidth: 66.57,
  displayHeight: 144.79,
  rearLensDiameter: 16,
} as const

export const IPHONE_17_DISPLAY = {
  pixels: { width: 1206, height: 2622 },
  points: { width: 402, height: 874 },
  scale: 3,
} as const

export const MODEL_HEIGHT = 3

export function millimetersToScene(value: number) {
  return (value / IPHONE_17_MM.height) * MODEL_HEIGHT
}

export const IPHONE_17_SCENE = {
  width: millimetersToScene(IPHONE_17_MM.width),
  height: MODEL_HEIGHT,
  depth: millimetersToScene(IPHONE_17_MM.depth),
  glassWidth: millimetersToScene(IPHONE_17_MM.glassWidth),
  glassHeight: millimetersToScene(IPHONE_17_MM.glassHeight),
  displayWidth: millimetersToScene(IPHONE_17_MM.displayWidth),
  displayHeight: millimetersToScene(IPHONE_17_MM.displayHeight),
  rearLensDiameter: millimetersToScene(IPHONE_17_MM.rearLensDiameter),
} as const

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
