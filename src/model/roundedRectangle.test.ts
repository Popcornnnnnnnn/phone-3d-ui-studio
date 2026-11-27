import { describe, expect, it } from 'vitest'
import { createRoundedRectangleGeometry } from './roundedRectangle'

describe('rounded rectangle geometry', () => {
  it('preserves the requested outer dimensions', () => {
    const geometry = createRoundedRectangleGeometry(2, 4, 0.25)
    geometry.computeBoundingBox()

    expect(geometry.boundingBox?.min.x).toBeCloseTo(-1)
    expect(geometry.boundingBox?.max.x).toBeCloseTo(1)
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-2)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2)
    geometry.dispose()
  })

  it('normalizes plane UVs across the complete surface', () => {
    const geometry = createRoundedRectangleGeometry(2, 4, 0.25)
    const uvs = geometry.getAttribute('uv')
    const values = Array.from({ length: uvs.count }, (_, index) => [
      uvs.getX(index),
      uvs.getY(index),
    ]).flat()

    expect(Math.min(...values)).toBeCloseTo(0)
    expect(Math.max(...values)).toBeCloseTo(1)
    geometry.dispose()
  })

  it('uses true circular quarter-arcs at the corners without outward bulge', () => {
    const width = 2
    const height = 4
    const radius = 0.5
    const geometry = createRoundedRectangleGeometry(width, height, radius, 24)
    const positions = geometry.getAttribute('position')
    const cx = width / 2 - radius
    const cy = height / 2 - radius

    const cornerRadii: number[] = []
    for (let i = 0; i < positions.count; i += 1) {
      const x = Math.abs(positions.getX(i))
      const y = Math.abs(positions.getY(i))
      if (x > cx && y > cy) {
        cornerRadii.push(Math.hypot(x - cx, y - cy))
      }
    }

    expect(cornerRadii.length).toBeGreaterThan(0)
    for (const distance of cornerRadii) {
      expect(distance).toBeCloseTo(radius, 4)
    }
    geometry.dispose()
  })

  it('supports zero, sub-epsilon, and non-finite radius sharp corners cleanly', () => {
    for (const radius of [0, 1e-5, Number.NaN]) {
      const geometry = createRoundedRectangleGeometry(2, 4, radius)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox?.min.x).toBeCloseTo(-1)
      expect(geometry.boundingBox?.max.x).toBeCloseTo(1)
      expect(geometry.boundingBox?.min.y).toBeCloseTo(-2)
      expect(geometry.boundingBox?.max.y).toBeCloseTo(2)
      geometry.dispose()
    }
  })
})
