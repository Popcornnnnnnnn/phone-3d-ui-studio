import { describe, expect, it } from 'vitest'
import {
  captureTimeToEpochMs,
  interpolatePoseAt,
  recordPoseSample,
  type TimedPoseQuaternion,
} from './poseTimeline'

const identity = [0, 0, 0, 1] as const

describe('pose timeline', () => {
  it('orders samples, replaces duplicates, and prunes old history', () => {
    const history: TimedPoseQuaternion[] = []
    recordPoseSample(history, { timestampMs: 3_000, quaternion: identity }, 1_000)
    recordPoseSample(history, { timestampMs: 2_500, quaternion: identity }, 1_000)
    recordPoseSample(history, { timestampMs: 4_500, quaternion: identity }, 1_000)
    recordPoseSample(history, {
      timestampMs: 4_500,
      quaternion: [0, 0, 1, 0],
    }, 1_000)

    expect(history.map((sample) => sample.timestampMs)).toEqual([3_000, 4_500])
    expect(history[1].quaternion).toEqual([0, 0, 1, 0])
  })

  it('spherically interpolates between the surrounding samples', () => {
    const result = interpolatePoseAt(
      [
        { timestampMs: 1_000, quaternion: identity },
        { timestampMs: 1_100, quaternion: [0, 0, 1, 0] },
      ],
      1_050,
    )

    expect(result?.timestampMs).toBe(1_050)
    expect(result?.nearestSampleDeltaMs).toBe(50)
    expect(result?.quaternion[2]).toBeCloseTo(Math.SQRT1_2)
    expect(result?.quaternion[3]).toBeCloseTo(Math.SQRT1_2)
  })

  it('takes the shortest path across equivalent quaternion signs', () => {
    const result = interpolatePoseAt(
      [
        { timestampMs: 1_000, quaternion: identity },
        { timestampMs: 1_100, quaternion: [0, 0, 0, -1] },
      ],
      1_050,
    )

    expect(result?.quaternion).toEqual(identity)
  })

  it('uses the nearest edge sample outside the retained range', () => {
    const history: TimedPoseQuaternion[] = [
      { timestampMs: 1_000, quaternion: identity },
      { timestampMs: 1_100, quaternion: [0, 0, 1, 0] },
    ]

    expect(interpolatePoseAt(history, 900)?.nearestSampleDeltaMs).toBe(100)
    expect(interpolatePoseAt(history, 1_250)?.nearestSampleDeltaMs).toBe(150)
  })
})

describe('capture time conversion', () => {
  it('converts DOMHighResTimeStamp using the browser time origin', () => {
    expect(captureTimeToEpochMs(500, 1_000_520, 1_000_000)).toBe(1_000_500)
  })

  it('accepts an epoch-style defensive fallback and rejects stale values', () => {
    expect(
      captureTimeToEpochMs(
        1_788_413_300_500,
        1_788_413_300_520,
        1_788_413_000_000,
      ),
    ).toBe(1_788_413_300_500)
    expect(captureTimeToEpochMs(500, 2_000_000, 1_000_000)).toBeNull()
  })
})
