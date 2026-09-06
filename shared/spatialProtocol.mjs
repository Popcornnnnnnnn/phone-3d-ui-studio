export const SPATIAL_STALE_MS = 250
export const SPATIAL_STATES = new Set([
  'initializing', 'normal', 'limited', 'unavailable', 'paused',
  'denied', 'unsupported', 'error',
])

const finiteTuple = (value, size) =>
  Array.isArray(value) && value.length === size &&
  value.every((component) => typeof component === 'number' && Number.isFinite(component))

// The spatial channel accepts metadata only. Never relay arbitrary camera data.
export function parseSpatialMessage(value) {
  if (!value || typeof value !== 'object' ||
      !['spatial-pose', 'spatial-status'].includes(value.type) ||
      typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 128 ||
      !['arkit', 'fixture'].includes(value.source) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      !Number.isFinite(value.sampledAtMs) ||
      !SPATIAL_STATES.has(value.trackingState) ||
      typeof value.reason !== 'string' || value.reason.length > 512) return null
  const result = {
    type: value.type, source: value.source, sessionId: value.sessionId, sequence: value.sequence,
    sampledAtMs: value.sampledAtMs, trackingState: value.trackingState, reason: value.reason,
    clockOffsetMs: Number.isFinite(value.clockOffsetMs) ? value.clockOffsetMs : null,
    clockRttMs: Number.isFinite(value.clockRttMs) && value.clockRttMs >= 0 ? value.clockRttMs : null,
  }
  if (value.type === 'spatial-pose') {
    if (!finiteTuple(value.positionMeters, 3) || !finiteTuple(value.quaternion, 4) ||
        Math.abs(Math.hypot(...value.quaternion) - 1) > 0.01) return null
    result.positionMeters = [...value.positionMeters]
    result.quaternion = [...value.quaternion]
  }
  return result
}
