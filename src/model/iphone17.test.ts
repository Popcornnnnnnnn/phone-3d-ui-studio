import { describe, expect, it } from 'vitest'
import {
  IPHONE_17_DISPLAY,
  IPHONE_17_MM,
  IPHONE_17_SCENE,
  MODEL_HEIGHT,
  STUDIO_FLOOR_Y,
  TABLETOP_PHONE_CENTER_Y,
  millimetersToScene,
} from './iphone17'

describe('iPhone 17 geometry contract', () => {
  it('uses official overall dimensions without changing proportions', () => {
    expect(IPHONE_17_SCENE.height).toBe(MODEL_HEIGHT)
    expect(IPHONE_17_SCENE.width / IPHONE_17_SCENE.height).toBeCloseTo(
      IPHONE_17_MM.width / IPHONE_17_MM.height,
      8,
    )
    expect(IPHONE_17_SCENE.depth / IPHONE_17_SCENE.height).toBeCloseTo(
      IPHONE_17_MM.depth / IPHONE_17_MM.height,
      8,
    )
  })

  it('keeps the active display inside the cover glass', () => {
    expect(IPHONE_17_SCENE.displayWidth).toBeLessThan(IPHONE_17_SCENE.glassWidth)
    expect(IPHONE_17_SCENE.displayHeight).toBeLessThan(IPHONE_17_SCENE.glassHeight)
  })

  it('matches the @3x UI canvas', () => {
    expect(IPHONE_17_DISPLAY.points.width * IPHONE_17_DISPLAY.scale).toBe(
      IPHONE_17_DISPLAY.pixels.width,
    )
    expect(IPHONE_17_DISPLAY.points.height * IPHONE_17_DISPLAY.scale).toBe(
      IPHONE_17_DISPLAY.pixels.height,
    )
    expect(millimetersToScene(IPHONE_17_MM.rearLensDiameter)).toBeCloseTo(
      IPHONE_17_SCENE.rearLensDiameter,
      8,
    )
  })

  it('rests the horizontal phone just above the studio floor', () => {
    expect(
      TABLETOP_PHONE_CENTER_Y - IPHONE_17_SCENE.depth / 2,
    ).toBeCloseTo(STUDIO_FLOOR_Y + 0.01)
  })
})
