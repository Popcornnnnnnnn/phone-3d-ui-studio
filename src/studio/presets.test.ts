import { describe, expect, it } from 'vitest'
import { findStudioPreset, studioPresets } from './presets'

describe('studio presets', () => {
  it('use stable unique identifiers', () => {
    const ids = studioPresets.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fall back to the first preset for an unknown id', () => {
    expect(findStudioPreset('missing').id).toBe(studioPresets[0].id)
  })

  it('uses the daylight environment as the default preset', () => {
    expect(studioPresets).toHaveLength(2)
    expect(studioPresets[0]).toMatchObject({
      id: 'pearl',
      name: 'Daylight',
      daylight: true,
    })
    expect(studioPresets[1]).toMatchObject({
      id: 'warm',
      name: 'Night',
      daylight: false,
    })
  })

  it('keep light intensities within the initial renderer budget', () => {
    for (const preset of studioPresets) {
      expect(preset.keyLight).toBeGreaterThan(0)
      expect(preset.keyLight).toBeLessThanOrEqual(5)
      expect(preset.fillLight).toBeGreaterThan(0)
      expect(preset.fillLight).toBeLessThanOrEqual(3)
    }
  })
})
