import { describe, expect, it } from 'vitest'
import {
  normalizeQuaternion,
  parseLiveTextMessage,
  multiplyQuaternions,
  relativeQuaternion,
} from './liveProtocol'

describe('live phone protocol', () => {
  it('accepts a finite pose packet', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'pose',
          timestampMs: 42,
          quaternion: [0, 0, 0, 1],
          rotationRate: [0.1, 0.2, 0.3],
          requestedHz: 200,
          sampleIntervalMs: 10,
        }),
      ),
    ).toMatchObject({
      type: 'pose',
      timestampMs: 42,
      quaternion: [0, 0, 0, 1],
      rotationRate: [0.1, 0.2, 0.3],
      requestedHz: 200,
      sampleIntervalMs: 10,
    })
  })

  it('accepts timing fields stamped by the phone and bridge', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'frame-meta',
          frameId: 7,
          timestampMs: 100,
          captureAtMs: 100,
          callbackAtMs: 104,
          encodeStartedAtMs: 105,
          encodedAtMs: 125,
          width: 1206,
          height: 2622,
          orientation: 'portrait',
          jpegBytes: 123_456,
          clockOffsetMs: 2.5,
          clockRttMs: 4,
          bridgeReceivedAtMs: 136,
          bridgeRelayedAtMs: 137,
          payloadBytes: 123_456,
        }),
      ),
    ).toMatchObject({
      type: 'frame-meta',
      frameId: 7,
      captureAtMs: 100,
      encodedAtMs: 125,
      clockOffsetMs: 2.5,
      bridgeReceivedAtMs: 136,
    })
  })

  it('rejects malformed and non-finite packets', () => {
    expect(parseLiveTextMessage('{')).toBeNull()
    expect(
      parseLiveTextMessage(
        '{"type":"pose","timestampMs":1,"quaternion":[0,0,0,null]}',
      ),
    ).toBeNull()
  })

  it('normalizes quaternions and computes an identity zero pose', () => {
    const pose = normalizeQuaternion([0.2, 0.1, -0.3, 0.9])
    const relative = relativeQuaternion(pose, pose)

    expect(relative[0]).toBeCloseTo(0)
    expect(relative[1]).toBeCloseTo(0)
    expect(relative[2]).toBeCloseTo(0)
    expect(relative[3]).toBeCloseTo(1)
  })

  it('composes a relative pose onto a fixed world-space base pose', () => {
    const horizontal = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const
    const result = multiplyQuaternions(horizontal, [0, 0, 0, 1])

    expect(result[0]).toBeCloseTo(horizontal[0])
    expect(result[1]).toBeCloseTo(horizontal[1])
    expect(result[2]).toBeCloseTo(horizontal[2])
    expect(result[3]).toBeCloseTo(horizontal[3])
  })
})
