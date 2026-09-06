import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { initMarblePhysics, MarbleWorld } from './marble-world.mjs'
import { MARBLE_GEOMETRY as G, projectMarble, localToWorld } from '../shared/marbleMath.mjs'
const flat = { position: [0, 0.2, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
const tilt = (angle) => ({ ...flat, quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).multiply(new Quaternion(...flat.quaternion)).toArray() })
let worlds = []
const create = () => { const w = new MarbleWorld(flat); worlds.push(w); return w }
const step = (w, n) => { for (let i = 0; i < n; i++) w.step() }
const until = (w, condition, limit = 2000) => { for (let i = 0; i < limit && !condition(); i++) w.step(); expect(condition()).toBe(true) }
const pour = (w) => { w.setPhoneTarget(tilt(-0.5)); until(w, () => !w.activeBallId); w.setPhoneTarget(flat); step(w, 120) }
beforeAll(initMarblePhysics)
afterEach(() => { worlds.forEach((w) => w.free()); worlds = [] })
describe('elastic tray authoritative physics and lifecycle', () => {
  it('rests without self excitation and stays contained behind the left rail', () => {
    const w = create(); step(w, 600)
    expect(w.snapshot().balls[0].position[1]).toBeCloseTo(0.2 + G.screenZ, 3)
    expect(w.hitCount).toBe(0)
    expect(Math.hypot(...w.snapshot().balls[0].velocity)).toBeLessThan(0.001)
    w.setPhoneTarget(tilt(0.35)); step(w, 600)
    expect(w.activeBallId).not.toBeNull(); expect(w.region).toBe('tray')
  })
  it('real upward tray movement tosses the same body, then bounces decay on a stationary tray', () => {
    const w = create(); step(w, 120)
    const id = w.activeBallId, handle = w.activeBall.body.handle
    let highest = 0
    for (let i = 0; i < 60; i++) {
      const dy = 0.04 * (1 - Math.cos(2 * Math.PI * i / 60)) / 2
      w.setPhoneTarget({ ...flat, position: [0, 0.2 + dy, 0] }); w.step()
      highest = Math.max(highest, w.activeBall.body.translation().y)
    }
    w.setPhoneTarget(flat)
    const peaks = []; let lastY = w.activeBall.body.translation().y, wasRising = false
    for (let i = 0; i < 600; i++) {
      w.step(); const y = w.activeBall.body.translation().y
      highest = Math.max(highest, y)
      if (wasRising && y < lastY && lastY > 0.2 + G.screenZ + 0.001) peaks.push(lastY - 0.2 - G.screenZ)
      wasRising = y > lastY; lastY = y
    }
    expect(highest).toBeGreaterThan(0.24)
    // Softer contacts may settle after one rebound above the 1 mm threshold.
    expect(peaks.length).toBeGreaterThan(0)
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1])
    expect(w.activeBallId).toBe(id); expect(w.activeBall.body.handle).toBe(handle)
    expect(w.hitCount).toBeGreaterThan(0)
    const contacts = w.hitCount; step(w, 300); expect(w.hitCount).toBe(contacts)
    expect(Math.hypot(...w.snapshot().balls[0].velocity)).toBeLessThan(0.001)
    expect(w.lastImpact.ballId).toBe(id)
  })
  it('ends play on first ground contact; adds a new ID at the current phone without moving the trace', () => {
    const w = create(), oldId = w.activeBallId
    w.setPhoneTarget(tilt(-0.5)); until(w, () => !w.activeBallId)
    expect(w.balls[0].state).toBe('settling'); expect(w.region).toBe('needs-ball')
    const before = w.snapshot().balls[0]
    expect(before.position[0]).toBeGreaterThan(G.width / 2)
    w.setPhoneTarget({ ...flat, position: [0.15, 0.25, 0] }); step(w, 120)
    const trace = structuredClone(w.snapshot().balls[0]), phone = structuredClone(w.phone)
    expect(w.addBall()).toBe(true); expect(w.activeBallId).not.toBe(oldId)
    expect(w.phone).toEqual(phone); expect(w.snapshot().balls[0]).toEqual(trace)
    expect(w.snapshot().balls[1].position[0]).toBeCloseTo(0.15, 6)
    expect(w.addBall()).toBe(false)
  })
  it('retains at most five balls, removes the oldest, and removes settled physics bodies', () => {
    const w = create(), oldest = w.activeBallId
    for (let round = 0; round < 6; round++) {
      pour(w); until(w, () => w.balls.every((b) => b.state === 'rested'))
      expect(w.balls.every((b) => b.body === null)).toBe(true)
      expect(w.addBall()).toBe(true); expect(w.balls.length).toBeLessThanOrEqual(5)
    }
    expect(w.balls).toHaveLength(5); expect(w.balls.some((b) => b.id === oldest)).toBe(false)
  })
  it('spent balls cannot be scooped up or collide with a new active ball', () => {
    const w = create(); pour(w); until(w, () => w.balls[0].state === 'rested')
    const trace = structuredClone(w.snapshot().balls[0])
    w.setPhoneTarget({ ...flat, position: [trace.position[0], -G.screenZ, trace.position[2]] }); step(w, 240)
    expect(w.snapshot().balls[0]).toEqual(trace); expect(w.activeBallId).toBeNull()
    expect(w.hitCount).toBe(0)
  })
  it('out of bounds removes a ball without auto respawn; upside-down addition is rejected', () => {
    const w = create(); w.activeBall.body.setTranslation({ x: 0.9, y: -0.4, z: 0 }, true); w.step()
    expect(w.activeBallId).toBeNull(); expect(w.balls).toHaveLength(0)
    step(w, 120); expect(w.balls).toHaveLength(0)
    w.setPhoneTarget(tilt(Math.PI)); step(w, 2)
    expect(w.canAddBall).toBe(false); expect(w.addBall()).toBe(false)
    w.setPhoneTarget(flat); step(w, 2); expect(w.addBall()).toBe(true)
  })
  it('does not report predictive contacts several millimeters above the tray as a catch', () => {
    const w = create()
    w.activeBall.body.setTranslation({ x: 0, y: 0.2 + G.screenZ + 0.005, z: 0 }, true)
    step(w, 1)
    expect(w.contact(w.activeBall.collider, w.surface)).toBe(false)
    until(w, () => w.hitCount === 1)
    expect(w.activeBall.body.translation().y - 0.2 - G.screenZ).toBeLessThan(0.0004)
    step(w, 240)
    expect(w.hitCount).toBe(1)
  })
  it('projects only the finite slot, with partial spheres at both depth boundaries and the exit', () => {
    const ball = { quaternion: flat.quaternion, radius: G.radius }
    const at = (x, d) => projectMarble({ ...ball, position: localToWorld([x, 0, G.screenZ + d], flat) }, flat)
    expect(at(0, G.radius + 0.001).radius).toBe(0)
    expect(at(0, -2 * G.radius - 0.001).radius).toBe(0)
    expect(at(0, -0.2).radius).toBe(0)
    expect(at(0, G.radius / 2).radius).toBeCloseTo(Math.sqrt(3) * G.radius / 2, 8)
    expect(at(0, -1.5 * G.radius).radius).toBeCloseTo(Math.sqrt(3) * G.radius / 2, 8)
    expect(at(0, 0).u).toBeCloseTo(0.5, 8)
    expect(at(G.width / 2, 0).u).toBeCloseTo(1, 8)
    expect(at(G.width / 2 + G.radius / 2, 0).radius).toBeCloseTo(G.radius, 8)
  })
})
