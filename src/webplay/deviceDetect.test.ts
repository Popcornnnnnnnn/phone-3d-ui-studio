import { describe, expect, it } from 'vitest'
import { detectedInfoFromMessage, inferPhoneFromDeviceInfo } from './deviceDetect'

describe('deviceDetect', () => {
  it('matches iPhone 17 / 17 Pro 6.3-inch CSS viewport cohorts', () => {
    const match = inferPhoneFromDeviceInfo({
      platform: 'ios',
      screenWidth: 402,
      screenHeight: 874,
      dpr: 3,
    })
    expect(match.profileId).toBe('iphone-17-pro')
    expect(match.confidence).toBe('exact-screen')
    expect(match.profile.bodyMm.height).toBeCloseTo(150.0, 1)
  })

  it('matches iPhone 17 Pro Max 6.9-inch CSS viewport cohorts', () => {
    const match = inferPhoneFromDeviceInfo({
      platform: 'ios',
      screenWidth: 440,
      screenHeight: 956,
      dpr: 3,
    })
    expect(match.profileId).toBe('iphone-17-pro-max')
    expect(match.confidence).toBe('exact-screen')
    expect(match.profile.bodyMm.height).toBeCloseTo(163.4, 1)
  })

  it('matches 6.1-inch iPhone 16 and 6.7-inch iPhone 16 Plus cohorts even in landscape order', () => {
    const small = inferPhoneFromDeviceInfo({ platform: 'ios', screenWidth: 852, screenHeight: 393, dpr: 3 })
    expect(small.profileId).toBe('iphone-16')
    const large = inferPhoneFromDeviceInfo({ platform: 'ios', screenWidth: 430, screenHeight: 932, dpr: 3 })
    expect(large.profileId).toBe('iphone-16-plus')
  })

  it('creates an adaptive Android profile preserving real screen aspect ratio and model hint', () => {
    const match = inferPhoneFromDeviceInfo(
      detectedInfoFromMessage({
        type: 'web-device',
        platform: 'android',
        screenWidth: 412,
        screenHeight: 915,
        dpr: 2.625,
        modelHint: 'Pixel 9 Pro',
      }),
    )
    expect(match.profileId).toBe('android-adaptive')
    expect(match.confidence).toBe('adaptive')
    expect(match.label).toContain('Pixel 9 Pro')
    expect(match.profile.name).toBe('Pixel 9 Pro')
    const aspect = match.profile.bodyMm.height / match.profile.bodyMm.width
    expect(aspect).toBeGreaterThan(2.05)
    expect(aspect).toBeLessThan(2.3)
  })

  it('falls back gracefully for non-phone platforms', () => {
    const match = inferPhoneFromDeviceInfo({
      platform: 'other',
      screenWidth: 1440,
      screenHeight: 900,
      dpr: 2,
    })
    expect(match.profileId).toBe('iphone-17')
    expect(match.confidence).toBe('fallback')
  })
})
