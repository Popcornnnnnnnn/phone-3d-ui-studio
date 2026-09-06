import { describe, expect, it } from 'vitest'

import {
  hasLiveFrameEnvelopeMagic,
  parseLiveFrameEnvelope,
} from './liveFrameEnvelope'

const encoder = new TextEncoder()

function frameMetadata(overrides: Record<string, unknown> = {}) {
  return {
    type: 'frame-meta',
    frameId: 17,
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
    isKeyframe: true,
    decoderCodec: 'avc1.64002A',
    h264BitstreamFormat: 'annex-b',
    decoderDescriptionBase64: null,
    captureTimestampSource: 'replaykit-presentation-timestamp',
    captureTimestampValid: true,
    captureSampleAgeMs: 1.5,
    captureShortEdgeActive: 960,
    captureWidthActive: 960,
    captureHeightActive: 2_088,
    captureStreamGeneration: 8,
    conversionStartedAtMs: 101,
    conversionEndedAtMs: 102,
    clockOffsetMs: 1.5,
    clockRttMs: 3,
    metadataReceivedAtMs: 104,
    bridgeReceivedAtMs: 105,
    bridgeRelayedAtMs: 106,
    payloadBytes: 4,
    ...overrides,
  }
}

function envelope(
  metadata: Record<string, unknown>,
  payload = new Uint8Array([1, 2, 3, 4]),
) {
  const metadataBytes = encoder.encode(JSON.stringify(metadata))
  const bytes = new Uint8Array(8 + metadataBytes.byteLength + payload.byteLength)
  bytes.set(encoder.encode('P3D1'), 0)
  new DataView(bytes.buffer).setUint32(4, metadataBytes.byteLength, false)
  bytes.set(metadataBytes, 8)
  bytes.set(payload, 8 + metadataBytes.byteLength)
  return bytes
}

