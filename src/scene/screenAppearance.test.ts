import { describe, expect, it } from 'vitest'
import {
  MIN_SCREEN_VIEW_BRIGHTNESS,
  screenViewBrightness,
} from './screenAppearance'

describe('screen view-angle response', () => {
  it('keeps the display stable while applying a gentle grazing-angle falloff', () => {
    expect(screenViewBrightness(1)).toBe(1)
    expect(screenViewBrightness(0.75)).toBeCloseTo(0.9344, 4)
    expect(screenViewBrightness(0.5)).toBeCloseTo(0.79)
    expect(screenViewBrightness(0)).toBe(MIN_SCREEN_VIEW_BRIGHTNESS)
  })

  it('clamps invalid facing ratios to the supported range', () => {
    expect(screenViewBrightness(2)).toBe(1)
    expect(screenViewBrightness(-1)).toBe(MIN_SCREEN_VIEW_BRIGHTNESS)
  })
})
