export const encoderTunings = Object.freeze([
  'default',
  'speed-priority',
  'high-speed-preset',
  'video-conferencing-preset',
])

export const minimumInteractionCoveragePercent = 98
export const browserDecoderModes = Object.freeze([
  'software',
  'auto',
  'hardware',
])
export const captureShortEdges = Object.freeze([960, 720, 640])

export function browserDecoderAcceleration(mode) {
  if (mode === 'software') return 'prefer-software'
  if (mode === 'auto') return 'no-preference'
  if (mode === 'hardware') return 'prefer-hardware'
  return null
}

export function isEncoderTuning(value) {
  return encoderTunings.includes(value)
}

export function normalizeEncoderTuning(value) {
  return isEncoderTuning(value) ? value : 'default'
}

export function encoderTuningConfigurationError(encoderProfile, encoderTuning) {
  if (!isEncoderTuning(encoderTuning)) {
    return `unsupported encoderTuning "${encoderTuning}"`
  }
  if (
    (encoderTuning === 'speed-priority' ||
      encoderTuning === 'high-speed-preset') &&
    encoderProfile !== 'legacy'
  ) {
    return `${encoderTuning} requires encoderProfile=legacy`
  }
  if (
    encoderTuning === 'video-conferencing-preset' &&
    encoderProfile !== 'low-latency'
  ) {
    return 'video-conferencing-preset requires encoderProfile=low-latency'
  }
  return null
}

export function parseBenchmarkConfiguration(argument) {
  const match =
    /^(\d+):(legacy|low-latency)(?::([^:]+))?(?::([^:]+))?(?::([^:]+))?$/.exec(
      argument,
    )
  if (!match) {
    throw new Error(
      `Invalid configuration "${argument}"; use FPS:PROFILE, FPS:PROFILE:TUNING, FPS:PROFILE:TUNING:DECODER, or FPS:PROFILE:TUNING:DECODER:SHORT_EDGE.`,
    )
  }

  const encoderProfile = match[2]
  const encoderTuning = match[3] ?? 'default'
  const decoderMode = match[4] ?? 'software'
  const captureShortEdge = Number.parseInt(match[5] ?? '960', 10)
  const tuningError = encoderTuningConfigurationError(
    encoderProfile,
    encoderTuning,
  )
  if (tuningError) {
    throw new Error(`Invalid configuration "${argument}": ${tuningError}.`)
  }
  if (!browserDecoderModes.includes(decoderMode)) {
    throw new Error(
      `Invalid configuration "${argument}": unsupported decoderMode "${decoderMode}".`,
    )
  }
  if (
    String(captureShortEdge) !== (match[5] ?? '960') ||
    !captureShortEdges.includes(captureShortEdge)
  ) {
    throw new Error(
      `Invalid configuration "${argument}": unsupported captureShortEdge "${match[5] ?? ''}".`,
    )
  }

  return {
    targetFps: Math.min(120, Math.max(15, Number.parseInt(match[1], 10))),
    encoderProfile,
    encoderTuning,
    decoderMode,
    captureShortEdge,
  }
}

