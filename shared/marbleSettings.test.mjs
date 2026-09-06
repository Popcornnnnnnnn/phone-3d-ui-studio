import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { DEFAULT_MARBLE_SETTINGS, parseMarbleSettings } from './marbleSettings.mjs'
import { marbleGeometry, scaleMarbleTranslation } from './marbleMath.mjs'
import { parseWorldCommand, parseWorldSnapshot } from './worldProtocol.mjs'
import fixtures from './fixtures/marble-frames.json'

describe('round settings', () => {
  it('scales all translations around the calibration anchor while preserving rotation', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4).toArray()
    for (const scale of [0.25, 0.5, 1]) for (let axis = 0; axis < 3; axis++) {
      const position = [0, 0.2, 0]; position[axis] += 0.2
      const result = scaleMarbleTranslation({ position, quaternion: q }, scale)
      const expected = [0, 0.2, 0]; expected[axis] += 0.2 * scale
      result.position.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12))
      expect(result.quaternion).toEqual(q)
      expect(scaleMarbleTranslation({ position: [0, 0.2, 0], quaternion: q }, scale).position).toEqual([0, 0.2, 0])
    }
  })
  it('rejects unsafe, partial and non-numeric settings instead of clamping them silently', () => {
    for (const bad of [null, [], {}, { ...DEFAULT_MARBLE_SETTINGS, movementScale: 0 },
      { ...DEFAULT_MARBLE_SETTINGS, movementScale: Infinity }, { ...DEFAULT_MARBLE_SETTINGS, restitution: 1 },
      { ...DEFAULT_MARBLE_SETTINGS, ballDiameterMm: 100 }, { ...DEFAULT_MARBLE_SETTINGS, restitution: '0.3' }]) {
      expect(parseMarbleSettings(bad)).toBeNull()
    }
  })
  it('allows settings only on an explicit new round and keeps old v2 commands compatible', () => {
    const command = { type: 'world-command', protocolVersion: 2, commandId: 'test', worldId: 'world', epoch: 1, action: 'start' }
    expect(parseWorldCommand(command)).not.toBeNull()
    expect(parseWorldCommand({ ...command, settings: DEFAULT_MARBLE_SETTINGS })?.settings).toEqual(DEFAULT_MARBLE_SETTINGS)
    expect(parseWorldCommand({ ...command, action: 'add-ball', settings: DEFAULT_MARBLE_SETTINGS })).toBeNull()
    expect(parseWorldCommand({ ...command, settings: {} })).toBeNull()
  })
  it('requires declared settings, ball radius and finite-slot geometry to agree', () => {
    const s = structuredClone(fixtures[0].snapshot)
    s.settings = { ...DEFAULT_MARBLE_SETTINGS, ballDiameterMm: 20 }
    s.geometry = marbleGeometry(s.settings); s.balls[0].radius = 0.01
    expect(parseWorldSnapshot(s)).not.toBeNull()
    s.geometry.radius = 0.0075
    expect(parseWorldSnapshot(s)).toBeNull()
  })
})
