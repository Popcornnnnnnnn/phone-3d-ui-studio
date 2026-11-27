import { describe, expect, it } from 'vitest'
import { createAdaptiveAndroidProfile, PHONE_PROFILES } from '../../shared/phoneGeometry.mjs'
import { fittedPhoneDisplayMetrics } from './publicPhoneAssets'

describe('fittedPhoneDisplayMetrics', () => {
  it.each(Object.values(PHONE_PROFILES))(
    'computes concentric slim bezels strictly inside the $name body',
    (profile) => {
      const m = fittedPhoneDisplayMetrics(profile)

      expect(m.bezelWidth).toBeGreaterThan(m.displayWidth)
      expect(m.bezelWidth).toBeLessThan(m.bodyWidth)
      expect(m.bezelHeight).toBeGreaterThan(m.displayHeight)
      expect(m.bezelHeight).toBeLessThan(m.bodyHeight)

      // Concentric corner rounding: bezel corner radius exceeds display corner radius by ~side margin
      expect(m.bezelCornerRadius).toBeGreaterThan(m.displayCornerRadius)

      // Slim flagship side bezel (< 4% of body width per side)
      const sideBezelRatio = (m.bezelWidth - m.displayWidth) / (2 * m.bodyWidth)
      expect(sideBezelRatio).toBeGreaterThan(0.005)
      expect(sideBezelRatio).toBeLessThan(0.03)

      // Dynamic Island / camera sits inside the upper portion of the display
      expect(m.islandOffsetFromTop).toBeGreaterThan(0)
      expect(m.islandOffsetFromTop).toBeLessThan(m.displayHeight * 0.1)
    },
  )

  it('preserves adaptive Android display proportions without iPhone clamping', () => {
    const android = createAdaptiveAndroidProfile({
      screenWidth: 412,
      screenHeight: 915,
      dpr: 3,
      modelLabel: 'Pixel 9 Pro',
    })
    const m = fittedPhoneDisplayMetrics(android)

    expect(m.displayWidth / m.displayHeight).toBeCloseTo(
      android.displayMm.width / android.displayMm.height,
      3,
    )
    expect(m.bezelWidth).toBeGreaterThan(m.displayWidth)
    expect(m.bezelHeight).toBeGreaterThan(m.displayHeight)
  })
})
