import type {
  CaptureSource,
  CaptureTimestampSource,
  FrameMetadataMessage,
} from './liveProtocol'

const MAGIC_BYTES = [0x50, 0x33, 0x44, 0x31] as const // ASCII P3D1
const HEADER_BYTES = 8
const MAX_METADATA_BYTES = 64 * 1024
const MAX_DECODER_DESCRIPTION_BASE64_BYTES = 16 * 1024
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface LiveFrameEnvelope {
  metadata: FrameMetadataMessage
  // This is a zero-copy view into the received WebSocket ArrayBuffer.
  payload: Uint8Array<ArrayBuffer>
}

export function hasLiveFrameEnvelopeMagic(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  return MAGIC_BYTES.every((value, index) => bytes[index] === value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || value === null || isFiniteNumber(value)
}

function optionalSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null
}

function isOptionalDecoderDescription(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_DECODER_DESCRIPTION_BASE64_BYTES &&
      value.length % 4 === 0 &&
      base64Pattern.test(value))
  )
}

function parseCaptureTimestampSource(
  value: unknown,
): CaptureTimestampSource | null {
  return value === 'replaykit-presentation-timestamp' ||
    value === 'replaykit-presentation-timestamp-future-tolerated' ||
    value === 'screencapturekit-display-time' ||
    value === 'screencapturekit-presentation-timestamp' ||
    value === 'callback-fallback'
    ? value
    : null
}

function parseCaptureSource(value: unknown): CaptureSource | null {
  return value === 'screencapturekit-host' ||
    value === 'replaykit-broadcast-upload'
    ? value
    : null
}

function captureTimestampMeasurementIsValid(
  source: CaptureTimestampSource | null,
  reportedValid: unknown,
  sampleAgeMs: number | null,
) {
  if (reportedValid !== true || sampleAgeMs === null) return false
  if (source === 'replaykit-presentation-timestamp-future-tolerated') {
    return sampleAgeMs >= -50 && sampleAgeMs < 0
  }
  if (
    source === 'replaykit-presentation-timestamp' ||
    source === 'screencapturekit-display-time' ||
    source === 'screencapturekit-presentation-timestamp'
  ) {
    return sampleAgeMs >= 0 && sampleAgeMs <= 1_000
  }
  return false
}

