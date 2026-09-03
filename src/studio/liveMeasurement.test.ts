import { describe, expect, it } from 'vitest'
import {
  buildLiveMeasurementReport,
  summarizeDetailed,
  summarizeMilliseconds,
  type FrameMeasurementSample,
} from './liveMeasurement'

describe('live measurement report', () => {
  it('computes nearest-rank percentiles', () => {
    expect(summarizeMilliseconds([10, 20, 30, 40, 50])).toEqual({
      samples: 5,
      p50Ms: 30,
      p95Ms: 50,
      maxMs: 50,
    })
  })

  it('computes detailed tail metrics for stress diagnostics', () => {
    expect(summarizeDetailed([10, 20, 30, 40, 50])).toEqual({
      samples: 5,
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
      maxMs: 50,
      averageMs: 30,
    })
  })

  it('keeps pixels out and separates latency stages', () => {
    const frame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'jpeg',
      captureAtMacMs: 1_000,
      callbackAtMacMs: 1_004,
      encodeStartedAtMacMs: 1_005,
      encodedAtMacMs: 1_025,
      bridgeReceivedAtMs: 1_035,
      bridgeRelayedAtMs: 1_036,
      browserReceivedAtMs: 1_041,
      decodedAtMs: 1_050,
      renderedAtMs: 1_066,
      payloadBytes: 100_000,
      clockRttMs: 4,
      poseScreenSkewMs: 7,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [frame],
      [],
      [],
      0,
    )

    expect(report.screen.captureToRender.p50Ms).toBe(66)
    expect(report.screen.encode.p50Ms).toBe(20)
    expect(report.screen.averageBitrateMbps).toBe(0.8)
    expect(JSON.stringify(report)).not.toContain('pixelData')
  })

  it('records pose and render tail behavior for a stress run', () => {
    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [],
      [
        {
          sampledAtMacMs: 1_010,
          bridgeReceivedAtMs: 1_014,
          bridgeRelayedAtMs: 1_015,
          browserReceivedAtMs: 1_020,
          clockRttMs: 2,
          arrivalGapMs: 10,
          sensorIntervalMs: 10,
          angularSpeedDegreesPerSecond: 720,
          predictionCorrectionDegrees: 1.25,
        },
      ],
      [
        {
          renderedAtMs: 1_025,
          frameIntervalMs: 16.7,
          sampleAgeMs: 15,
          predictionMs: 23,
          angularSpeedDegreesPerSecond: 720,
          predictionCapped: false,
        },
        {
          renderedAtMs: 1_055,
          frameIntervalMs: 30,
          sampleAgeMs: 45,
          predictionMs: 30,
          angularSpeedDegreesPerSecond: 900,
          predictionCapped: true,
        },
      ],
      0,
    )

    expect(report.pose.predictionCorrectionDegrees.maxMs).toBe(1.25)
    expect(report.render.frameInterval.maxMs).toBe(30)
    expect(report.render.sampleAge.maxMs).toBe(45)
    expect(report.render.predictionCapHitPercent).toBe(50)
    expect(report.raw.render).toHaveLength(2)
  })
})
