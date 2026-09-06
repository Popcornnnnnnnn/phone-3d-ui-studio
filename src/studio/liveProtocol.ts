export type QuaternionTuple = readonly [
  x: number,
  y: number,
  z: number,
  w: number,
]

export type Vector3Tuple = readonly [x: number, y: number, z: number]

export type H264BitstreamFormat = 'annex-b' | 'avcc'
export type BrowserDecoderMode = 'software' | 'auto' | 'hardware'
export type BrowserDecoderAcceleration =
  | 'prefer-software'
  | 'no-preference'
  | 'prefer-hardware'
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical'

export type EncoderTuning =
  | 'default'
  | 'speed-priority'
  | 'high-speed-preset'
  | 'video-conferencing-preset'

export type CaptureSource =
  | 'screencapturekit-host'
  | 'replaykit-broadcast-upload'

export type CaptureTimestampSource =
  | 'replaykit-presentation-timestamp'
  | 'replaykit-presentation-timestamp-future-tolerated'
  | 'screencapturekit-display-time'
  | 'screencapturekit-presentation-timestamp'
  | 'callback-fallback'

export interface BridgeStatusMessage {
  type: 'bridge-status'
  browsers: number
  phones: number
  webrtcBrowsers: number
  webrtcPhones: number
}

export interface FrameMetadataMessage {
  type: 'frame-meta'
  producerSessionId: string | null
  captureSource: CaptureSource | null
  frameId: number
  timestampMs: number
  captureAtMs: number
  callbackAtMs: number
  encodeStartedAtMs: number
  encodedAtMs: number
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  jpegBytes: number
  codec: 'jpeg' | 'h264'
  isKeyframe: boolean | null
  decoderCodec: string | null
  h264BitstreamFormat: H264BitstreamFormat | null
  decoderDescriptionBase64: string | null
  captureTimestampSource: CaptureTimestampSource | null
  captureTimestampValid: boolean | null
  captureSampleAgeMs: number | null
  captureContentStatus: string | null
  freshContent: boolean | null
  captureShortEdgeActive: number | null
  captureWidthActive: number | null
  captureHeightActive: number | null
  captureStreamGeneration: number | null
  conversionStartedAtMs: number | null
  conversionEndedAtMs: number | null
  clockOffsetMs: number | null
  clockRttMs: number | null
  metadataReceivedAtMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
  payloadBytes: number | null
}

export interface LivePoseMessage {
  type: 'pose'
  producerSessionId: string | null
  captureSource: CaptureSource | null
  timestampMs: number
  quaternion: QuaternionTuple
  rotationRate: Vector3Tuple | null
  requestedHz: number | null
  sampleIntervalMs: number | null
  clockOffsetMs: number | null
  clockRttMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
}

export type CaptureState =
  | 'idle'
  | 'choosing'
  | 'starting'
  | 'streaming'
  | 'paused'
  | 'failed'

export interface EncoderStatusMessage {
  type: 'encoder-status'
  producerSessionId: string | null
  captureSource: CaptureSource | null
  timestampMs: number
  captureState: CaptureState
  codec: 'jpeg' | 'h264' | 'webrtc' | null
  captured: number
  submitted: number
  encoded: number
  accepted: number
  rejected: number
  targetFps: number | null
  encoderProfile: 'legacy' | 'low-latency' | null
  encoderTuningRequested: EncoderTuning
  encoderTuningActive: EncoderTuning | null
  encoderTuningPresetQueryStatus: number | null
  encoderTuningPresetApplyStatus: number | null
  encoderTuningFallbackReason: string | null
  captureContentStatus: string | null
  freshContent: boolean | null
  captureShortEdgeRequested: number | null
  captureShortEdgeActive: number | null
  captureWidthActive: number | null
  captureHeightActive: number | null
  captureStreamGeneration: number | null
  thermalState: ThermalState | null
  frameAckWindow: 1 | 2 | 3 | null
}

export interface BenchmarkRequestMessage {
  type: 'benchmark-request'
  runId: string
  durationMs: number
  requestedAtMs: number
  targetFps: number | null
  encoderProfile: 'legacy' | 'low-latency' | null
  encoderTuning: EncoderTuning
  warmupMs: number | null
  captureShortEdge: number | null
}

