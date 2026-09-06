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
          codec: 'h264',
          isKeyframe: true,
          decoderCodec: 'avc1.64002A',
          h264BitstreamFormat: 'avcc',
          decoderDescriptionBase64: 'AWQAKv/hAARnZAAqAQACaAD9+PgA',
          captureTimestampSource: 'screencapturekit-display-time',
          captureTimestampValid: true,
          captureSampleAgeMs: 3.25,
          producerSessionId: 'session-7',
          captureSource: 'screencapturekit-host',
          captureContentStatus: 'complete',
          freshContent: true,
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
      codec: 'h264',
      isKeyframe: true,
      decoderCodec: 'avc1.64002a',
      h264BitstreamFormat: 'avcc',
      decoderDescriptionBase64: 'AWQAKv/hAARnZAAqAQACaAD9+PgA',
      captureTimestampSource: 'screencapturekit-display-time',
      captureTimestampValid: true,
      captureSampleAgeMs: 3.25,
      producerSessionId: 'session-7',
      captureSource: 'screencapturekit-host',
      captureContentStatus: 'complete',
      freshContent: true,
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

  it('normalizes an unknown capture timestamp source to null', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'frame-meta',
          timestampMs: 100,
          width: 884,
          height: 1_920,
          orientation: 'portrait',
          captureTimestampSource: 'unknown-clock-v9',
          captureTimestampValid: true,
        }),
      ),
    ).toMatchObject({
      captureTimestampSource: null,
      captureTimestampValid: false,
    })
  })

  it('never treats callback fallback or future SCK time as valid capture', () => {
    const baseFrame = {
      type: 'frame-meta',
      frameId: 8,
      timestampMs: 100,
      captureAtMs: 100,
      callbackAtMs: 101,
      encodeStartedAtMs: 102,
      encodedAtMs: 103,
      width: 960,
      height: 2088,
      orientation: 'portrait',
      jpegBytes: 4,
      codec: 'h264',
      isKeyframe: false,
    }

    const callback = parseLiveTextMessage(
      JSON.stringify({
        ...baseFrame,
        captureTimestampSource: 'callback-fallback',
        captureTimestampValid: true,
        captureSampleAgeMs: 0,
      }),
    )
    const futureSck = parseLiveTextMessage(
      JSON.stringify({
        ...baseFrame,
        captureTimestampSource: 'screencapturekit-display-time',
        captureTimestampValid: true,
        captureSampleAgeMs: -0.1,
      }),
    )

    expect(callback).toMatchObject({ captureTimestampValid: false })
    expect(futureSck).toMatchObject({ captureTimestampValid: false })
  })

  it('accepts the iPhone capture heartbeat and normalizes its codec', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'encoder-status',
          timestampMs: 100,
          captureState: 'streaming',
          codec: 'H.264',
          captured: 12,
          submitted: 11,
          encoded: 10,
          accepted: 10,
          rejected: 1,
          targetFps: 30,
          encoderProfileSelected: 'low-latency',
          thermalState: 'fair',
        }),
      ),
    ).toEqual({
      type: 'encoder-status',
      producerSessionId: null,
      captureSource: null,
      timestampMs: 100,
      captureState: 'streaming',
      codec: 'h264',
      captured: 12,
      submitted: 11,
      encoded: 10,
      accepted: 10,
      rejected: 1,
      targetFps: 30,
      encoderProfile: 'low-latency',
      encoderTuningRequested: 'default',
      encoderTuningActive: 'default',
      encoderTuningPresetQueryStatus: null,
      encoderTuningPresetApplyStatus: null,
      encoderTuningFallbackReason: null,
      captureContentStatus: null,
      freshContent: null,
      captureShortEdgeRequested: null,
      captureShortEdgeActive: null,
      captureWidthActive: null,
      captureHeightActive: null,
      captureStreamGeneration: null,
      thermalState: 'fair',
      frameAckWindow: null,
    })
  })

  it('accepts only bounded integer frame windows in encoder heartbeats', () => {
    for (const value of [1, 2, 3, 0, 4, 2.5, '3', null]) {
      const parsed = parseLiveTextMessage(JSON.stringify({
        type: 'encoder-status', timestampMs: 100, frameAckWindow: value,
      }))
      expect(parsed).toMatchObject({
        frameAckWindow: value === 1 || value === 2 || value === 3 ? value : null,
      })
    }
  })

  it('preserves encoder tuning application and fallback diagnostics', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'encoder-status',
          timestampMs: 100,
          captureState: 'streaming',
          codec: 'H.264',
          encoderTuningRequested: 'high-speed-preset',
          encoderTuningActive: 'default',
          encoderTuningPresetQueryStatus: 0,
          encoderTuningPresetApplyStatus: -12900,
          encoderTuningFallbackReason: 'preset-apply-failed(status:-12900)',
        }),
      ),
    ).toMatchObject({
      encoderTuningRequested: 'high-speed-preset',
      encoderTuningActive: 'default',
      encoderTuningPresetQueryStatus: 0,
      encoderTuningPresetApplyStatus: -12900,
      encoderTuningFallbackReason: 'preset-apply-failed(status:-12900)',
    })
  })

  it('accepts synchronized benchmark control and status messages', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'browser-benchmark-prepare',
          browserConfigProtocolVersion: 1,
          runId: 'run-1',
          browserConfigId: 'browser-config-1',
          browserConfigGeneration: 7,
          decoderMode: 'hardware',
          decoderAcceleration: 'prefer-hardware',
          requestedAtMs: 90,
        }),
      ),
    ).toEqual({
      type: 'browser-benchmark-prepare',
      browserConfigProtocolVersion: 1,
      runId: 'run-1',
      browserConfigId: 'browser-config-1',
      browserConfigGeneration: 7,
      decoderMode: 'hardware',
      decoderAcceleration: 'prefer-hardware',
      requestedAtMs: 90,
    })

    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-request',
          runId: 'run-1',
          durationMs: 15_000,
          requestedAtMs: 100,
          targetFps: 30,
          encoderProfile: 'low-latency',
          encoderTuning: 'video-conferencing-preset',
          warmupMs: 2_000,
          captureShortEdge: 720,
        }),
      ),
    ).toEqual({
      type: 'benchmark-request',
      runId: 'run-1',
      durationMs: 15_000,
      requestedAtMs: 100,
      targetFps: 30,
      encoderProfile: 'low-latency',
      encoderTuning: 'video-conferencing-preset',
      warmupMs: 2_000,
      captureShortEdge: 720,
    })

    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-status',
          runId: 'run-1',
          phase: 'completed',
          timestampMs: 15_100,
          durationMs: 15_000,
          targetFps: 30,
          encoderProfile: 'low-latency',
          encoderProfileActive: 'legacy',
          encoderTuning: 'speed-priority',
          encoderTuningActive: 'default',
          benchmarkProtocolVersion: 2,
          producerSessionId: 'run-session-1',
          captureSource: 'replaykit-broadcast-upload',
          captureShortEdgeRequested: 720,
          captureShortEdgeActive: 720,
          captureWidthActive: 720,
          captureHeightActive: 1_566,
          captureStreamGeneration: 8,
          thermalState: 'serious',
        }),
      ),
    ).toEqual({
      type: 'benchmark-status',
      benchmarkProtocolVersion: 2,
      producerSessionId: 'run-session-1',
      captureSource: 'replaykit-broadcast-upload',
      runId: 'run-1',
      phase: 'completed',
      timestampMs: 15_100,
      durationMs: 15_000,
      targetFps: 30,
      encoderProfile: 'low-latency',
      encoderProfileActive: 'legacy',
      encoderTuning: 'speed-priority',
      encoderTuningActive: 'default',
      captureShortEdgeRequested: 720,
      captureShortEdgeActive: 720,
      captureWidthActive: 720,
      captureHeightActive: 1_566,
      captureStreamGeneration: 8,
      thermalState: 'serious',
    })
  })

  it('rejects malformed browser decoder prepare generations and modes', () => {
    const base = {
      type: 'browser-benchmark-prepare',
      browserConfigProtocolVersion: 1,
      runId: 'run-1',
      browserConfigId: 'browser-config-1',
      browserConfigGeneration: 2,
      decoderMode: 'software',
      decoderAcceleration: 'prefer-software',
      requestedAtMs: 90,
    }
    expect(
      parseLiveTextMessage(
        JSON.stringify({ ...base, browserConfigGeneration: 0 }),
      ),
    ).toBeNull()
    expect(
      parseLiveTextMessage(
        JSON.stringify({ ...base, decoderMode: 'gpu' }),
      ),
    ).toBeNull()
  })

  it('defaults omitted legacy tuning fields and rejects explicit unknown values', () => {
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-request',
          runId: 'legacy-run',
          durationMs: 5_000,
          requestedAtMs: 100,
        }),
      ),
    ).toMatchObject({ encoderTuning: 'default' })
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-status',
          runId: 'legacy-run',
          phase: 'started',
          timestampMs: 100,
          durationMs: 5_000,
        }),
      ),
    ).toBeNull()
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-status',
          runId: 'legacy-run',
          phase: 'cancelled',
          timestampMs: 100,
          durationMs: 5_000,
        }),
      ),
    ).toMatchObject({
      benchmarkProtocolVersion: null,
      producerSessionId: null,
      captureSource: null,
      encoderTuning: 'default',
      encoderTuningActive: null,
    })
    expect(
      parseLiveTextMessage(
        JSON.stringify({
          type: 'benchmark-request',
          runId: 'bad-run',
          durationMs: 5_000,
          requestedAtMs: 100,
          encoderTuning: 'turbo',
        }),
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
