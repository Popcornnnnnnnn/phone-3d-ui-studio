const preStartPhoneTransportDisconnectReasons = new Set([
  'pinned-phone-control-disconnected',
  'pinned-phone-raw-frame-disconnected',
  'pinned-phone-websocket-frame-disconnected',
])

function latest(values) {
  return Array.isArray(values) && values.length > 0
    ? values[values.length - 1]
    : null
}

function isFreshTimestamp(value, nowMs, maximumAgeMs) {
  return (
    Number.isFinite(value) &&
    value <= nowMs + 1_000 &&
    nowMs - value < maximumAgeMs
  )
}

export function classifyPreStartPhoneTransportFailure(events) {
  if (!Array.isArray(events)) return null

  const requestedIndex = events.findIndex(
    (event) =>
      event?.type === 'benchmark-request' && event.phase === 'requested',
  )
  if (requestedIndex < 0) return null

  const measurementStarted = events.some((event) => {
    const phase = event?.phase
    return (
      phase === 'started' ||
      phase === 'completed' ||
      phase === 'report-accepted' ||
      phase === 'invalid-run-started' ||
      phase === 'invalid-run-completed'
    )
  })
  if (measurementStarted) return null

  let invalidation = null
  for (let index = events.length - 1; index > requestedIndex; index -= 1) {
    const event = events[index]
    if (event?.type === 'benchmark-state' && event.phase === 'invalidated') {
      invalidation = event
      break
    }
  }

  if (
    !invalidation ||
    !preStartPhoneTransportDisconnectReasons.has(invalidation.reason)
  ) {
    return null
  }

  return {
    reason: invalidation.reason,
    invalidatedAtMs: Number.isFinite(invalidation.bridgeReceivedAtMs)
      ? invalidation.bridgeReceivedAtMs
      : null,
  }
}

export function retryReadiness(
  health,
  diagnostics,
  nowMs,
  maximumAgeMs = 1_500,
) {
  const reasons = []
  if (
    health?.phones !== 1 ||
    health?.phonePose !== 1 ||
    !Number.isFinite(health?.browsers) ||
    health.browsers < 1 ||
    !Number.isFinite(health?.browserPose) ||
    health.browserPose < 1
  ) {
    reasons.push('connection-counts')
  }

  const encoder = latest(diagnostics?.encoderSamples)
  if (!encoder) {
    reasons.push('missing-encoder-heartbeat')
  } else {
    if (
      !isFreshTimestamp(
        encoder.bridgeReceivedAtMs,
        nowMs,
        maximumAgeMs,
      )
    ) {
      reasons.push('stale-encoder-heartbeat')
    }
    if (
      encoder.captureState !== 'streaming' ||
      encoder.encoderStatus !== 0 ||
      encoder.codec !== 'H.264' ||
      encoder.frameSocket !== 'connected' ||
      encoder.poseSocket !== 'connected'
    ) {
      reasons.push('phone-not-ready')
    }
  }

  const receiver = latest(diagnostics?.receiverSamples)
  if (!receiver) {
    reasons.push('missing-browser-receiver')
  } else {
    if (
      !isFreshTimestamp(
        receiver.bridgeReceivedAtMs,
        nowMs,
        maximumAgeMs,
      )
    ) {
      reasons.push('stale-browser-receiver')
    }
    if (
      receiver.visibilityState !== 'visible' ||
      receiver.screenStale !== false ||
      !isFreshTimestamp(
        receiver.lastFrameReceivedAtMs,
        nowMs,
        maximumAgeMs,
      ) ||
      !isFreshTimestamp(
        receiver.lastFrameRenderedAtMs,
        nowMs,
        maximumAgeMs,
      )
    ) {
      reasons.push('browser-not-ready')
    }
  }

  return {
    ready: reasons.length === 0,
    reasons,
  }
}

export function advanceConsecutiveReadiness(
  previousReadySamples,
  activeBenchmark,
  readiness,
) {
  if (activeBenchmark !== null || readiness?.ready !== true) return 0
  return previousReadySamples + 1
}
