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
})
