import { describe, expect, it } from 'vitest'
import { MARBLE_GEOMETRY as G, localToWorld } from '../../shared/marbleMath.mjs'
import { WORLD_VERSION, type WorldSnapshot } from '../../shared/worldProtocol.mjs'
import { drawMarbleScreen } from './drawMarbleScreen'

interface RecordedGradient {
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

  let currentFill: string | RecordedGradient = ''
  const makeGradient = () => {
    const g: RecordedGradient = { stops: [] }
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
    fillText() {},
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
    createLinearGradient: makeGradient,
    createRadialGradient: makeGradient,
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
  }
}

function makeSnapshot(localBallPos: [number, number, number]): WorldSnapshot {
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
        quaternion: phone.quaternion,
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
  it('aligns surface-mode shadow and recessed slot strictly within fitted 3D screen meters', () => {
    const snap = makeSnapshot([0.02, 0, G.screenZ])
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
    const expectedScale = 0.5 * (canvasWidth / displayWidthMeters + canvasHeight / displayHeightMeters)
    const expectedFullRadius = G.radius * expectedScale

    // First two non-reticle arcs after x = cx (320) belong to AO shadow, caustic glow, and recessed slot
    const ballArcs = mock.arcs.filter((a) => Math.abs(a.x - expectedX) < 0.05)
    expect(ballArcs).toHaveLength(3)
    const [aoArc, causticArc, wellArc] = ballArcs
    expect(aoArc.r).toBeCloseTo(expectedFullRadius * 1.42, 3)
    expect(causticArc.r).toBeCloseTo(expectedFullRadius * 1.68, 3)
    expect(wellArc.r).toBeCloseTo(expectedFullRadius * 0.96, 3)
    expect(wellArc.r).toBeLessThan(expectedFullRadius)
    expect(mock.ellipses).toHaveLength(0)
  })

  it('draws soft airborne AO shadow without a recessed slot when tossed above the screen', () => {
    const snap = makeSnapshot([0, 0, G.screenZ + 0.04])
    const mock = createMockCanvasContext()

    drawMarbleScreen(mock.ctx, 640, 1380, snap, {
      mode: 'surface',
      displayWidthMeters: G.width,
      displayHeightMeters: G.height,
    })

    const ballArcs = mock.arcs.filter((a) => Math.abs(a.x - 320) < 0.05 && a.y === 690 && Math.abs(a.r - 640 * 0.32) > 1 && Math.abs(a.r - 640 * 0.16) > 1)
    // AO shadow + faint caustic glow, no recessed inner well
    expect(ballArcs).toHaveLength(2)
    expect(ballArcs[0].r).toBeGreaterThan(G.radius * (640 / G.width) * 1.42)
  })

  it('omits screen marble shadow when the ball is far behind the phone', () => {
    const snap = makeSnapshot([0, 0, G.screenZ - 0.05])
    const mock = createMockCanvasContext()

    drawMarbleScreen(mock.ctx, 640, 1380, snap, { mode: 'surface' })

    // Only the two centered reticle circles exist
    const centeredArcs = mock.arcs.filter((a) => a.x === 320 && a.y === 690)
    expect(centeredArcs).toHaveLength(2)
  })

  it('renders standalone 2D controller marble without an opaque eyeball dot', () => {
    const snap = makeSnapshot([0, 0, G.screenZ])
    const mock = createMockCanvasContext()

    drawMarbleScreen(mock.ctx, 390, 844, snap, { mode: '2d' })

    expect(mock.ellipses).toHaveLength(0)
    expect(mock.fills.some((f) => f === '#072215')).toBe(false)
    expect(mock.arcs.some((a) => Math.abs(a.r - G.radius * (390 / G.width)) < 0.5)).toBe(true)
  })
})
