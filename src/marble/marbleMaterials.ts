import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three'

export type MarbleVariant = 'active' | 'trail'

interface Rgb {
  r: number
  g: number
  b: number
}

const ACTIVE_PALETTE = {
  deep: { r: 7, g: 56, b: 39 },
  mid: { r: 15, g: 110, b: 74 },
  rich: { r: 28, g: 152, b: 103 },
  swirl: { r: 74, g: 214, b: 158 },
  spine: { r: 126, g: 236, b: 192 },
  shadow: { r: 5, g: 40, b: 28 },
  wisp: { r: 34, g: 176, b: 128 },
} satisfies Record<string, Rgb>

const TRAIL_PALETTE = {
  deep: { r: 20, g: 25, b: 33 },
  mid: { r: 35, g: 43, b: 55 },
  rich: { r: 50, g: 60, b: 74 },
  swirl: { r: 92, g: 106, b: 128 },
  spine: { r: 122, g: 136, b: 158 },
  shadow: { r: 14, g: 18, b: 24 },
  wisp: { r: 64, g: 76, b: 94 },
} satisfies Record<string, Rgb>

/**
 * Scales indirect specular IBL on spherical marbles because Three.js overwrites
 * `material.envMapIntensity` with `scene.environmentIntensity` whenever `material.envMap` is null.
 */
const MARBLE_SPECULAR_IBL_SCALE = 0.1

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t)
  return {
    r: mix(a.r, b.r, k),
    g: mix(a.g, b.g, k),
    b: mix(a.b, b.b, k),
  }
}

function hash3(ix: number, iy: number, iz: number): number {
  const dot = ix * 127.1 + iy * 311.7 + iz * 74.7
  const s = Math.sin(dot) * 43758.5453123
  return s - Math.floor(s)
}

function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)

  const fx = x - ix
  const fy = y - iy
  const fz = z - iz

  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)

  const n000 = hash3(ix, iy, iz)
  const n100 = hash3(ix + 1, iy, iz)
  const n010 = hash3(ix, iy + 1, iz)
  const n110 = hash3(ix + 1, iy + 1, iz)
  const n001 = hash3(ix, iy, iz + 1)
  const n101 = hash3(ix + 1, iy, iz + 1)
  const n011 = hash3(ix, iy + 1, iz + 1)
  const n111 = hash3(ix + 1, iy + 1, iz + 1)

  const nx00 = mix(n000, n100, ux)
  const nx10 = mix(n010, n110, ux)
  const nx01 = mix(n001, n101, ux)
  const nx11 = mix(n011, n111, ux)

  const nxy0 = mix(nx00, nx10, uy)
  const nxy1 = mix(nx01, nx11, uy)

  return mix(nxy0, nxy1, uz)
}

function fbm3(x: number, y: number, z: number): number {
  let sum = 0
  let amp = 0.56
  let freq = 1
  for (let i = 0; i < 3; i++) {
    sum += amp * (valueNoise3(x * freq, y * freq, z * freq) * 2 - 1)
    freq *= 2.04
    amp *= 0.45
  }
  return sum
}

/**
 * Generates a seamless spherical glass-marble texture in 3D Cartesian coordinates
 * with fluid internal jade cat's-eye ribbons so rolling rotation is clearly visible
 * around any axis without polar pinching or protruding marker geometry.
 */
