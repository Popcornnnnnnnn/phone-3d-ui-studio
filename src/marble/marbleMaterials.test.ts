import { describe, expect, it } from 'vitest'
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  RepeatWrapping,
  ShaderLib,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import {
  createClippedMarbleMaterial,
  createMarbleMaterialSet,
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
      expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
      expect(texture.magFilter).toBe(LinearFilter)
      expect(texture.generateMipmaps).toBe(true)
      expect(texture.anisotropy).toBe(8)

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

      // Polar rows stay uniform across longitude so poles exhibit zero pinching
      for (const polarRow of [0, 127]) {
        const rowOffset = polarRow * 256 * 4
        for (let px = 1; px < 256; px++) {
          for (let c = 0; c < 3; c++) {
            expect(Math.abs(data[rowOffset + px * 4 + c] - data[rowOffset + c])).toBeLessThanOrEqual(4)
          }
        }
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
  })

  it('injects finite-slot clipping and IBL scaling into Three.js physical shaders with unique cache keys', () => {
    const inverse = new Matrix4()
    const slotGeometry = new Vector2(G.radius, G.screenZ)
    const screenBounds = new Vector3(G.width / 2 - G.cornerRadius, G.height / 2 - G.cornerRadius, G.cornerRadius)

    const matDefault = createClippedMarbleMaterial('#ffffff', inverse, slotGeometry, screenBounds)
    const matCustom = createClippedMarbleMaterial('#ffffff', inverse, slotGeometry, screenBounds, {
      specularIblScale: 0.25,
    })

    expect(matDefault.customProgramCacheKey()).not.toBe(matCustom.customProgramCacheKey())

    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms

    matDefault.onBeforeCompile(shader, {} as WebGLRenderer)

    expect(shader.uniforms).toHaveProperty('inversePhone')
    expect(shader.uniforms).toHaveProperty('slotGeometry')
    expect(shader.uniforms).toHaveProperty('screenBounds')
    expect(shader.vertexShader).toContain('phoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(shader.fragmentShader).toContain('if (edgeDistance <= 0.0 && phoneFragment.z >= slotGeometry.y - slotGeometry.x && phoneFragment.z < slotGeometry.y) discard;')
    expect(shader.fragmentShader).toContain('radiance *= 0.100;')
    expect(shader.fragmentShader).toContain('clearcoatRadiance *= 0.100;')

    const set = createMarbleMaterialSet(inverse, slotGeometry, screenBounds)
    const trailShader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms
    set.trail.onBeforeCompile(trailShader, {} as WebGLRenderer)
    expect(trailShader.fragmentShader).toContain('radiance *= 0.100;')

    matDefault.dispose()
    matCustom.dispose()
    set.dispose()
  })
})
