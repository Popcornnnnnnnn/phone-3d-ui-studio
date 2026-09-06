import { describe, it, expect } from 'vitest'
import fixtures from '../../shared/fixtures/marble-frames.json'
import { WorldClient } from './WorldClient'
import { parseWorldSnapshot } from '../../shared/worldProtocol.mjs'
import { projectMarble } from '../../shared/marbleMath.mjs'
const initial = () => structuredClone(parseWorldSnapshot(fixtures[0].snapshot)!)
function setup() {
  const c = new WorldClient(), sent: object[] = []
  c.send = (v) => sent.push(v)
  c.receive({ type: 'world-welcome', protocolVersion: 2, worldId: 'fixture-world', clientId: 'fixture-browser' })
  return { c, sent }
}
describe('shared world presentation', () => {
  it('matches the native projection fixtures including partial entry and the right edge', () => {
    for (const fixture of fixtures) {
      const s = parseWorldSnapshot(fixture.snapshot)!
      const p = projectMarble(s.balls[0], s.phone!, s.geometry)
      expect(p.u).toBeCloseTo(fixture.expected.u, 8); expect(p.v).toBeCloseTo(fixture.expected.v, 8); expect(p.radius).toBeCloseTo(fixture.expected.radius, 8)
    }
  })
  it('interpolates phone and ball at the same 50 ms presentation time without extrapolation', () => {
    const { c } = setup(), a = initial(), b = initial()
    b.sequence = 2; b.serverTimeMs = 1100; b.balls[0].position[0] = 0.02; b.phone!.position[0] = 0.01
    c.receive(a, 1000); c.receive(b, 1100)
    expect(c.render(1100)?.balls[0].position[0]).toBeCloseTo(0.01, 8)
    expect(c.render(1100)?.phone?.position[0]).toBeCloseTo(0.005, 8)
    expect(c.render(1200)?.balls[0].position[0]).toBeCloseTo(0.02, 8)
  })
  it('ignores wrong worlds, old epochs, duplicate and malformed snapshots', () => {
    const { c, sent } = setup(), a = initial(); c.receive(a, 1000)
    for (const bad of [a, { ...a, worldId: 'old' }, { ...a, epoch: 0, sequence: 2 }, { ...a, sequence: 3, phone: { position: [NaN, 0, 0], quaternion: a.phone!.quaternion } }]) c.receive(bad, 1001)
    expect(sent).toHaveLength(1); expect(c.latest?.sequence).toBe(1)
  })
  it('freezes a stale display and requires a new round instead of accepting a catch-up jump', () => {
    const { c, sent } = setup(), a = initial(); c.receive(a, 1000); c.render(1050)
    const b = initial(); b.sequence = 2; b.serverTimeMs = 1300; b.balls[0].position[0] = 0.2
    c.receive(b, 1300)
    expect(c.needsRestart).toBe(true); expect(c.render(1300)?.balls[0].position[0]).toBe(0)
    expect(sent.some((v) => 'action' in v && v.action === 'pause')).toBe(true)
    c.receive({ ...b, sequence: 3, epoch: 2, serverTimeMs: 1350 }, 1350)
    expect(c.needsRestart).toBe(false)
  })
  it('interpolates by identity and presents birth and retirement only at their sample time', () => {
    const { c } = setup(), a = initial(), b = initial()
    b.sequence = 2; b.serverTimeMs = 1100
    b.balls[0].state = 'rested'; b.balls[0].position[0] = 0.02
    b.balls.push({ ...structuredClone(a.balls[0]), id: 'new-ball', position: [0.1, 0.204, 0] })
    b.activeBallId = 'new-ball'
    c.receive(a, 1000); c.receive(b, 1100)
    const halfway = c.render(1100)!
    expect(halfway.activeBallId).toBe(a.activeBallId); expect(halfway.balls).toHaveLength(1)
    expect(halfway.balls[0].position[0]).toBeCloseTo(0.01, 8)
    const born = c.render(1150)!
    expect(born.activeBallId).toBe('new-ball'); expect(born.balls).toHaveLength(2)
    expect(born.balls[1].position[0]).toBe(0.1)
  })

})
