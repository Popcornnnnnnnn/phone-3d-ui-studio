import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { MARBLE_GEOMETRY as G, localToWorld } from '../../shared/marbleMath.mjs'
import { WORLD_VERSION, type WorldSnapshot } from '../../shared/worldProtocol.mjs'
import { drawMarbleScreen } from './drawMarbleScreen'

interface RecordedGradient {
  r0: number
  r1: number
  stops: Array<[number, string]>
}

interface RecordedArc {
  x: number
  y: number
  r: number
}

function createMockCanvasContext() {
  const arcs: RecordedArc[] = []
  const fills: Array<string | RecordedGradient> = []
  const ellipses: Array<{ x: number; y: number }> = []
  const gradients: RecordedGradient[] = []
  const texts: string[] = []

  let currentFill: string | RecordedGradient = ''
  const makeRadialGradient = (_x0: number, _y0: number, r0: number, _x1: number, _y1: number, r1: number) => {
    if (!Number.isFinite(r0) || !Number.isFinite(r1) || r0 < 0 || r1 < 0) {
      throw new RangeError(`IndexSizeError: invalid radial gradient radii (${r0}, ${r1})`)
    }
    const g: RecordedGradient = { r0, r1, stops: [] }
    gradients.push(g)
    return {
      addColorStop(offset: number, color: string) {
        g.stops.push([offset, color])
      },
    }
  }
  const makeLinearGradient = () => {
    const g: RecordedGradient = { r0: 0, r1: 0, stops: [] }
    gradients.push(g)
    return {
      addColorStop(offset: number, color: string) {
        g.stops.push([offset, color])
      },
    }
  }

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'left',
    font: '',
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    roundRect() {},
    rect() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    stroke() {},
    fillText(text: string) {
      texts.push(text)
    },
    fillRect() {
      fills.push(currentFill)
    },
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r })
    },
    ellipse(x: number, y: number) {
      ellipses.push({ x, y })
    },
    fill() {
      fills.push(currentFill)
    },
    createLinearGradient: makeLinearGradient,
    createRadialGradient: makeRadialGradient,
  }

  Object.defineProperty(ctx, 'fillStyle', {
    get: () => currentFill,
    set: (value: string | RecordedGradient) => {
      currentFill = value
    },
  })

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    arcs,
    fills,
    ellipses,
    gradients,
    texts,
  }
}

function makeSnapshot(
  localBallPos: [number, number, number],
  ballQuaternion?: [number, number, number, number],
): WorldSnapshot {
  const phone = {
    position: [0, 0.2, 0] as [number, number, number],
    quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as [number, number, number, number],
  }
  return {
    type: 'world-snapshot',
    protocolVersion: WORLD_VERSION,
    worldId: 'test',
    epoch: 1,
    sequence: 1,
    serverTimeMs: 1000,
    phase: 'running',
    reason: '',
    ownerId: null,
    phoneSessionId: null,
    phoneConnectionId: null,
    source: null,
    canStart: false,
    canAddBall: false,
    active: true,
    hitCount: 2,
    region: localBallPos[2] > G.screenZ + 0.002 ? 'air' : 'tray',
    geometry: G,
    phone,
    balls: [
      {
        id: 'ball-1',
        state: 'active',
        position: localToWorld(localBallPos, phone) as [number, number, number],
        quaternion: ballQuaternion ?? phone.quaternion,
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        radius: G.radius,
      },
    ],
    activeBallId: 'ball-1',
    lastImpact: null,
  }
}

