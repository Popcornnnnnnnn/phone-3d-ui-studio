import { describe, expect, it } from 'vitest'
import {
  MAX_POSE_PREDICTION_MS,
  posePredictionHorizonMs,
  predictQuaternion,
} from './posePrediction'

describe('ultra pose prediction', () => {
  it('predicts a local 90 degree Z rotation from angular velocity', () => {
    const predicted = predictQuaternion(
      [0, 0, 0, 1],
      [0, 0, Math.PI / 2],
      1_000,
    )

    expect(predicted[0]).toBeCloseTo(0)
    expect(predicted[1]).toBeCloseTo(0)
    expect(predicted[2]).toBeCloseTo(Math.SQRT1_2)
    expect(predicted[3]).toBeCloseTo(Math.SQRT1_2)
  })

  it('caps extrapolation when a sample arrives unusually late', () => {
    expect(posePredictionHorizonMs(100, 1_000)).toBe(
      MAX_POSE_PREDICTION_MS,
    )
  })

  it('keeps a stationary attitude unchanged', () => {
    expect(predictQuaternion([0, 0, 0, 1], [0, 0, 0], 20)).toEqual([
      0, 0, 0, 1,
    ])
  })
})
