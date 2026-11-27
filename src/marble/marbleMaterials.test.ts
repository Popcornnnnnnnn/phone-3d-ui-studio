import { describe, expect, it } from 'vitest'
import { ClampToEdgeWrapping, Matrix4, RepeatWrapping, SRGBColorSpace, Vector2, Vector3 } from 'three'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import {
  createMarbleMaterialSet,
  createMarblePreviewMaterial,
  createMarbleSurfaceTexture,
} from './marbleMaterials'

describe('marbleMaterials', () => {
  it('generates seamless 3D-mapped swirl textures for active and trail variants', () => {
    for (const variant of ['active', 'trail'] as const) {
      const texture = createMarbleSurfaceTexture(variant, 256, 128)
      const data = texture.image.data as Uint8Array

      expect(texture.image.width).toBe(256)
      expect(texture.image.height).toBe(128)
      expect(data.length).toBe(256 * 128 * 4)
      expect(texture.colorSpace).toBe(SRGBColorSpace)
      expect(texture.wrapS).toBe(RepeatWrapping)
      expect(texture.wrapT).toBe(ClampToEdgeWrapping)

      let minGreen = 255
      let maxGreen = 0
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i + 3]).toBe(255)
        if (data[i + 1] < minGreen) minGreen = data[i + 1]
        if (data[i + 1] > maxGreen) maxGreen = data[i + 1]
      }
      expect(maxGreen - minGreen).toBeGreaterThan(40)

      // Horizontal seam continuity between px = 0 and px = width - 1
      const midRow = 64 * 256
      for (let c = 0; c < 3; c++) {
        const left = data[midRow * 4 + c]
        const right = data[(midRow + 255) * 4 + c]
        expect(Math.abs(left - right)).toBeLessThanOrEqual(8)
      }

      texture.dispose()
    }
  })

  it('creates disposable material sets and increments texture versions for StrictMode remounts', () => {
    const inverse = new Matrix4()
    const slotGeometry = new Vector2(G.radius, G.screenZ)
    const screenBounds = new Vector3(G.width / 2 - G.cornerRadius, G.height / 2 - G.cornerRadius, G.cornerRadius)

    const set = createMarbleMaterialSet(inverse, slotGeometry, screenBounds)
    expect(set.active.map).toBeTruthy()
    expect(set.trail.map).toBeTruthy()
    const prevActiveVersion = set.active.map!.version
    const prevTrailVersion = set.trail.map!.version
    set.ensureTexturesUploaded()
    expect(set.active.map!.version).toBeGreaterThan(prevActiveVersion)
    expect(set.trail.map!.version).toBeGreaterThan(prevTrailVersion)
    set.dispose()

    const preview = createMarblePreviewMaterial()
    expect(preview.material.map).toBeTruthy()
    const prevPreviewVersion = preview.material.map!.version
    preview.ensureTexturesUploaded()
    expect(preview.material.map!.version).toBeGreaterThan(prevPreviewVersion)
    preview.dispose()
  })
})
