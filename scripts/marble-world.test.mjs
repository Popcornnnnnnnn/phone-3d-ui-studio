import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { initMarblePhysics, MarbleWorld } from './marble-world.mjs'
import { MARBLE_GEOMETRY as G, projectMarble, localToWorld } from '../shared/marbleMath.mjs'
const flat = { position: [0, 0.2, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
const tilt = (angle) => ({ ...flat, quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).multiply(new Quaternion(...flat.quaternion)).toArray() })
let worlds = []
const create = () => { const w = new MarbleWorld(flat); worlds.push(w); return w }
const until = (w, condition, limit = 1600) => { for (let i = 0; i < limit && !condition(); i++) w.step(); expect(condition()).toBe(true) }
beforeAll(initMarblePhysics)
afterEach(() => { worlds.forEach((w) => w.free()); worlds = [] })
describe('single authoritative marble', () => {
  it('rests on the metric screen plane and remains contained behind the left rail', () => {
    const w = create(); for (let i = 0; i < 120; i++) w.step()
    expect(w.snapshot().ball.position[1]).toBeCloseTo(0.2 + G.screenZ, 3)
    w.setPhoneTarget(tilt(0.35)); for (let i = 0; i < 600; i++) w.step()
    expect(w.region).toBe('phone'); expect(w.lost).toBe(false)
  })
  it('pours, settles, launches toward the original target and catches without replacing or snapping the ball', () => {
    const w = create(), handle = w.ball.handle, id = w.snapshot().ball.id
    w.setPhoneTarget(tilt(-0.5)); until(w, () => w.canReturn)
    const position = w.snapshot().ball.position, rotation = w.snapshot().ball.quaternion
    w.setPhoneTarget(flat); for (let i = 0; i < 60; i++) w.step()
    const before = w.snapshot().ball
    expect(w.launchReturn()).toBe(true)
    expect(w.snapshot().ball.position).toEqual(before.position)
    expect(w.snapshot().ball.quaternion).toEqual(before.quaternion)
    expect(w.catchTarget[0]).toBe(0)
    until(w, () => w.catchCount === 1, 400)
    expect(w.ball.handle).toBe(handle); expect(w.snapshot().ball.id).toBe(id)
    expect(Math.hypot(...w.snapshot().ball.velocity)).toBeGreaterThan(0.01)
    expect(position[0]).toBeGreaterThan(G.width / 2); expect(rotation).toHaveLength(4)
    for (let i = 0; i < 60; i++) w.step()
    expect(w.catchCount).toBe(1)
  })
  it('completes five consecutive cycles with one persistent rigid body', () => {
    const w = create(), handle = w.ball.handle
    for (let round = 1; round <= 5; round++) {
      w.setPhoneTarget(tilt(-0.5)); until(w, () => w.canReturn)
      w.setPhoneTarget(flat); for (let i = 0; i < 60; i++) w.step()
      expect(w.launchReturn()).toBe(true)
      until(w, () => w.catchCount === round, 400)
      expect(w.ball.handle).toBe(handle)
      for (let i = 0; i < 120; i++) w.step()
    }
  })
  it('does not aim at a displaced phone or invent a catch when it misses', () => {
    const w = create(); w.setPhoneTarget(tilt(-0.5)); until(w, () => w.canReturn)
    w.setPhoneTarget({ ...flat, position: [0.2, 0.2, 0] }); for (let i = 0; i < 60; i++) w.step()
    w.launchReturn(); for (let i = 0; i < 400; i++) w.step()
    expect(w.catchCount).toBe(0); expect(w.catchTarget[0]).toBe(0)
    expect(w.canReturn).toBe(true)
  })
  it('marks out-of-bounds without automatically respawning', () => {
    const w = create(); w.ball.setTranslation({ x: 0.9, y: -0.4, z: 0 }, true); w.step()
    expect(w.lost).toBe(true); expect(w.snapshot().ball.position[0]).toBeGreaterThan(0.8)
    w.resetBall(); expect(w.lost).toBe(false); expect(w.region).toBe('phone')
  })
  it('projects continuous partial spheres at the screen plane and right exit', () => {
    const ball = { quaternion: flat.quaternion, radius: G.radius }
    const at = (x, d) => projectMarble({ ...ball, position: localToWorld([x, 0, G.screenZ + d], flat) }, flat)
    expect(at(0, G.radius + 0.001).radius).toBe(0)
    expect(at(0, G.radius / 2).radius).toBeCloseTo(Math.sqrt(3) * G.radius / 2, 8)
    expect(at(0, 0).u).toBeCloseTo(0.5, 8)
    expect(at(G.width / 2, 0).u).toBeCloseTo(1, 8)
    expect(at(G.width / 2 + G.radius / 2, 0).radius).toBeCloseTo(G.radius, 8)
  })
})
