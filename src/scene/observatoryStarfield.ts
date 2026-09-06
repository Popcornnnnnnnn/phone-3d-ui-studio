export const OBSERVATORY_STAR_COUNT = 90

export const OBSERVATORY_STAR_MODE_COUNTS = {
  stable: 63,
  breathing: 18,
  flicker: 9,
} as const

export interface ObservatoryStarBufferData {
  positions: Float32Array
  sizes: Float32Array
  opacities: Float32Array
  modes: Float32Array
  periods: Float32Array
  phases: Float32Array
  drift: Float32Array
  tints: Float32Array
  kinds: Float32Array
}

export interface ObservatoryMeteorEvent {
  delaySeconds: number
  durationSeconds: number
  lengthPx: number
  peakOpacity: number
  origin: readonly [number, number]
  travel: readonly [number, number]
}

type RandomSource = () => number

function mulberry32(seed: number): RandomSource {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffledModes(random: RandomSource) {
  const modes = [
    ...Array<number>(OBSERVATORY_STAR_MODE_COUNTS.stable).fill(0),
    ...Array<number>(OBSERVATORY_STAR_MODE_COUNTS.breathing).fill(1),
    ...Array<number>(OBSERVATORY_STAR_MODE_COUNTS.flicker).fill(2),
  ]

  for (let index = modes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[modes[index], modes[swapIndex]] = [modes[swapIndex], modes[index]]
  }
  return modes
}

function outsidePhoneFocusZone(x: number, y: number) {
  const normalizedX = x / 0.31
  const normalizedY = y / 0.5
  return normalizedX * normalizedX + normalizedY * normalizedY >= 1
}

export function createObservatoryStarBufferData(
  seed = 0x0b5e7a70,
): ObservatoryStarBufferData {
  const random = mulberry32(seed)
  const vertexCount = OBSERVATORY_STAR_COUNT + 1
  const positions = new Float32Array(vertexCount * 3)
  const sizes = new Float32Array(vertexCount)
  const opacities = new Float32Array(vertexCount)
  const modes = new Float32Array(vertexCount)
  const periods = new Float32Array(vertexCount)
  const phases = new Float32Array(vertexCount)
  const drift = new Float32Array(vertexCount * 2)
  const tints = new Float32Array(vertexCount)
  const kinds = new Float32Array(vertexCount)
  const starModes = shuffledModes(random)

  for (let index = 0; index < OBSERVATORY_STAR_COUNT; index += 1) {
    let x: number
    let y: number
    do {
      x = -0.94 + random() * 1.88
      y = -0.86 + random() * 1.74
    } while (!outsidePhoneFocusZone(x, y))

    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = 0
    sizes[index] = 0.7 + random() * 1.1
    opacities[index] = 0.34 + random() * 0.5
    modes[index] = starModes[index]
    periods[index] = 2.5 + random() * 3.5
    phases[index] = random() * Math.PI * 2

    const driftAngle = random() * Math.PI * 2
    const driftRadiusPx = 2 + random() * 2
    drift[index * 2] = Math.cos(driftAngle) * driftRadiusPx
    drift[index * 2 + 1] = Math.sin(driftAngle) * driftRadiusPx
    tints[index] = random()
  }

  // The final vertex is a shader-shaped meteor sprite. It shares this single
  // Points draw call with the stars and receives its position from uniforms.
  const meteorIndex = OBSERVATORY_STAR_COUNT
  sizes[meteorIndex] = 1
  opacities[meteorIndex] = 1
  periods[meteorIndex] = 1
  kinds[meteorIndex] = 1

  return {
    positions,
    sizes,
    opacities,
    modes,
    periods,
    phases,
    drift,
    tints,
    kinds,
  }
}

export function createObservatoryMeteorEvent(
  random: RandomSource = Math.random,
): ObservatoryMeteorEvent {
  const side = random() < 0.5 ? -1 : 1
  return {
    delaySeconds: 6 + random() * 6,
    durationSeconds: 0.45 + random() * 0.3,
    lengthPx: 45 + random() * 45,
    peakOpacity: 0.36 + random() * 0.09,
    origin: [side * (0.68 + random() * 0.18), 0.69 + random() * 0.15],
    travel: [-side * (0.08 + random() * 0.08), -(0.07 + random() * 0.08)],
  }
}
