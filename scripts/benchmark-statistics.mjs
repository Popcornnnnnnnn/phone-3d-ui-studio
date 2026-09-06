import { rankEligibleBenchmarkResults } from './encoder-tuning.mjs'
import {
  benchmarkDecoderHealthIsClean,
  benchmarkDecoderResetReasons,
} from './benchmark-decoder-health.mjs'

export const minimumEligibleRunsPerBenchmarkGroup = 3

function firstDefined(...values) {
  return (
    values.find((value) => value !== undefined && value !== null) ?? null
  )
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonnegativeFiniteNumber(value) {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : null
}

function nonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function summarizeMedianWorstMad(values) {
  const observed = values.map(finiteNumber).filter((value) => value !== null)
  const medianValue = median(observed)
  return {
    median: medianValue,
    worst: observed.length === 0 ? null : Math.max(...observed),
    mad:
      medianValue === null
        ? null
        : median(observed.map((value) => Math.abs(value - medianValue))),
    observedRunCount: observed.length,
    missingRunCount: values.length - observed.length,
  }
}

function summarizeMedianMinimum(values) {
  const observed = values.map(finiteNumber).filter((value) => value !== null)
  return {
    median: median(observed),
    min: observed.length === 0 ? null : Math.min(...observed),
    observedRunCount: observed.length,
    missingRunCount: values.length - observed.length,
  }
}

function summarizeObservedTotal(results, readValue) {
  const values = results
    .map((result) => nonnegativeFiniteNumber(readValue(result)))
    .filter((value) => value !== null)
  return {
    total:
      values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0),
    observedRunCount: values.length,
    missingRunCount: results.length - values.length,
  }
}

function compactDecoderHealthRun(result) {
  const decoderHealth = result.decoderHealth
  const status =
    decoderHealth?.status === 'valid' ||
    decoderHealth?.status === 'invalid' ||
    decoderHealth?.status === 'unknown'
      ? decoderHealth.status
      : 'unknown'
  return {
    runId: result.runId ?? null,
    source:
      decoderHealth?.source === 'run-local' ||
      decoderHealth?.source === 'legacy'
        ? decoderHealth.source
        : 'missing',
    status,
    reason:
      typeof decoderHealth?.reason === 'string' ||
      decoderHealth?.reason === null
        ? decoderHealth.reason
        : 'compact-decoder-health-missing',
    clean: benchmarkDecoderHealthIsClean(decoderHealth),
    resetDelta: nonnegativeSafeInteger(decoderHealth?.resetDelta),
    errorDelta: nonnegativeSafeInteger(decoderHealth?.errorDelta),
    resetReasonDeltas: Object.fromEntries(
      benchmarkDecoderResetReasons.map((reason) => [
        reason,
        nonnegativeSafeInteger(decoderHealth?.resetReasonDeltas?.[reason]),
      ]),
    ),
    formatMismatchDropDelta: nonnegativeSafeInteger(
      decoderHealth?.formatMismatchDropDelta,
    ),
    legacyResetObservation: {
      field:
        typeof decoderHealth?.legacyResetObservation?.field === 'string'
          ? decoderHealth.legacyResetObservation.field
          : null,
      value: nonnegativeSafeInteger(
        decoderHealth?.legacyResetObservation?.value ??
          firstDefined(
            result.decoderResetsDuringRun,
            result.decoderResetCount,
            result.decoderResets,
          ),
      ),
    },
  }
}

function countValues(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
}

function summarizeDecoderHealth(results) {
  const runs = results.map(compactDecoderHealthRun)
  return {
    authority: 'report.screen.decoderHealth',
    cleanRunCount: runs.filter((run) => run.clean).length,
    nonCleanRunCount: runs.filter((run) => !run.clean).length,
    statusCounts: {
      valid: runs.filter((run) => run.status === 'valid').length,
      invalid: runs.filter((run) => run.status === 'invalid').length,
      unknown: runs.filter((run) => run.status === 'unknown').length,
    },
    reasonCounts: countValues(
      runs.map((run) => run.reason ?? 'none'),
    ),
    runs,
    resetDelta: summarizeObservedTotal(runs, (run) => run.resetDelta),
    errorDelta: summarizeObservedTotal(runs, (run) => run.errorDelta),
    resetReasonDeltas: Object.fromEntries(
      benchmarkDecoderResetReasons.map((reason) => [
        reason,
        summarizeObservedTotal(
          runs,
          (run) => run.resetReasonDeltas[reason],
        ),
      ]),
    ),
    formatMismatchDropDelta: summarizeObservedTotal(
      runs,
      (run) => run.formatMismatchDropDelta,
    ),
    legacyResetObservations: summarizeObservedTotal(
      runs,
      (run) => run.legacyResetObservation?.value,
    ),
  }
}