function parseFrameMetadata(
  text: string,
  payloadBytes: number,
): FrameMetadataMessage | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const metadata = value as Record<string, unknown>
  const codec = metadata.codec
  const decoderCodec =
    typeof metadata.decoderCodec === 'string' &&
    /^avc1\.[0-9a-fA-F]{6}$/.test(metadata.decoderCodec)
      ? metadata.decoderCodec.toLowerCase()
      : null
  const h264BitstreamFormat =
    metadata.h264BitstreamFormat === 'annex-b' ||
    metadata.h264BitstreamFormat === 'avcc'
      ? metadata.h264BitstreamFormat
      : null
  const captureTimestampSource = parseCaptureTimestampSource(
    metadata.captureTimestampSource,
  )
  const captureSampleAgeMs = isFiniteNumber(metadata.captureSampleAgeMs)
    ? metadata.captureSampleAgeMs
    : null
  const captureTimestampValid = captureTimestampMeasurementIsValid(
    captureTimestampSource,
    metadata.captureTimestampValid,
    captureSampleAgeMs,
  )

  if (
    metadata.type !== 'frame-meta' ||
    !Number.isSafeInteger(metadata.frameId) ||
    !isFiniteNumber(metadata.timestampMs) ||
    !isFiniteNumber(metadata.captureAtMs) ||
    !isFiniteNumber(metadata.callbackAtMs) ||
    !isFiniteNumber(metadata.encodeStartedAtMs) ||
    !isFiniteNumber(metadata.encodedAtMs) ||
    !Number.isSafeInteger(metadata.width) ||
    (metadata.width as number) <= 0 ||
    !Number.isSafeInteger(metadata.height) ||
    (metadata.height as number) <= 0 ||
    (metadata.orientation !== 'portrait' &&
      metadata.orientation !== 'landscape') ||
    !Number.isSafeInteger(metadata.jpegBytes) ||
    (metadata.jpegBytes as number) < 0 ||
    (codec !== 'jpeg' && codec !== 'h264') ||
    (codec === 'h264' && typeof metadata.isKeyframe !== 'boolean') ||
    (metadata.h264BitstreamFormat !== undefined &&
      metadata.h264BitstreamFormat !== null &&
      h264BitstreamFormat === null) ||
    !isOptionalDecoderDescription(metadata.decoderDescriptionBase64) ||
    (codec === 'h264' &&
      h264BitstreamFormat === 'avcc' &&
      metadata.isKeyframe === true &&
      typeof metadata.decoderDescriptionBase64 !== 'string') ||
    !isOptionalFiniteNumber(metadata.clockOffsetMs) ||
    !isOptionalFiniteNumber(metadata.clockRttMs) ||
    (metadata.captureTimestampSource !== undefined &&
      metadata.captureTimestampSource !== null &&
      metadata.captureTimestampSource !== 'replaykit-presentation-timestamp' &&
      metadata.captureTimestampSource !==
        'replaykit-presentation-timestamp-future-tolerated' &&
      metadata.captureTimestampSource !== 'screencapturekit-display-time' &&
      metadata.captureTimestampSource !==
        'screencapturekit-presentation-timestamp' &&
      metadata.captureTimestampSource !== 'callback-fallback') ||
    (metadata.captureTimestampValid !== undefined &&
      metadata.captureTimestampValid !== null &&
      typeof metadata.captureTimestampValid !== 'boolean') ||
    (metadata.captureTimestampValid === true && !captureTimestampValid) ||
    !isOptionalFiniteNumber(metadata.captureSampleAgeMs) ||
    !isOptionalFiniteNumber(metadata.conversionStartedAtMs) ||
    !isOptionalFiniteNumber(metadata.conversionEndedAtMs) ||
    !isFiniteNumber(metadata.metadataReceivedAtMs) ||
    !isFiniteNumber(metadata.bridgeReceivedAtMs) ||
    !isFiniteNumber(metadata.bridgeRelayedAtMs) ||
    !Number.isSafeInteger(metadata.payloadBytes) ||
    metadata.payloadBytes !== payloadBytes
  ) {
    return null
  }

  return {
    type: 'frame-meta',
    producerSessionId:
      typeof metadata.producerSessionId === 'string' &&
      metadata.producerSessionId.trim().length > 0
        ? metadata.producerSessionId
        : null,
    captureSource: parseCaptureSource(metadata.captureSource),
    frameId: metadata.frameId as number,
    timestampMs: metadata.timestampMs,
    captureAtMs: metadata.captureAtMs,
    callbackAtMs: metadata.callbackAtMs,
    encodeStartedAtMs: metadata.encodeStartedAtMs,
    encodedAtMs: metadata.encodedAtMs,
    width: metadata.width as number,
    height: metadata.height as number,
    orientation: metadata.orientation,
    jpegBytes: metadata.jpegBytes as number,
    codec,
    isKeyframe:
      typeof metadata.isKeyframe === 'boolean' ? metadata.isKeyframe : null,
    decoderCodec,
    h264BitstreamFormat,
    decoderDescriptionBase64:
      typeof metadata.decoderDescriptionBase64 === 'string'
        ? metadata.decoderDescriptionBase64
        : null,
    captureTimestampSource,
    captureTimestampValid,
    captureSampleAgeMs,
    captureContentStatus:
      typeof metadata.captureContentStatus === 'string' &&
      metadata.captureContentStatus.length > 0
        ? metadata.captureContentStatus
        : null,
    freshContent:
      typeof metadata.freshContent === 'boolean'
        ? metadata.freshContent
        : null,
    captureShortEdgeActive: optionalSafeInteger(
      metadata.captureShortEdgeActive,
    ),
    captureWidthActive: optionalSafeInteger(metadata.captureWidthActive),
    captureHeightActive: optionalSafeInteger(metadata.captureHeightActive),
    captureStreamGeneration: optionalSafeInteger(
      metadata.captureStreamGeneration,
    ),
    conversionStartedAtMs: isFiniteNumber(metadata.conversionStartedAtMs)
      ? metadata.conversionStartedAtMs
      : null,
    conversionEndedAtMs: isFiniteNumber(metadata.conversionEndedAtMs)
      ? metadata.conversionEndedAtMs
      : null,
    clockOffsetMs:
      isFiniteNumber(metadata.clockOffsetMs) ? metadata.clockOffsetMs : null,
    clockRttMs: isFiniteNumber(metadata.clockRttMs) ? metadata.clockRttMs : null,
    metadataReceivedAtMs: metadata.metadataReceivedAtMs,
    bridgeReceivedAtMs: metadata.bridgeReceivedAtMs,
    bridgeRelayedAtMs: metadata.bridgeRelayedAtMs,
    payloadBytes: metadata.payloadBytes as number,
  }
}

export function parseLiveFrameEnvelope(
  buffer: ArrayBuffer,
): LiveFrameEnvelope | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength < HEADER_BYTES) return null
  if (!hasLiveFrameEnvelopeMagic(buffer)) return null

  const metadataLength = new DataView(buffer).getUint32(4, false)
  if (metadataLength === 0 || metadataLength > MAX_METADATA_BYTES) return null
  const payloadOffset = HEADER_BYTES + metadataLength
  if (payloadOffset >= bytes.byteLength) return null

  let metadataText: string
  try {
    metadataText = utf8Decoder.decode(bytes.subarray(HEADER_BYTES, payloadOffset))
  } catch {
    return null
  }

  const payload = bytes.subarray(payloadOffset)
  const metadata = parseFrameMetadata(metadataText, payload.byteLength)
  if (!metadata) return null

  return { metadata, payload }
}