export interface BenchmarkStatusMessage {
  type: 'benchmark-status'
  benchmarkProtocolVersion: number | null
  producerSessionId: string | null
  captureSource: CaptureSource | null
  runId: string
  phase: 'started' | 'completed' | 'cancelled'
  timestampMs: number
  durationMs: number
  targetFps: number | null
  encoderProfile: 'legacy' | 'low-latency' | null
  encoderProfileActive: 'legacy' | 'low-latency' | null
  encoderTuning: EncoderTuning
  encoderTuningActive: EncoderTuning | null
  captureShortEdgeRequested: number | null
  captureShortEdgeActive: number | null
  captureWidthActive: number | null
  captureHeightActive: number | null
  captureStreamGeneration: number | null
  thermalState: ThermalState | null
}

export interface BrowserBenchmarkPrepareMessage {
  type: 'browser-benchmark-prepare'
  browserConfigProtocolVersion: 1
  runId: string
  browserConfigId: string
  browserConfigGeneration: number
  decoderMode: BrowserDecoderMode
  decoderAcceleration: BrowserDecoderAcceleration
  requestedAtMs: number
}

export type LiveTextMessage =
  | BridgeStatusMessage
  | FrameMetadataMessage
  | LivePoseMessage
  | EncoderStatusMessage
  | BenchmarkRequestMessage
  | BenchmarkStatusMessage
  | BrowserBenchmarkPrepareMessage

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFiniteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null
}

function optionalSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null
}

function thermalStateOrNull(value: unknown): ThermalState | null {
  return value === 'nominal' ||
    value === 'fair' ||
    value === 'serious' ||
    value === 'critical'
    ? value
    : null
}

function isEncoderTuning(value: unknown): value is EncoderTuning {
  return (
    value === 'default' ||
    value === 'speed-priority' ||
    value === 'high-speed-preset' ||
    value === 'video-conferencing-preset'
  )
}

function encoderTuningOrLegacyDefault(value: unknown): EncoderTuning | null {
  if (value === undefined || value === null) return 'default'
  return isEncoderTuning(value) ? value : null
}

function captureSourceOrNull(value: unknown): CaptureSource | null {
  return value === 'screencapturekit-host' ||
    value === 'replaykit-broadcast-upload'
    ? value
    : null
}

function producerSessionIdOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : null
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

