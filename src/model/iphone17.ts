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

export type ReviewView = 'studio' | 'front' | 'back'

