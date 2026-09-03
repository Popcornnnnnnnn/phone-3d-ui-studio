import { describe, expect, it } from 'vitest'
import {
  buildLiveMeasurementReport,
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

    const report = buildLiveMeasurementReport(1_000, 2_000, [frame], [], 0)

    expect(report.screen.captureToRender.p50Ms).toBe(66)
    expect(report.screen.encode.p50Ms).toBe(20)
    expect(report.screen.averageBitrateMbps).toBe(0.8)
    expect(JSON.stringify(report)).not.toContain('pixelData')
  })
})