export function parseLiveTextMessage(value: string): LiveTextMessage | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null
  const message = parsed as Record<string, unknown>

  if (
    message.type === 'bridge-status' &&
    isFiniteNumber(message.browsers) &&
    isFiniteNumber(message.phones)
  ) {
    return {
      type: 'bridge-status',
      browsers: message.browsers,
      phones: message.phones,
      webrtcBrowsers: optionalFiniteNumber(message.webrtcBrowsers) ?? 0,
      webrtcPhones: optionalFiniteNumber(message.webrtcPhones) ?? 0,
    }
  }

  if (
    message.type === 'frame-meta' &&
    isFiniteNumber(message.timestampMs) &&
    isFiniteNumber(message.width) &&
    isFiniteNumber(message.height) &&
    (message.orientation === 'portrait' || message.orientation === 'landscape')
  ) {
    const captureTimestampSource = parseCaptureTimestampSource(
      message.captureTimestampSource,
    )
    const captureSampleAgeMs = optionalFiniteNumber(message.captureSampleAgeMs)
    return {
      type: 'frame-meta',
      producerSessionId: producerSessionIdOrNull(message.producerSessionId),
      captureSource: captureSourceOrNull(message.captureSource),
      frameId: optionalFiniteNumber(message.frameId) ?? message.timestampMs,
      timestampMs: message.timestampMs,
      captureAtMs: optionalFiniteNumber(message.captureAtMs) ?? message.timestampMs,
      callbackAtMs: optionalFiniteNumber(message.callbackAtMs) ?? message.timestampMs,
      encodeStartedAtMs:
        optionalFiniteNumber(message.encodeStartedAtMs) ?? message.timestampMs,
      encodedAtMs: optionalFiniteNumber(message.encodedAtMs) ?? message.timestampMs,
      width: message.width,
      height: message.height,
      orientation: message.orientation,
      jpegBytes: optionalFiniteNumber(message.jpegBytes) ?? 0,
      codec: message.codec === 'h264' ? 'h264' : 'jpeg',
      isKeyframe:
        typeof message.isKeyframe === 'boolean' ? message.isKeyframe : null,
      decoderCodec:
        typeof message.decoderCodec === 'string' &&
        /^avc1\.[0-9a-fA-F]{6}$/.test(message.decoderCodec)
          ? message.decoderCodec.toLowerCase()
          : null,
      h264BitstreamFormat:
        message.h264BitstreamFormat === 'annex-b' ||
        message.h264BitstreamFormat === 'avcc'
          ? message.h264BitstreamFormat
          : null,
      decoderDescriptionBase64:
        typeof message.decoderDescriptionBase64 === 'string'
          ? message.decoderDescriptionBase64
          : null,
      captureTimestampSource,
      captureTimestampValid: captureTimestampMeasurementIsValid(
        captureTimestampSource,
        message.captureTimestampValid,
        captureSampleAgeMs,
      ),
      captureSampleAgeMs,
      captureContentStatus:
        typeof message.captureContentStatus === 'string' &&
        message.captureContentStatus.length > 0
          ? message.captureContentStatus
          : null,
      freshContent:
        typeof message.freshContent === 'boolean'
          ? message.freshContent
          : null,
      captureShortEdgeActive: optionalSafeInteger(
        message.captureShortEdgeActive,
      ),
      captureWidthActive: optionalSafeInteger(message.captureWidthActive),
      captureHeightActive: optionalSafeInteger(message.captureHeightActive),
      captureStreamGeneration: optionalSafeInteger(
        message.captureStreamGeneration,
      ),
      conversionStartedAtMs: optionalFiniteNumber(message.conversionStartedAtMs),
      conversionEndedAtMs: optionalFiniteNumber(message.conversionEndedAtMs),
      clockOffsetMs: optionalFiniteNumber(message.clockOffsetMs),
      clockRttMs: optionalFiniteNumber(message.clockRttMs),
      metadataReceivedAtMs: optionalFiniteNumber(message.metadataReceivedAtMs),
      bridgeReceivedAtMs: optionalFiniteNumber(message.bridgeReceivedAtMs),
      bridgeRelayedAtMs: optionalFiniteNumber(message.bridgeRelayedAtMs),
      payloadBytes: optionalFiniteNumber(message.payloadBytes),
    }
  }

  if (
    message.type === 'pose' &&
    isFiniteNumber(message.timestampMs) &&
    Array.isArray(message.quaternion) &&
    message.quaternion.length === 4 &&
    message.quaternion.every(isFiniteNumber)
  ) {
    const rotationRate =
      Array.isArray(message.rotationRate) &&
      message.rotationRate.length === 3 &&
      message.rotationRate.every(isFiniteNumber)
        ? (message.rotationRate as unknown as Vector3Tuple)
        : null
    return {
      type: 'pose',
      producerSessionId: producerSessionIdOrNull(message.producerSessionId),
      captureSource: captureSourceOrNull(message.captureSource),
      timestampMs: message.timestampMs,
      quaternion: message.quaternion as unknown as QuaternionTuple,
      rotationRate,
      requestedHz: optionalFiniteNumber(message.requestedHz),
      sampleIntervalMs: optionalFiniteNumber(message.sampleIntervalMs),
      clockOffsetMs: optionalFiniteNumber(message.clockOffsetMs),
      clockRttMs: optionalFiniteNumber(message.clockRttMs),
      bridgeReceivedAtMs: optionalFiniteNumber(message.bridgeReceivedAtMs),
      bridgeRelayedAtMs: optionalFiniteNumber(message.bridgeRelayedAtMs),
    }
  }

  if (
    message.type === 'encoder-status' &&
    isFiniteNumber(message.timestampMs)
  ) {
    const captureState =
      message.captureState === 'idle' ||
      message.captureState === 'choosing' ||
      message.captureState === 'starting' ||
      message.captureState === 'streaming' ||
      message.captureState === 'paused' ||
      message.captureState === 'failed'
        ? message.captureState
        : 'idle'
    const codec =
      message.codec === 'H.264'
        ? 'h264'
        : message.codec === 'JPEG'
          ? 'jpeg'
          : message.codec === 'WebRTC'
            ? 'webrtc'
            : null
    const encoderTuningRequested = encoderTuningOrLegacyDefault(
      message.encoderTuningRequested,
    )
    const encoderTuningActive =
      message.encoderTuningActive === undefined ||
      message.encoderTuningActive === null
        ? message.encoderTuningRequested === undefined
          ? 'default'
          : null
        : encoderTuningOrLegacyDefault(message.encoderTuningActive)
    if (
      encoderTuningRequested === null ||
      (message.encoderTuningActive !== null &&
        message.encoderTuningActive !== undefined &&
        encoderTuningActive === null)
    ) {
      return null
    }

    return {
      type: 'encoder-status',
      producerSessionId: producerSessionIdOrNull(message.producerSessionId),
      captureSource: captureSourceOrNull(message.captureSource),
      timestampMs: message.timestampMs,
      captureState,
      codec,
      captured: optionalFiniteNumber(message.captured) ?? 0,
      submitted: optionalFiniteNumber(message.submitted) ?? 0,
      encoded: optionalFiniteNumber(message.encoded) ?? 0,
      accepted: optionalFiniteNumber(message.accepted) ?? 0,
      rejected: optionalFiniteNumber(message.rejected) ?? 0,
      targetFps: optionalFiniteNumber(message.targetFps),
      encoderProfile:
        message.encoderProfileActive === 'legacy' ||
        message.encoderProfileActive === 'low-latency'
          ? message.encoderProfileActive
          : message.encoderProfileSelected === 'legacy' ||
              message.encoderProfileSelected === 'low-latency'
            ? message.encoderProfileSelected
            : null,
      encoderTuningRequested,
      encoderTuningActive,
      encoderTuningPresetQueryStatus: optionalFiniteNumber(
        message.encoderTuningPresetQueryStatus,
      ),
      encoderTuningPresetApplyStatus: optionalFiniteNumber(
        message.encoderTuningPresetApplyStatus,
      ),
      encoderTuningFallbackReason:
        typeof message.encoderTuningFallbackReason === 'string'
          ? message.encoderTuningFallbackReason
          : null,
      captureContentStatus:
        typeof message.captureContentStatus === 'string' &&
        message.captureContentStatus.length > 0
          ? message.captureContentStatus
          : null,
      freshContent:
        typeof message.freshContent === 'boolean'
          ? message.freshContent
          : null,
      captureShortEdgeRequested: optionalSafeInteger(
        message.captureShortEdgeRequested,
      ),
      captureShortEdgeActive: optionalSafeInteger(
        message.captureShortEdgeActive,
      ),
      captureWidthActive: optionalSafeInteger(message.captureWidthActive),
      captureHeightActive: optionalSafeInteger(message.captureHeightActive),
      captureStreamGeneration: optionalSafeInteger(
        message.captureStreamGeneration,
      ),
      thermalState: thermalStateOrNull(message.thermalState),
      frameAckWindow:
        message.frameAckWindow === 1 || message.frameAckWindow === 2 ||
        message.frameAckWindow === 3 ? message.frameAckWindow : null,
    }
  }

  if (
    message.type === 'browser-benchmark-prepare' &&
    message.browserConfigProtocolVersion === 1 &&
    typeof message.runId === 'string' &&
    message.runId.length > 0 &&
    typeof message.browserConfigId === 'string' &&
    message.browserConfigId.length > 0 &&
    typeof message.browserConfigGeneration === 'number' &&
    Number.isSafeInteger(message.browserConfigGeneration) &&
    message.browserConfigGeneration > 0 &&
    (message.decoderMode === 'software' ||
      message.decoderMode === 'auto' ||
      message.decoderMode === 'hardware') &&
    (message.decoderAcceleration === 'prefer-software' ||
      message.decoderAcceleration === 'no-preference' ||
      message.decoderAcceleration === 'prefer-hardware') &&
    isFiniteNumber(message.requestedAtMs)
  ) {
    return {
      type: 'browser-benchmark-prepare',
      browserConfigProtocolVersion: 1,
      runId: message.runId,
      browserConfigId: message.browserConfigId,
      browserConfigGeneration: message.browserConfigGeneration,
      decoderMode: message.decoderMode,
      decoderAcceleration: message.decoderAcceleration,
      requestedAtMs: message.requestedAtMs,
    }
  }

  if (
    message.type === 'benchmark-request' &&
    typeof message.runId === 'string' &&
    message.runId.length > 0 &&
    isFiniteNumber(message.durationMs) &&
    message.durationMs > 0 &&
    isFiniteNumber(message.requestedAtMs)
  ) {
    const encoderTuning = encoderTuningOrLegacyDefault(message.encoderTuning)
    if (encoderTuning === null) return null
    return {
      type: 'benchmark-request',
      runId: message.runId,
      durationMs: message.durationMs,
      requestedAtMs: message.requestedAtMs,
      targetFps: optionalFiniteNumber(message.targetFps),
      encoderProfile:
        message.encoderProfile === 'legacy' ||
        message.encoderProfile === 'low-latency'
          ? message.encoderProfile
          : null,
      encoderTuning,
      warmupMs: optionalFiniteNumber(message.warmupMs),
      captureShortEdge: optionalSafeInteger(message.captureShortEdge),
    }
  }

  if (
    message.type === 'benchmark-status' &&
    typeof message.runId === 'string' &&
    message.runId.length > 0 &&
    (message.phase === 'started' ||
      message.phase === 'completed' ||
      message.phase === 'cancelled') &&
    isFiniteNumber(message.timestampMs) &&
    isFiniteNumber(message.durationMs)
  ) {
    const encoderTuning = encoderTuningOrLegacyDefault(message.encoderTuning)
    const encoderTuningActive =
      message.encoderTuningActive === undefined ||
      message.encoderTuningActive === null
        ? null
        : encoderTuningOrLegacyDefault(message.encoderTuningActive)
    const encoderProfileActive =
      message.encoderProfileActive === 'legacy' ||
      message.encoderProfileActive === 'low-latency'
        ? message.encoderProfileActive
        : null
    const benchmarkProtocolVersion = optionalFiniteNumber(
      message.benchmarkProtocolVersion,
    )
    const producerSessionId = producerSessionIdOrNull(
      message.producerSessionId,
    )
    const captureSource = captureSourceOrNull(message.captureSource)
    const requiresVerifiedConfiguration =
      message.phase === 'started' || message.phase === 'completed'
    if (
      encoderTuning === null ||
      (message.encoderTuningActive !== undefined &&
        message.encoderTuningActive !== null &&
        encoderTuningActive === null) ||
      (requiresVerifiedConfiguration &&
        (benchmarkProtocolVersion !== 2 ||
          encoderProfileActive === null ||
          encoderTuningActive === null ||
          producerSessionId === null ||
          captureSource === null))
    ) {
      return null
    }
    return {
      type: 'benchmark-status',
      benchmarkProtocolVersion,
      producerSessionId,
      captureSource,
      runId: message.runId,
      phase: message.phase,
      timestampMs: message.timestampMs,
      durationMs: message.durationMs,
      targetFps: optionalFiniteNumber(message.targetFps),
      encoderProfile:
        message.encoderProfile === 'legacy' ||
        message.encoderProfile === 'low-latency'
          ? message.encoderProfile
          : null,
      encoderProfileActive,
      encoderTuning,
      encoderTuningActive,
      captureShortEdgeRequested: optionalSafeInteger(
        message.captureShortEdgeRequested,
      ),
      captureShortEdgeActive: optionalSafeInteger(
        message.captureShortEdgeActive,
      ),
      captureWidthActive: optionalSafeInteger(message.captureWidthActive),
      captureHeightActive: optionalSafeInteger(message.captureHeightActive),
      captureStreamGeneration: optionalSafeInteger(
        message.captureStreamGeneration,
      ),
      thermalState: thermalStateOrNull(message.thermalState),
    }
  }

  return null
}

export function normalizeQuaternion(value: QuaternionTuple): QuaternionTuple {
  const length = Math.hypot(...value)
  if (length === 0) return [0, 0, 0, 1]
  return value.map((component) => component / length) as unknown as QuaternionTuple
}

export function multiplyQuaternions(
  left: QuaternionTuple,
  right: QuaternionTuple,
): QuaternionTuple {
  const [lx, ly, lz, lw] = left
  const [rx, ry, rz, rw] = right

  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]
}

export function relativeQuaternion(
  reference: QuaternionTuple,
  current: QuaternionTuple,
): QuaternionTuple {
  const normalizedReference = normalizeQuaternion(reference)
  const inverseReference: QuaternionTuple = [
    -normalizedReference[0],
    -normalizedReference[1],
    -normalizedReference[2],
    normalizedReference[3],
  ]

  return normalizeQuaternion(
    multiplyQuaternions(inverseReference, normalizeQuaternion(current)),
  )
}