describe('drawMarbleScreen', () => {
  it('aligns surface-mode shadow and recessed slot strictly within fitted 3D screen meters on X and Y', () => {
    const snap = makeSnapshot([0.02, -0.03, G.screenZ])
    const mock = createMockCanvasContext()
    const displayWidthMeters = G.width * 1.05
    const displayHeightMeters = G.height * 1.05
    const canvasWidth = 640
    const canvasHeight = Math.round(canvasWidth * (displayHeightMeters / displayWidthMeters))

    drawMarbleScreen(mock.ctx, canvasWidth, canvasHeight, snap, {
      mode: 'surface',
      displayWidthMeters,
      displayHeightMeters,
    })

    const expectedX = (0.5 + 0.02 / displayWidthMeters) * canvasWidth
    const expectedY = (0.5 - -0.03 / displayHeightMeters) * canvasHeight
    const expectedScale = 0.5 * (canvasWidth / displayWidthMeters + canvasHeight / displayHeightMeters)
    const expectedFullRadius = G.radius * expectedScale

    // The three non-reticle arcs at (expectedX, expectedY) are AO shadow, caustic glow, and recessed slot
    const ballArcs = mock.arcs.filter(
      (a) => Math.abs(a.x - expectedX) < 0.05 && Math.abs(a.y - expectedY) < 0.05,
    )
    expect(ballArcs).toHaveLength(3)
    const [aoArc, causticArc, wellArc] = ballArcs
    expect(aoArc.r).toBeCloseTo(expectedFullRadius * 1.42, 3)
    expect(causticArc.r).toBeCloseTo(expectedFullRadius * 1.68, 3)
    expect(wellArc.r).toBeCloseTo(expectedFullRadius * 0.96, 3)
    expect(wellArc.r).toBeLessThan(expectedFullRadius)
    expect(mock.ellipses).toHaveLength(0)
  })

  it('bounds the surface-mode recessed well to the z = screenZ cross-section as a ball drops out the exit gate', () => {
    const dropDepth = G.radius * 0.85
    const snap = makeSnapshot([G.width / 2 + 0.002, 0, G.screenZ - dropDepth])
    const mock = createMockCanvasContext()
    const canvasWidth = 640
    const canvasHeight = Math.round(canvasWidth * (G.height / G.width))

    drawMarbleScreen(mock.ctx, canvasWidth, canvasHeight, snap, {
      mode: 'surface',
      displayWidthMeters: G.width,
      displayHeightMeters: G.height,
    })

    const expectedX = (0.5 + (G.width / 2 + 0.002) / G.width) * canvasWidth
    const expectedScale = 0.5 * (canvasWidth / G.width + canvasHeight / G.height)
    const expectedSliceRadius =
      Math.sqrt(G.radius * G.radius - dropDepth * dropDepth) * expectedScale

    const ballArcs = mock.arcs.filter((a) => Math.abs(a.x - expectedX) < 0.05)
    // Caustic glow is suppressed because proximity < 0.2 while dropping; only AO shadow + shrunk well draw
    expect(ballArcs).toHaveLength(2)
    expect(ballArcs[1].r).toBeCloseTo(expectedSliceRadius * 0.96, 2)
    expect(ballArcs[1].r).toBeLessThan(G.radius * expectedScale * 0.6)
  })

  it('draws soft airborne AO shadow without a recessed slot when tossed above the screen', () => {
    const snap = makeSnapshot([0, 0, G.screenZ + 0.04])
    const mock = createMockCanvasContext()

    drawMarbleScreen(mock.ctx, 640, 1380, snap, {
      mode: 'surface',
      displayWidthMeters: G.width,
      displayHeightMeters: G.height,
    })

    const ballArcs = mock.arcs.filter(
      (a) =>
        Math.abs(a.x - 320) < 0.05 &&
        a.y === 690 &&
        Math.abs(a.r - 640 * 0.32) > 1 &&
        Math.abs(a.r - 640 * 0.16) > 1,
    )
    expect(ballArcs).toHaveLength(2)
    expect(ballArcs[0].r).toBeGreaterThan(G.radius * (640 / G.width) * 1.42)
  })

  it('renders cleanly in preview mode (s = null) and omits shadow far behind the phone', () => {
    const nullMock = createMockCanvasContext()
    drawMarbleScreen(nullMock.ctx, 640, 1380, null, { mode: 'surface' })
    expect(nullMock.arcs.filter((a) => a.x === 320 && a.y === 690)).toHaveLength(2)

    const behindSnap = makeSnapshot([0, 0, G.screenZ - 0.05])
    const behindMock = createMockCanvasContext()
    drawMarbleScreen(behindMock.ctx, 640, 1380, behindSnap, { mode: 'surface' })
    expect(behindMock.arcs.filter((a) => a.x === 320 && a.y === 690)).toHaveLength(2)
  })

  it('renders standalone 2D controller marble across front and back marker orientations without an eyeball dot', () => {
    const frontSnap = makeSnapshot([0, 0, G.screenZ])
    const frontMock = createMockCanvasContext()

    drawMarbleScreen(frontMock.ctx, 390, 844, frontSnap, { mode: '2d' })

    expect(frontMock.ellipses).toHaveLength(0)
    expect(frontMock.fills.some((f) => f === '#072215')).toBe(false)
    expect(frontMock.arcs.some((a) => Math.abs(a.r - G.radius * (390 / G.width)) < 0.5)).toBe(true)

    // Rotate ball 180 degrees around phone local Y so marker[2] === -1 (<= -0.25)
    const flippedQuat = new Quaternion(...frontSnap.phone!.quaternion)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI))
      .toArray() as [number, number, number, number]
    const backSnap = makeSnapshot([0, 0, G.screenZ], flippedQuat)
    const backMock = createMockCanvasContext()

    drawMarbleScreen(backMock.ctx, 390, 844, backSnap, { mode: '2d' })
    expect(backMock.arcs.length).toBeLessThan(frontMock.arcs.length)
  })

  it('shows Elastic Tray prompt and omits all marble/shadow/well arcs before the round starts', () => {
    const readySnap: WorldSnapshot = {
      ...makeSnapshot([0, 0, G.screenZ]),
      phase: 'ready',
      active: false,
      balls: [],
      activeBallId: null,
    }
    const mock = createMockCanvasContext()

    drawMarbleScreen(mock.ctx, 640, 1380, readySnap, { mode: 'surface' })
    expect(mock.texts).toContain('ELASTIC TRAY')
    expect(mock.texts).toContain('PRESS START')
    // Only the two precision reticle rings at center (320, 690) are drawn when idle/ready
    expect(mock.arcs.filter((a) => a.x === 320 && a.y === 690)).toHaveLength(2)

    const mock2d = createMockCanvasContext()
    drawMarbleScreen(mock2d.ctx, 390, 844, readySnap, { mode: '2d' })
    expect(mock2d.texts).toContain('ELASTIC TRAY')
    expect(mock2d.arcs.filter((a) => a.x === 195 && a.y === 422)).toHaveLength(2)
  })
})
