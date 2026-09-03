export type QuaternionTuple = readonly [
  x: number,
  y: number,
  z: number,
  w: number,
]

export type Vector3Tuple = readonly [x: number, y: number, z: number]

export interface BridgeStatusMessage {
  type: 'bridge-status'
  browsers: number
  phones: number
  webrtcBrowsers: number
  webrtcPhones: number
}

export interface FrameMetadataMessage {
  type: 'frame-meta'
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
  clockOffsetMs: number | null
  clockRttMs: number | null
  metadataReceivedAtMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
  payloadBytes: number | null
}

export interface LivePoseMessage {
  type: 'pose'
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

export type LiveTextMessage =
  | BridgeStatusMessage
  | FrameMetadataMessage
  | LivePoseMessage

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFiniteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null
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
    return {
      type: 'frame-meta',
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