describe('live frame envelope', () => {
  it('parses metadata and exposes the payload without another frame-sized copy', () => {
    const bytes = envelope(frameMetadata())
    const parsed = parseLiveFrameEnvelope(bytes.buffer)

    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error('expected a valid frame envelope')
    expect(parsed.metadata).toMatchObject({
      type: 'frame-meta',
      frameId: 17,
      codec: 'h264',
      isKeyframe: true,
      decoderCodec: 'avc1.64002a',
      h264BitstreamFormat: 'annex-b',
      decoderDescriptionBase64: null,
      captureTimestampSource: 'replaykit-presentation-timestamp',
      captureTimestampValid: true,
      captureSampleAgeMs: 1.5,
      captureShortEdgeActive: 960,
      captureWidthActive: 960,
      captureHeightActive: 2_088,
      captureStreamGeneration: 8,
      payloadBytes: 4,
    })
    expect([...parsed.payload]).toEqual([1, 2, 3, 4])
    expect(parsed.payload.buffer).toBe(bytes.buffer)
  })

  it('preserves a signed future-tolerated ReplayKit sample age', () => {
    const parsed = parseLiveFrameEnvelope(
      envelope(
        frameMetadata({
          captureTimestampSource:
            'replaykit-presentation-timestamp-future-tolerated',
          captureSampleAgeMs: -8.5,
        }),
      ).buffer,
    )

    expect(parsed?.metadata).toMatchObject({
      captureTimestampSource:
        'replaykit-presentation-timestamp-future-tolerated',
      captureTimestampValid: true,
      captureSampleAgeMs: -8.5,
    })
  })

  it('accepts explicit ScreenCaptureKit display-time and PTS sources', () => {
    for (const captureTimestampSource of [
      'screencapturekit-display-time',
      'screencapturekit-presentation-timestamp',
    ]) {
      const parsed = parseLiveFrameEnvelope(
        envelope(frameMetadata({ captureTimestampSource })).buffer,
      )
      expect(parsed?.metadata.captureTimestampSource).toBe(
        captureTimestampSource,
      )
      expect(parsed?.metadata.captureTimestampValid).toBe(true)
    }
  })

  it('rejects an unrecognized capture timestamp source', () => {
    const parsed = parseLiveFrameEnvelope(
      envelope(frameMetadata({ captureTimestampSource: 'sck-guessed-time' }))
        .buffer,
    )

    expect(parsed).toBeNull()
  })

  it('rejects timestamp combinations that falsely claim capture validity', () => {
    const callbackClaim = parseLiveFrameEnvelope(
      envelope(
        frameMetadata({
          captureTimestampSource: 'callback-fallback',
          captureTimestampValid: true,
        }),
      ).buffer,
    )
    const futureSckClaim = parseLiveFrameEnvelope(
      envelope(
        frameMetadata({
          captureTimestampSource: 'screencapturekit-display-time',
          captureTimestampValid: true,
          captureSampleAgeMs: -0.1,
        }),
      ).buffer,
    )

    expect(callbackClaim).toBeNull()
    expect(futureSckClaim).toBeNull()
  })

  it('preserves callback fallback only as an invalid capture timestamp', () => {
    const parsed = parseLiveFrameEnvelope(
      envelope(
        frameMetadata({
          captureTimestampSource: 'callback-fallback',
          captureTimestampValid: false,
          captureSampleAgeMs: null,
        }),
      ).buffer,
    )

    expect(parsed?.metadata).toMatchObject({
      captureTimestampSource: 'callback-fallback',
      captureTimestampValid: false,
      captureSampleAgeMs: null,
    })
  })

  it('rejects the wrong magic and a truncated metadata section', () => {
    const wrongMagic = envelope(frameMetadata())
    wrongMagic[0] = 0
    expect(parseLiveFrameEnvelope(wrongMagic.buffer)).toBeNull()

    const truncated = envelope(frameMetadata())
    new DataView(truncated.buffer).setUint32(4, truncated.byteLength, false)
    expect(parseLiveFrameEnvelope(truncated.buffer)).toBeNull()
  })

  it('rejects malformed UTF-8, JSON, and non-frame metadata', () => {
    const invalidUtf8 = new Uint8Array([0x50, 0x33, 0x44, 0x31, 0, 0, 0, 1, 0xff, 1])
    expect(parseLiveFrameEnvelope(invalidUtf8.buffer)).toBeNull()

    const invalidJson = envelope({ type: 'pose', timestampMs: 1 })
    expect(parseLiveFrameEnvelope(invalidJson.buffer)).toBeNull()

    const invalidCodec = envelope(frameMetadata({ codec: 'vp9' }))
    expect(parseLiveFrameEnvelope(invalidCodec.buffer)).toBeNull()

    const missingFrameId = frameMetadata()
    Reflect.deleteProperty(missingFrameId, 'frameId')
    expect(parseLiveFrameEnvelope(envelope(missingFrameId).buffer)).toBeNull()
  })

  it('rejects metadata whose declared payload size is inconsistent', () => {
    const bytes = envelope(frameMetadata({ payloadBytes: 99 }))
    expect(hasLiveFrameEnvelopeMagic(bytes.buffer)).toBe(true)
    expect(parseLiveFrameEnvelope(bytes.buffer)).toBeNull()
  })

  it('distinguishes malformed atomic envelopes from legacy binary payloads', () => {
    expect(hasLiveFrameEnvelopeMagic(new Uint8Array([0, 0, 0, 1]).buffer)).toBe(
      false,
    )
    expect(
      hasLiveFrameEnvelopeMagic(
        new Uint8Array([0x50, 0x33, 0x44, 0x31, 0, 0, 0, 0]).buffer,
      ),
    ).toBe(true)
  })

  it('rejects an envelope with no encoded frame payload', () => {
    const bytes = envelope(
      frameMetadata({ jpegBytes: 0, payloadBytes: 0 }),
      new Uint8Array(),
    )
    expect(parseLiveFrameEnvelope(bytes.buffer)).toBeNull()
  })

  it('accepts AVCC only when its keyframe carries a valid decoder description', () => {
    const avcC = 'AWQAKv/hAARnZAAqAQACaAD9+PgA'
    const valid = envelope(
      frameMetadata({
        h264BitstreamFormat: 'avcc',
        decoderDescriptionBase64: avcC,
      }),
    )
    expect(parseLiveFrameEnvelope(valid.buffer)?.metadata).toMatchObject({
      h264BitstreamFormat: 'avcc',
      decoderDescriptionBase64: avcC,
    })

    const missingDescription = envelope(
      frameMetadata({
        h264BitstreamFormat: 'avcc',
        decoderDescriptionBase64: null,
      }),
    )
    expect(parseLiveFrameEnvelope(missingDescription.buffer)).toBeNull()

    const malformedDescription = envelope(
      frameMetadata({
        h264BitstreamFormat: 'avcc',
        decoderDescriptionBase64: 'not base64',
      }),
    )
    expect(parseLiveFrameEnvelope(malformedDescription.buffer)).toBeNull()
  })
})
