import { describe, expect, it } from 'vitest'
import { getContainMapping, getScreenTargetAspect } from './screenMedia'

describe('screen media mapping', () => {
  const portraitWidth = 1206
  const portraitHeight = 2622

  it('swaps the target aspect without deforming the screen geometry', () => {
    const portrait = getScreenTargetAspect(portraitWidth, portraitHeight, 'portrait')
    const landscape = getScreenTargetAspect(portraitWidth, portraitHeight, 'landscape')

    expect(portrait).toBeCloseTo(portraitWidth / portraitHeight)
    expect(landscape).toBeCloseTo(portraitHeight / portraitWidth)
    expect(portrait * landscape).toBeCloseTo(1)
  })

  it('letterboxes wider content instead of stretching it', () => {
    const targetAspect = getScreenTargetAspect(portraitWidth, portraitHeight, 'portrait')
    const mapping = getContainMapping(1920, 1080, targetAspect)

    expect(mapping.contentScale[0]).toBe(1)
    expect(mapping.contentScale[1]).toBeCloseTo(targetAspect / (1920 / 1080))
  })

  it('pillarboxes taller content instead of stretching it', () => {
    const targetAspect = getScreenTargetAspect(portraitWidth, portraitHeight, 'landscape')
    const mapping = getContainMapping(1080, 1920, targetAspect)

    expect(mapping.contentScale[0]).toBeCloseTo((1080 / 1920) / targetAspect)
    expect(mapping.contentScale[1]).toBe(1)
  })

  it('rejects missing media metadata', () => {
    expect(() => getContainMapping(0, 1080, 1)).toThrow(
      'Source dimensions and target aspect must be positive',
    )
  })
})
