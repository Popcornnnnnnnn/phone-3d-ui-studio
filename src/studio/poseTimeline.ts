import {
  normalizeQuaternion,
  type QuaternionTuple,
} from './liveProtocol'

export interface TimedPoseQuaternion {
  timestampMs: number
  quaternion: QuaternionTuple
}

export interface InterpolatedPose {
  timestampMs: number
  quaternion: QuaternionTuple
  nearestSampleDeltaMs: number
}

const DEFAULT_RETENTION_MS = 3_000
const DEFAULT_MAX_SAMPLES = 360

function slerpQuaternion(
  from: QuaternionTuple,
  to: QuaternionTuple,
  amount: number,
): QuaternionTuple {
  const left = normalizeQuaternion(from)
  let right = normalizeQuaternion(to)
  let dot = left.reduce(
    (sum, component, index) => sum + component * right[index],
    0,
  )

  // q and -q describe the same rotation. Choose the shorter arc so a sensor
  // sign flip cannot make the rendered phone spin the long way around.
  if (dot < 0) {
    right = right.map((component) => -component) as unknown as QuaternionTuple
    dot = -dot
  }

  const clampedAmount = Math.min(1, Math.max(0, amount))
  if (dot > 0.9995) {
    return normalizeQuaternion(
      left.map(
        (component, index) =>
          component + (right[index] - component) * clampedAmount,
      ) as unknown as QuaternionTuple,
    )
  }

  const angle = Math.acos(Math.min(1, Math.max(-1, dot)))
  const angleSin = Math.sin(angle)
  const leftWeight = Math.sin((1 - clampedAmount) * angle) / angleSin
  const rightWeight = Math.sin(clampedAmount * angle) / angleSin
  return normalizeQuaternion(
    left.map(
      (component, index) =>
        component * leftWeight + right[index] * rightWeight,
    ) as unknown as QuaternionTuple,
  )
}

export function recordPoseSample(
  history: TimedPoseQuaternion[],
  sample: TimedPoseQuaternion,
  retentionMs = DEFAULT_RETENTION_MS,
  maxSamples = DEFAULT_MAX_SAMPLES,
) {
  if (!Number.isFinite(sample.timestampMs)) return
  const normalizedSample = {
    timestampMs: sample.timestampMs,
    quaternion: normalizeQuaternion(sample.quaternion),
  }
  const last = history.at(-1)

  if (!last || normalizedSample.timestampMs > last.timestampMs) {
    history.push(normalizedSample)
  } else if (normalizedSample.timestampMs === last.timestampMs) {
    history[history.length - 1] = normalizedSample
  } else {
    const insertionIndex = history.findIndex(
      (entry) => entry.timestampMs >= normalizedSample.timestampMs,
    )
    if (insertionIndex < 0) history.push(normalizedSample)
    else if (history[insertionIndex].timestampMs === normalizedSample.timestampMs) {
      history[insertionIndex] = normalizedSample
    } else {
      history.splice(insertionIndex, 0, normalizedSample)
    }
  }

  const cutoffMs = normalizedSample.timestampMs - retentionMs
  while (history.length > 1 && history[1].timestampMs < cutoffMs) {
    history.shift()
  }
  if (history.length > maxSamples) {
    history.splice(0, history.length - maxSamples)
  }
}

export function interpolatePoseAt(
  history: readonly TimedPoseQuaternion[],
  timestampMs: number,
): InterpolatedPose | null {
  if (history.length === 0 || !Number.isFinite(timestampMs)) return null
  const first = history[0]
  const last = history[history.length - 1]

  if (timestampMs <= first.timestampMs) {
    return {
      timestampMs: first.timestampMs,
      quaternion: first.quaternion,
      nearestSampleDeltaMs: first.timestampMs - timestampMs,
    }
  }
  if (timestampMs >= last.timestampMs) {
    return {
      timestampMs: last.timestampMs,
      quaternion: last.quaternion,
      nearestSampleDeltaMs: timestampMs - last.timestampMs,
    }
  }

  let low = 0
  let high = history.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (history[middle].timestampMs <= timestampMs) low = middle
    else high = middle
  }

  const before = history[low]
  const after = history[high]
  const durationMs = after.timestampMs - before.timestampMs
  const amount = durationMs <= 0 ? 0 : (timestampMs - before.timestampMs) / durationMs

  return {
    timestampMs,
    quaternion: slerpQuaternion(before.quaternion, after.quaternion, amount),
    nearestSampleDeltaMs: Math.min(
      timestampMs - before.timestampMs,
      after.timestampMs - timestampMs,
    ),
  }
}

export function captureTimeToEpochMs(
  captureTimeMs: number | undefined,
  observedAtEpochMs: number,
  performanceTimeOriginMs: number,
) {
  if (captureTimeMs === undefined || !Number.isFinite(captureTimeMs)) return null

  // Epoch timestamps are currently around 1e12 ms, while a high-resolution
  // timestamp is the much smaller duration since this page's time origin.
  if (
    captureTimeMs > 1_000_000_000_000 &&
    Math.abs(observedAtEpochMs - captureTimeMs) <= 10_000
  ) {
    return captureTimeMs
  }

  const highResolutionCandidate = performanceTimeOriginMs + captureTimeMs
  if (Math.abs(observedAtEpochMs - highResolutionCandidate) <= 10_000) {
    return highResolutionCandidate
  }

  // Defensive fallback for browsers that expose an epoch-style timestamp even
  // though the WebRTC callback contract uses DOMHighResTimeStamp.
  if (Math.abs(observedAtEpochMs - captureTimeMs) <= 10_000) {
    return captureTimeMs
  }
  return null
}
