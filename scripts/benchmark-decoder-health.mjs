export const benchmarkDecoderResetReasons = [
  'queue',
  'pending',
  'age',
  'configuration',
  'error',
]

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function nonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function decoderHealthStatus(value) {
  return value === 'valid' || value === 'invalid' || value === 'unknown'
    ? value
    : 'unknown'
}

function resetReasonDeltas(value) {
  const reported = record(value)
  return Object.fromEntries(
    benchmarkDecoderResetReasons.map((reason) => [
      reason,
      nonnegativeSafeInteger(reported?.[reason]),
    ]),
  )
}

function legacyResetObservation(screen) {
  for (const field of [
    'decoderResetsDuringRun',
    'decoderResetCount',
    'decoderResets',
  ]) {
    const value = nonnegativeSafeInteger(screen?.[field])
    if (value !== null) return { field, value }
  }
  return { field: null, value: null }
}

export function benchmarkDecoderHealthIsClean(decoderHealth) {
  return (
    decoderHealth?.status === 'valid' &&
    decoderHealth.resetDelta === 0 &&
    decoderHealth.errorDelta === 0 &&
    decoderHealth.formatMismatchDropDelta === 0
  )
}

export function benchmarkDecoderHealthFromReport(report) {
  const screen = record(report?.screen) ?? {}
  const reported = record(screen.decoderHealth)
  const legacyReset = legacyResetObservation(screen)

  if (!reported) {
    return {
      source: 'legacy',
      status: 'unknown',
      reason: 'legacy-report-without-run-local-decoder-health',
      clean: false,
      resetDelta: null,
      errorDelta: null,
      resetReasonDeltas: resetReasonDeltas(null),
      formatMismatchDropDelta: null,
      legacyResetObservation: legacyReset,
    }
  }

  const status = decoderHealthStatus(reported.status)
  const reason =
    typeof reported.reason === 'string' || reported.reason === null
      ? reported.reason
      : status === 'unknown'
        ? 'invalid-run-local-decoder-health-status'
        : null
  const decoderHealth = {
    source: 'run-local',
    status,
    reason,
    resetDelta: nonnegativeSafeInteger(reported.resetDelta),
    errorDelta: nonnegativeSafeInteger(reported.errorDelta),
    resetReasonDeltas: resetReasonDeltas(reported.resetReasonDeltas),
    formatMismatchDropDelta: nonnegativeSafeInteger(
      reported.formatMismatchDropDelta,
    ),
    legacyResetObservation: legacyReset,
  }
  return {
    ...decoderHealth,
    clean: benchmarkDecoderHealthIsClean(decoderHealth),
  }
}

export function benchmarkDecoderHealthExclusionReasons(decoderHealth) {
  if (benchmarkDecoderHealthIsClean(decoderHealth)) return []
  if (decoderHealth?.status === 'invalid') return ['decoder-health-invalid']
  if (decoderHealth?.status !== 'valid') return ['decoder-health-unknown']

  const reasons = []
  const requiredDeltas = [
    decoderHealth.resetDelta,
    decoderHealth.errorDelta,
    decoderHealth.formatMismatchDropDelta,
  ]
  if (requiredDeltas.some((value) => value === null)) {
    reasons.push('decoder-health-evidence-incomplete')
  }
  if (decoderHealth.resetDelta > 0) {
    reasons.push('decoder-resets-during-run')
  }
  if (decoderHealth.errorDelta > 0) {
    reasons.push('decoder-errors-during-run')
  }
  if (decoderHealth.formatMismatchDropDelta > 0) {
    reasons.push('decoder-format-mismatch-drops-during-run')
  }
  return reasons.length > 0 ? reasons : ['decoder-health-not-clean']
}
