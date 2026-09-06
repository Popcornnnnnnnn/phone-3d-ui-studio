import { beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { TrayMotion } from './tray-motion.mjs'
import { initMarblePhysics, MarbleWorld, PHYSICS_DT as DT } from './marble-world.mjs'
import { MARBLE_GEOMETRY as G } from '../shared/marbleMath.mjs'
const flat = { position: [0, 0.2, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
beforeAll(initMarblePhysics)
function trial(spacing, amplitude = 0.02) {
  const w = new MarbleWorld(flat), m = new TrayMotion(flat, 0, 0)
  let maxTraySpeed = 0, maxHeight = 0
  try {
    for (let i = 1; i <= 720; i++) {
      const time = i * DT, pulseTime = time < 2 ? time : time - 2
      const dy = pulseTime < 0.5 ? amplitude * (1 - Math.cos(4 * Math.PI * pulseTime)) / 2 : 0
      if (i % spacing === 0) m.push({ ...flat, position: [0, 0.2 + dy, 0] }, time * 1000)
      const phone = m.step(time * 1000, DT); expect(phone).not.toBeNull()
      w.setPhoneTarget(phone); w.step()
      maxTraySpeed = Math.max(maxTraySpeed, m.speed)
      const ball = w.snapshot().balls[0]
      if (ball) maxHeight = Math.max(maxHeight, ball.position[1])
    }
    return { maxTraySpeed, maxHeight, hitCount: w.hitCount, ball: w.snapshot().balls[0], active: !!w.activeBallId }
  } finally { w.free() }
}
describe('sampling-time tray motion', () => {
  it('does not turn slower packet delivery into extra collision energy on two small strokes', () => {
    const regular = trial(2), sparse = trial(8), slower = trial(12)
    for (const result of [regular, sparse, slower]) {
      // Analytic maximum of a 2 cm / 0.5 s raised-cosine stroke is 0.126 m/s.
      expect(result.maxTraySpeed).toBeLessThan(0.127)
      expect(result.maxHeight).toBeLessThan(0.23)
      expect(result.active).toBe(true)
      expect(result.ball.position[1]).toBeCloseTo(0.2 + G.screenZ, 3)
    }
    expect(Math.abs(sparse.maxHeight - regular.maxHeight)).toBeLessThan(0.001)
    expect(Math.abs(slower.maxHeight - regular.maxHeight)).toBeLessThan(0.001)
  })
  it('preserves a real gentle toss and catch, without launching assistance', () => {
    const result = trial(2, 0.04)
    expect(result.maxHeight).toBeGreaterThan(0.24)
    expect(result.hitCount).toBeGreaterThanOrEqual(2)
    expect(result.active).toBe(true)
  })
  it('preserves linear and angular velocity despite an underrun and packet burst', () => {
    const m = new TrayMotion(flat, 0, 0), samples = []
    for (let n = 1; n <= 120; n++) {
      const time = n / 60
      const delay = n > 20 && n < 27 ? 0.1 : 0.01
      samples.push({ at: time * 1000, arrived: (time + delay) * 1000,
        pose: { position: [time * 0.08, 0.2, 0], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), time * 0.8).multiply(new Quaternion(...flat.quaternion)).toArray() } })
    }
    // WebSocket preserves sample order, even when delivery is bunched together.
    for (let n = 1; n < samples.length; n++) samples[n].arrived = Math.max(samples[n].arrived, samples[n - 1].arrived)
    let previous = new Quaternion(...flat.quaternion), peak = 0
    for (let i = 1; i <= 240; i++) {
      const now = i * DT * 1000
      while (samples[0]?.arrived <= now) { const s = samples.shift(); m.push(s.pose, s.at) }
      const pose = m.step(now, DT); expect(pose).not.toBeNull()
      peak = Math.max(peak, m.speed)
      const q = new Quaternion(...pose.quaternion)
      expect(previous.angleTo(q) / DT).toBeLessThan(0.801)
      previous = q
    }
    expect(peak).toBeLessThanOrEqual(0.08001)
    expect(peak).toBeGreaterThan(0.079)
  })
  it('filters millimeter hand/tracking jitter without accumulating bounce energy', () => {
    const w = new MarbleWorld(flat), m = new TrayMotion(flat, 0, 0)
    let maxHeight = 0
    try {
      for (let i = 1; i <= 1200; i++) {
        if (i % 2 === 0) m.push({ ...flat, position: [0, 0.2 + (i % 4 === 0 ? 0.001 : -0.001), 0] }, i * DT * 1000)
        w.setPhoneTarget(m.step(i * DT * 1000, DT)); w.step()
        maxHeight = Math.max(maxHeight, w.snapshot().balls[0].position[1])
      }
      expect(maxHeight).toBeLessThan(0.2 + G.screenZ + 0.003)
      expect(w.hitCount).toBe(0); expect(w.activeBallId).not.toBeNull()
    } finally { w.free() }
  })
  it('rejects pose jumps, ignores old sample times, and freezes on exhausted input', () => {
    const m = new TrayMotion(flat, 1000, 5000)
    expect(m.push({ ...flat, position: [0, 0.4, 0] }, 1017)).toBe('jump')
    expect(m.push(flat, 999)).toBe('old')
    expect(m.pose).toEqual(flat)
    expect(m.step(5010, DT)).toEqual(flat)
    expect(m.step(5300, DT)).toBeNull()
  })
})
