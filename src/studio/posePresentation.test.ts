import { describe, expect, it } from 'vitest'
import {
  POSE_SMOOTHING_RATE,
  usesPosePrediction,
  usesVideoAlignedPose,
} from './posePresentation'

describe('pose presentation modes', () => {
  it('aligns synchronized motion to the displayed video frame', () => {
    expect(usesVideoAlignedPose('synchronized')).toBe(true)
  })

  it('uses the newest pose and faster smoothing in low-latency mode', () => {
    expect(usesVideoAlignedPose('low-latency')).toBe(false)
    expect(POSE_SMOOTHING_RATE['low-latency']).toBeGreaterThan(
      POSE_SMOOTHING_RATE.synchronized,
    )
  })

  it('renders instant mode without interpolation', () => {
    expect(POSE_SMOOTHING_RATE.instant).toBe(Number.POSITIVE_INFINITY)
    expect(usesPosePrediction('instant')).toBe(false)
  })

  it('enables bounded prediction only in ultra mode', () => {
    expect(POSE_SMOOTHING_RATE.ultra).toBe(Number.POSITIVE_INFINITY)
    expect(usesPosePrediction('ultra')).toBe(true)
  })
})