export function benchmarkGroupConfiguration(result) {
  return {
    targetFps: finiteNumber(result.targetFps),
    profile: firstDefined(
      result.requestedEncoderProfile,
      result.encoderProfile,
    ),
    tuning: firstDefined(
      result.requestedEncoderTuning,
      result.encoderTuning,
    ),
    decoderMode: firstDefined(
      result.requestedDecoderMode,
      result.decoderMode,
    ),
    captureShortEdge: finiteNumber(
      firstDefined(
        result.requestedCaptureShortEdge,
        result.captureShortEdge,
      ),
    ),
    bitstream: firstDefined(
      result.requestedBitstreamFormat,
      result.h264BitstreamFormatRequested,
      result.bitstreamFormat,
      result.bitstream,
    ),
    renderPreset: firstDefined(
      result.requestedRenderPreset,
      result.renderPreset,
    ),
  }
}

export function benchmarkGroupKey(configuration) {
  return JSON.stringify([
    configuration.targetFps,
    configuration.profile,
    configuration.tuning,
    configuration.decoderMode,
    configuration.captureShortEdge,
    configuration.bitstream,
    configuration.renderPreset,
  ])
}

function summarizeGroup(configuration, results, minimumEligibleRuns) {
  // Reuse the exact per-run eligibility gate that backs the legacy `ranked`
  // output. This prevents group statistics from quietly admitting incomplete
  // interaction coverage or otherwise invalid runs.
  const eligibleResults = rankEligibleBenchmarkResults(
    results.filter((result) =>
      benchmarkDecoderHealthIsClean(result.decoderHealth),
    ),
  )
  const eligibleCount = eligibleResults.length
  return {
    configuration,
    configurationKey: benchmarkGroupKey(configuration),
    runCount: results.length,
    eligibleCount,
    eligibleForRanking: eligibleCount >= minimumEligibleRuns,
    thermalContaminatedCount: results.filter(
      (result) => result.thermalContaminated === true,
    ).length,
    decoderHealth: summarizeDecoderHealth(results),
    interactionP95Ms: summarizeMedianWorstMad(
      eligibleResults.map((result) => result.interactionToRender?.p95Ms),
    ),
    captureP95Ms: summarizeMedianWorstMad(
      eligibleResults.map((result) => result.captureToRenderP95Ms),
    ),
    renderedFps: summarizeMedianMinimum(
      eligibleResults.map((result) => result.renderedFps),
    ),
    totals: {
      // Totals intentionally cover every attempted run in this configuration,
      // including excluded/thermal-contaminated runs. The observation counts
      // distinguish an observed zero from a metric absent in an older report.
      droppedBeforeDecode: summarizeObservedTotal(
        results,
        (result) => result.droppedBeforeDecode,
      ),
      observedMissingFrameIds: summarizeObservedTotal(
        results,
        (result) => result.observedMissingFrameIds,
      ),
      decoderResets: summarizeObservedTotal(
        results,
        (result) =>
          firstDefined(
            result.decoderResetsDuringRun,
            result.decoderResetCount,
            result.decoderResets,
          ),
      ),
    },
  }
}

function ascending(value) {
  return finiteNumber(value) ?? Number.POSITIVE_INFINITY
}

function descending(value) {
  return finiteNumber(value) ?? Number.NEGATIVE_INFINITY
}

export function rankBenchmarkGroups(groups) {
  return groups
    .filter((group) => group.eligibleForRanking === true)
    .sort(
      (left, right) =>
        ascending(left.interactionP95Ms.median) -
          ascending(right.interactionP95Ms.median) ||
        ascending(left.interactionP95Ms.worst) -
          ascending(right.interactionP95Ms.worst) ||
        ascending(left.captureP95Ms.median) -
          ascending(right.captureP95Ms.median) ||
        descending(right.renderedFps.median) -
          descending(left.renderedFps.median) ||
        descending(right.renderedFps.min) - descending(left.renderedFps.min) ||
        left.configurationKey.localeCompare(right.configurationKey),
    )
}

export function summarizeBenchmarkGroups(
  results,
  minimumEligibleRuns = minimumEligibleRunsPerBenchmarkGroup,
) {
  if (!Number.isSafeInteger(minimumEligibleRuns) || minimumEligibleRuns < 1) {
    throw new Error('minimumEligibleRuns must be a positive integer')
  }

  const grouped = new Map()
  for (const result of results) {
    const configuration = benchmarkGroupConfiguration(result)
    const key = benchmarkGroupKey(configuration)
    const group = grouped.get(key)
    if (group) {
      group.results.push(result)
    } else {
      grouped.set(key, { configuration, results: [result] })
    }
  }

  const groups = [...grouped.values()].map(({ configuration, results: runs }) =>
    summarizeGroup(configuration, runs, minimumEligibleRuns),
  )
  return {
    schemaVersion: 1,
    minimumEligibleRuns,
    performanceMetricScope: 'eligible-runs-only',
    stabilityTotalScope: 'all-group-runs-with-observation-counts',
    groups,
    ranked: rankBenchmarkGroups(groups),
  }
}