export function benchmarkConfigurationDisposition(
  requestedProfile,
  requestedTuning,
  activeProfile,
  activeTuning,
  measurement = {},
) {
  const fallbackOrUnsupported =
    activeProfile !== requestedProfile ||
    activeTuning !== requestedTuning ||
    (measurement.requestedDecoderMode !== undefined &&
      (measurement.appliedDecoderMode !== measurement.requestedDecoderMode ||
        measurement.decoderAccelerationConfigured !==
          browserDecoderAcceleration(measurement.requestedDecoderMode)))
  const captureConfigurationInvalid =
    measurement.requestedCaptureShortEdge !== undefined &&
    ((measurement.expectedCaptureShortEdge !== undefined &&
      measurement.requestedCaptureShortEdge !==
        measurement.expectedCaptureShortEdge) ||
      !captureShortEdges.includes(measurement.requestedCaptureShortEdge) ||
      measurement.activeCaptureShortEdge !==
        measurement.requestedCaptureShortEdge ||
      !Number.isSafeInteger(measurement.captureWidthActive) ||
      !Number.isSafeInteger(measurement.captureHeightActive) ||
      Math.min(
        measurement.captureWidthActive,
        measurement.captureHeightActive,
      ) !== measurement.activeCaptureShortEdge ||
      !Number.isSafeInteger(measurement.captureStreamGeneration) ||
      measurement.captureStreamGeneration <= 0)
  const thermalContaminated = measurement.thermalContaminated === true
  const captureTimestampCoveragePercent = Number.isFinite(
    measurement.captureTimestampCoveragePercent,
  )
    ? measurement.captureTimestampCoveragePercent
    : 0
  const futureToleratedCaptureTimestampPercent = Number.isFinite(
    measurement.futureToleratedCaptureTimestampPercent,
  )
    ? measurement.futureToleratedCaptureTimestampPercent
    : Number.POSITIVE_INFINITY
  const interactionToRenderCoveragePercent = Number.isFinite(
    measurement.interactionToRenderCoveragePercent,
  )
    ? measurement.interactionToRenderCoveragePercent
    : 0
  const measurementInsufficient =
    captureTimestampCoveragePercent < 90 ||
    futureToleratedCaptureTimestampPercent > 1 ||
    interactionToRenderCoveragePercent < minimumInteractionCoveragePercent
  const exclusionReasons = []
  if (fallbackOrUnsupported) exclusionReasons.push('fallback-or-unsupported')
  if (captureConfigurationInvalid) {
    exclusionReasons.push('capture-configuration-invalid')
  }
  if (thermalContaminated) exclusionReasons.push('thermal-contaminated')
  if (captureTimestampCoveragePercent < 90) {
    exclusionReasons.push('capture-timestamp-coverage-below-90-percent')
  }
  if (futureToleratedCaptureTimestampPercent > 1) {
    exclusionReasons.push('future-tolerated-capture-timestamps-above-1-percent')
  }
  if (interactionToRenderCoveragePercent < minimumInteractionCoveragePercent) {
    exclusionReasons.push(
      `interaction-to-render-coverage-below-${minimumInteractionCoveragePercent}-percent`,
    )
  }
  return {
    fallbackOrUnsupported,
    captureConfigurationInvalid,
    thermalContaminated,
    measurementInsufficient,
    exclusionReasons,
    eligibleForRanking:
      !fallbackOrUnsupported &&
      !captureConfigurationInvalid &&
      !thermalContaminated &&
      !measurementInsufficient,
  }
}

export function rankEligibleBenchmarkResults(results) {
  return results
    .filter(
      (result) =>
        result.eligibleForRanking === true &&
        Number.isFinite(result.interactionToRender?.p95Ms) &&
        Number.isFinite(result.interactionToRender?.p50Ms) &&
        result.interactionToRender.samples > 0 &&
        result.interactionToRender.coveredDurationMs > 0 &&
        Number.isFinite(result.interactionToRender.coveragePercent) &&
        result.interactionToRender.coveragePercent >=
          minimumInteractionCoveragePercent,
    )
    .sort((left, right) => {
      return (
        left.interactionToRender.p95Ms - right.interactionToRender.p95Ms ||
        left.interactionToRender.p50Ms - right.interactionToRender.p50Ms ||
        (left.captureToRenderP95Ms ?? Number.POSITIVE_INFINITY) -
          (right.captureToRenderP95Ms ?? Number.POSITIVE_INFINITY) ||
        (left.captureToRenderP50Ms ?? Number.POSITIVE_INFINITY) -
          (right.captureToRenderP50Ms ?? Number.POSITIVE_INFINITY) ||
        right.renderedFps - left.renderedFps
      )
    })
}
