import { describe, expect, it } from 'vitest'
import {
  deriveWebRTCReceiverMetrics,
  rollingDecodedFps,
  type WebRTCReceiverSample,
} from './webRTCStats'

function sample(
  overrides: Partial<WebRTCReceiverSample> = {},
): WebRTCReceiverSample {
  return {
    codecMimeType: 'video/H264',
    timestampMs: 1_000,
    bytesReceived: 100_000,
    framesDecoded: 100,
    framesDropped: 2,
    framesPerSecond: null,
    packetsReceived: 1_000,
    packetsLost: 10,
    jitterBufferDelaySeconds: 2,
    jitterBufferEmittedCount: 100,
    jitterBufferMinimumDelaySeconds: 1.5,
    jitterBufferTargetDelaySeconds: 1.8,
    totalDecodeTimeSeconds: 0.5,
    roundTripTimeSeconds: 0.02,
    ...overrides,
  }
}

describe('deriveWebRTCReceiverMetrics', () => {
  it('uses interval deltas for bitrate, fps, jitter, and decode time', () => {
    const previous = sample()
    const current = sample({
      timestampMs: 2_000,
      bytesReceived: 300_000,
      framesDecoded: 120,
      jitterBufferDelaySeconds: 2.2,
      jitterBufferEmittedCount: 120,
      jitterBufferMinimumDelaySeconds: 1.7,
      jitterBufferTargetDelaySeconds: 2,
      totalDecodeTimeSeconds: 0.6,
    })

    const metrics = deriveWebRTCReceiverMetrics(current, previous)
    expect(metrics.bitrateMbps).toBeCloseTo(1.6)
    expect(metrics.decodeMs).toBeCloseTo(5)
    expect(metrics.estimatedPipelineMs).toBeCloseTo(25)
    expect(metrics.fps).toBeCloseTo(20)
    expect(metrics.jitterBufferMs).toBeCloseTo(10)
    expect(metrics.jitterBufferMinimumMs).toBeCloseTo(10)
    expect(metrics.jitterBufferTargetMs).toBeCloseTo(10)
    expect(metrics.packetLossPercent).toBeCloseTo((10 / 1_010) * 100)
    expect(metrics.roundTripMs).toBeCloseTo(20)
  })

  it('uses cumulative averages for the first sample', () => {
    const metrics = deriveWebRTCReceiverMetrics(sample(), null)
    expect(metrics.jitterBufferMs).toBe(20)
    expect(metrics.jitterBufferMinimumMs).toBe(15)
    expect(metrics.jitterBufferTargetMs).toBeCloseTo(18)
    expect(metrics.decodeMs).toBe(5)
    expect(metrics.estimatedPipelineMs).toBe(35)
    expect(metrics.bitrateMbps).toBeNull()
  })
})

describe('rollingDecodedFps', () => {
  it('averages decoded frames across the supplied window', () => {
    expect(
      rollingDecodedFps([
        sample({ timestampMs: 1_000, framesDecoded: 10 }),
        sample({ timestampMs: 6_000, framesDecoded: 70 }),
        sample({ timestampMs: 11_000, framesDecoded: 130 }),
      ]),
    ).toBe(12)
  })

  it('rejects a counter reset', () => {
    expect(
      rollingDecodedFps([
        sample({ timestampMs: 1_000, framesDecoded: 50 }),
        sample({ timestampMs: 2_000, framesDecoded: 5 }),
      ]),
    ).toBeNull()
  })
})