export function createMarbleSurfaceTexture(
  variant: MarbleVariant = 'active',
  width = 512,
  height = 256,
): DataTexture {
  const palette = variant === 'active' ? ACTIVE_PALETTE : TRAIL_PALETTE
  const data = new Uint8Array(width * height * 4)

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height
    const theta = (1 - v) * Math.PI
    const sinTheta = Math.sin(theta)
    const ny = Math.cos(theta)

    for (let px = 0; px < width; px++) {
      const u = px / width
      const phi = u * Math.PI * 2
      const nx = sinTheta * Math.cos(phi)
      const nz = sinTheta * Math.sin(phi)

      const flowA = fbm3(nx * 1.45 + 1.2, ny * 1.45 - 0.6, nz * 1.45 + 1.9)
      const flowB = fbm3(nx * 2.4 - 2.1, ny * 2.4 + 1.3, nz * 2.4 - 0.9)
      const bodyGrad = clamp01(0.48 + nz * 0.22 + flowA * 0.34 + flowB * 0.14)

      const twistedCoord = nx * 0.68 + ny * 0.64 - nz * 0.35 + Math.sin(ny * 2.1 + nx * 1.4) * 0.18 + flowA * 0.18
      const crossWave = Math.sin((nx * -0.42 + ny * 0.55 + nz * 0.72) * 3.1 + flowB * 0.65)

      const primarySwirl = Math.exp(-Math.pow((twistedCoord - 0.16) / 0.24, 2))
      const brightCore = Math.exp(-Math.pow((twistedCoord - 0.14) / 0.085, 2))
      const deepPocket = Math.exp(-Math.pow((twistedCoord + 0.22) / 0.26, 2))
      const subtleWisp = smoothstep(0.15, 0.9, crossWave)

      let color = mixRgb(palette.deep, palette.mid, bodyGrad)
      color = mixRgb(color, palette.rich, smoothstep(0.38, 0.92, bodyGrad + subtleWisp * 0.18) * 0.52)
      color = mixRgb(color, palette.wisp, subtleWisp * 0.36)
      color = mixRgb(color, palette.shadow, deepPocket * 0.42)
      color = mixRgb(color, palette.swirl, primarySwirl * 0.68)
      color = mixRgb(color, palette.spine, brightCore * 0.46)

      const offset = (py * width + px) * 4
      data[offset] = Math.round(clamp01(color.r / 255) * 255)
      data[offset + 1] = Math.round(clamp01(color.g / 255) * 255)
      data[offset + 2] = Math.round(clamp01(color.b / 255) * 255)
      data[offset + 3] = 255
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function applySoftMarbleReflections(material: MeshPhysicalMaterial, specularIblScale = MARBLE_SPECULAR_IBL_SCALE) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        radiance *= ${specularIblScale.toFixed(3)};
        #ifdef USE_CLEARCOAT
          clearcoatRadiance *= ${specularIblScale.toFixed(3)};
        #endif
      #endif`,
    )
  }
  material.customProgramCacheKey = () => `marble-soft-ibl-${specularIblScale.toFixed(3)}-v1`
  return material
}

export interface ClippedMarbleMaterialOptions {
  map?: DataTexture
  roughness?: number
  metalness?: number
  clearcoat?: number
  clearcoatRoughness?: number
  ior?: number
  reflectivity?: number
  specularIntensity?: number
  specularIblScale?: number
}

export function createClippedMarbleMaterial(
  color: string,
  inverse: Matrix4,
  slotGeometry: Vector2,
  screenBounds: Vector3,
  options: ClippedMarbleMaterialOptions = {},
) {
  const specularIblScale = options.specularIblScale ?? MARBLE_SPECULAR_IBL_SCALE
  const material = new MeshPhysicalMaterial({
    color,
    map: options.map ?? null,
    roughness: options.roughness ?? 0.2,
    metalness: options.metalness ?? 0.02,
    clearcoat: options.clearcoat ?? 0.72,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.14,
    ior: options.ior ?? 1.5,
    reflectivity: options.reflectivity ?? 0.55,
    specularIntensity: options.specularIntensity ?? 0.65,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.uniforms.slotGeometry = { value: slotGeometry }
    shader.uniforms.screenBounds = { value: screenBounds }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = 'uniform vec2 slotGeometry; uniform vec3 screenBounds; varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - screenBounds.xy;
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - screenBounds.z;
      if (edgeDistance <= 0.0 && phoneFragment.z >= slotGeometry.y - slotGeometry.x && phoneFragment.z < slotGeometry.y) discard;`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        radiance *= ${specularIblScale.toFixed(3)};
        #ifdef USE_CLEARCOAT
          clearcoatRadiance *= ${specularIblScale.toFixed(3)};
        #endif
      #endif`,
    )
  }
  material.customProgramCacheKey = () => `marble-finite-slot-device-profile-v6-${specularIblScale.toFixed(3)}`
  return material
}

export interface MarbleMaterialSet {
  active: MeshPhysicalMaterial
  trail: MeshPhysicalMaterial
  ensureTexturesUploaded: () => void
  dispose: () => void
}

export function createMarbleMaterialSet(
  inverse: Matrix4,
  slotGeometry: Vector2,
  screenBounds: Vector3,
): MarbleMaterialSet {
  const activeTexture = createMarbleSurfaceTexture('active')
  const trailTexture = createMarbleSurfaceTexture('trail')

  const active = createClippedMarbleMaterial('#ffffff', inverse, slotGeometry, screenBounds, {
    map: activeTexture,
    roughness: 0.2,
    metalness: 0.02,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    ior: 1.5,
    reflectivity: 0.55,
    specularIntensity: 0.65,
  })

  const trail = applySoftMarbleReflections(
    new MeshPhysicalMaterial({
      color: '#ffffff',
      map: trailTexture,
      roughness: 0.34,
      metalness: 0.05,
      clearcoat: 0.35,
      clearcoatRoughness: 0.32,
      ior: 1.46,
      specularIntensity: 0.45,
    }),
    MARBLE_SPECULAR_IBL_SCALE,
  )

  return {
    active,
    trail,
    ensureTexturesUploaded() {
      activeTexture.needsUpdate = true
      trailTexture.needsUpdate = true
    },
    dispose() {
      active.dispose()
      trail.dispose()
      activeTexture.dispose()
      trailTexture.dispose()
    },
  }
}
