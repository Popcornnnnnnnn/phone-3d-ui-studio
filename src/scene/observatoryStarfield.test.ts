import { describe, expect, it } from 'vitest'
import {
  OBSERVATORY_STAR_COUNT,
  OBSERVATORY_STAR_MODE_COUNTS,
  createObservatoryMeteorEvent,
  createObservatoryStarBufferData,
} from './observatoryStarfield'

describe('Graphite Observatory starfield', () => {
  it('creates one tightly budgeted points batch with the requested star mix', () => {
    const field = createObservatoryStarBufferData()
    const starModes = [...field.modes.slice(0, OBSERVATORY_STAR_COUNT)]

    expect(field.positions).toHaveLength((OBSERVATORY_STAR_COUNT + 1) * 3)
    expect(starModes.filter((mode) => mode === 0)).toHaveLength(
      OBSERVATORY_STAR_MODE_COUNTS.stable,
    )
    expect(starModes.filter((mode) => mode === 1)).toHaveLength(
      OBSERVATORY_STAR_MODE_COUNTS.breathing,
    )
    expect(starModes.filter((mode) => mode === 2)).toHaveLength(
      OBSERVATORY_STAR_MODE_COUNTS.flicker,
    )
    expect(field.kinds[OBSERVATORY_STAR_COUNT]).toBe(1)
  })

  it('keeps stars outside the phone focus zone and within size/motion limits', () => {
    const field = createObservatoryStarBufferData()

    for (let index = 0; index < OBSERVATORY_STAR_COUNT; index += 1) {
      const x = field.positions[index * 3]
      const y = field.positions[index * 3 + 1]
      const normalizedDistance = (x / 0.31) ** 2 + (y / 0.5) ** 2
      const driftPx = Math.hypot(
        field.drift[index * 2],
        field.drift[index * 2 + 1],
      )

      expect(normalizedDistance).toBeGreaterThanOrEqual(1)
      expect(field.sizes[index]).toBeGreaterThanOrEqual(0.7)
      expect(field.sizes[index]).toBeLessThanOrEqual(1.8)
      expect(field.periods[index]).toBeGreaterThanOrEqual(2.5)
      expect(field.periods[index]).toBeLessThanOrEqual(6)
      expect(driftPx).toBeGreaterThanOrEqual(2)
      expect(driftPx).toBeLessThanOrEqual(4)
    }
  })

  it('keeps meteor cadence, duration, length, and brightness in budget', () => {
    for (let step = 0; step <= 20; step += 1) {
      const meteor = createObservatoryMeteorEvent(() => step / 20)
      expect(meteor.delaySeconds).toBeGreaterThanOrEqual(6)
      expect(meteor.delaySeconds).toBeLessThanOrEqual(12)
      expect(meteor.durationSeconds).toBeGreaterThanOrEqual(0.45)
      expect(meteor.durationSeconds).toBeLessThanOrEqual(0.75)
      expect(meteor.lengthPx).toBeGreaterThanOrEqual(45)
      expect(meteor.lengthPx).toBeLessThanOrEqual(90)
      expect(meteor.peakOpacity).toBeLessThanOrEqual(0.45)
      expect(Math.abs(meteor.origin[0])).toBeGreaterThanOrEqual(0.68)
    }
  })
})
