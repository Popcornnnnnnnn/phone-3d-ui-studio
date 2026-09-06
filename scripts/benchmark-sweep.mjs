import { setTimeout as delay } from 'node:timers/promises'
import {
  advanceConsecutiveReadiness,
  classifyPreStartPhoneTransportFailure,
  retryReadiness,
} from './benchmark-retry.mjs'
import {
  benchmarkConfigurationDisposition,
  parseBenchmarkConfiguration,
  rankEligibleBenchmarkResults,
} from './encoder-tuning.mjs'
import {
  acceptedBenchmarkPayload,
  buildBenchmarkOutput,
  writeBenchmarkOutput,
} from './benchmark-output.mjs'
import {
  benchmarkDecoderHealthExclusionReasons,
  benchmarkDecoderHealthFromReport,
} from './benchmark-decoder-health.mjs'

const bridgeOrigin = process.env.PHONE_BRIDGE_HTTP ?? 'http://127.0.0.1:4319'
const durationMs = boundedInteger(
  process.env.BENCHMARK_DURATION_MS,
  15_000,
  5_000,
  60_000,
)
const warmupMs = boundedInteger(
  process.env.BENCHMARK_WARMUP_MS,
  2_000,
  500,
  5_000,
)
const pollIntervalMs = 250
const maximumAttempts = process.env.BENCHMARK_DISABLE_RETRY === '1' ? 1 : 2
const retryReadinessPollMs = 500
const retryReadinessTimeoutMs = boundedInteger(
  process.env.BENCHMARK_RETRY_READY_TIMEOUT_MS,
  10_000,
  2_000,
  30_000,
)
let configurations = []
const results = []
let failure = null

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback
}

function configurationMatrix(arguments_) {
  if (arguments_.length === 0) {
    return [
      {
        targetFps: 60,
        encoderProfile: 'legacy',
        encoderTuning: 'speed-priority',
        decoderMode: 'software',
        captureShortEdge: 960,
      },
      {
        targetFps: 60,
        encoderProfile: 'low-latency',
        encoderTuning: 'default',
        decoderMode: 'software',
        captureShortEdge: 960,
      },
      {
        targetFps: 60,
        encoderProfile: 'legacy',
        encoderTuning: 'high-speed-preset',
        decoderMode: 'software',
        captureShortEdge: 960,
      },
    ]
  }

  return arguments_.map(parseBenchmarkConfiguration)
}

async function readJson(url, init) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      body.error ?? `${response.status} ${response.statusText}`,
    )
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

function benchmarkFailure(
  error,
  phase,
  { index = null, configuration = null, attempts = [] } = {},
) {
  return {
    error,
    summary: {
      phase,
      index,
      configuration,
      message: error instanceof Error ? error.message : String(error),
      status: Number.isFinite(error?.status) ? error.status : null,
      body: error?.body ?? null,
      retryCount: Math.max(0, attempts.length - 1),
      attempts,
    },
  }
}

async function waitForReport(runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await readJson(`${bridgeOrigin}/benchmark/status`)
    if (status.latestAccepted?.runId === runId) {
      const latest = await readJson(`${bridgeOrigin}/benchmark/latest`)
      const accepted = acceptedBenchmarkPayload(latest, runId)
      if (accepted !== null) return accepted
      break
    }
    if (status.active === null) break
    await delay(pollIntervalMs)
  }

  const diagnostics = await readJson(`${bridgeOrigin}/diagnostics`)
  const events = (diagnostics.benchmarkEvents ?? []).filter(
    (event) => event.runId === runId,
  )
  const error = new Error(
    `Benchmark ${runId} produced no accepted report: ${JSON.stringify(events.slice(-5))}`,
  )
  error.runId = runId
  error.benchmarkEvents = events
  throw error
}

function lastFailureReason(events) {
  if (!Array.isArray(events)) return 'no-accepted-report'
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (typeof event?.reason === 'string') return event.reason
  }
  return 'no-accepted-report'
}

async function waitForRetryReadiness(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let consecutiveReadySamples = 0
  let lastReadiness = { ready: false, reasons: ['not-checked'] }

  while (Date.now() < deadline) {
    const status = await readJson(`${bridgeOrigin}/benchmark/status`)
    if (status.active !== null) {
      consecutiveReadySamples = 0
      lastReadiness = { ready: false, reasons: ['benchmark-active'] }
      await delay(retryReadinessPollMs)
      continue
    }

    const [health, diagnostics] = await Promise.all([
      readJson(`${bridgeOrigin}/health`),
      readJson(`${bridgeOrigin}/diagnostics`),
    ])
    if (diagnostics.activeBenchmark !== null) {
      consecutiveReadySamples = 0
      lastReadiness = { ready: false, reasons: ['benchmark-active'] }
    } else {
      lastReadiness = retryReadiness(health, diagnostics, Date.now())
      consecutiveReadySamples = advanceConsecutiveReadiness(
        consecutiveReadySamples,
        diagnostics.activeBenchmark,
        lastReadiness,
      )
      if (consecutiveReadySamples >= 2) return
    }

    await delay(retryReadinessPollMs)
  }

  throw new Error(
    `Benchmark retry readiness did not stabilize within ${timeoutMs} ms: ${lastReadiness.reasons.join(',')}`,
  )
}

async function startBenchmarkWhenReady(parameters, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastReadinessError = null

  while (Date.now() < deadline) {
    try {
      return await readJson(
        `${bridgeOrigin}/benchmark/start?${parameters}`,
        { method: 'POST' },
      )
    } catch (error) {
      if (
        error?.status !== 409 ||
        error?.body?.error !==
          'live phone capture and browser telemetry must be ready'
      ) {
        throw error
      }
      lastReadinessError = error
      await delay(retryReadinessPollMs)
    }
  }

  throw lastReadinessError ?? new Error('benchmark readiness timed out')
}

function compactResult(configuration, acceptedBenchmark, attempts) {
  const { report } = acceptedBenchmark
  const activeEncoderProfile =
    report.configuration?.parameters?.encoderProfile ?? null
  const activeEncoderTuning =
    report.configuration?.parameters?.encoderTuning ?? null
  const requestedDecoderMode =
    report.configuration?.parameters?.decoderModeRequested ?? null
  const appliedDecoderMode =
    report.configuration?.parameters?.decoderModeApplied ?? null
  const decoderAccelerationConfigured =
    report.configuration?.parameters?.decoderAccelerationConfigured ?? null
  const requestedCaptureShortEdge =
    report.configuration?.parameters?.captureShortEdgeRequested ?? null
  const activeCaptureShortEdge =
    report.configuration?.parameters?.captureShortEdgeActive ?? null
  const captureWidthActive =
    report.configuration?.parameters?.captureWidthActive ?? null
  const captureHeightActive =
    report.configuration?.parameters?.captureHeightActive ?? null
  const captureStreamGeneration =
    report.configuration?.parameters?.captureStreamGeneration ?? null
  const thermalStateStart =
    report.configuration?.parameters?.thermalStateStart ?? null
  const thermalStateEnd =
    report.configuration?.parameters?.thermalStateEnd ?? null
  const thermalStateWorstObserved =
    report.configuration?.parameters?.thermalStateWorstObserved ?? null
  const thermalContaminated =
    report.configuration?.parameters?.thermalContaminated === true
  const requestedBitstreamFormat =
    report.configuration?.parameters?.h264BitstreamFormatRequested ?? null
  const activeBitstreamFormat =
    report.configuration?.parameters?.decoderBitstreamFormatActive ??
    report.configuration?.parameters?.h264BitstreamFormatActive ??
    null
  const renderPreset =
    report.configuration?.parameters?.renderPreset ?? null
  const decoderHealth = benchmarkDecoderHealthFromReport(report)
  const captureTimestampCoveragePercent =
    report.screen.captureTimestamp?.coveragePercent ??
    (report.screen.freshRenderedFrames > 0
      ? (report.screen.captureToRender.samples /
          report.screen.freshRenderedFrames) * 100
      : 0)
  const futureToleratedCaptureTimestampPercent =
    report.screen.captureTimestamp?.futureToleratedPercent ?? null
  const interactionToRenderCoveragePercent =
    report.screen.interactionToRender?.coveragePercent ?? 0
  const configurationDisposition = benchmarkConfigurationDisposition(
    configuration.encoderProfile,
    configuration.encoderTuning,
    activeEncoderProfile,
    activeEncoderTuning,
    {
      captureTimestampCoveragePercent,
      futureToleratedCaptureTimestampPercent,
      interactionToRenderCoveragePercent,
      requestedDecoderMode: configuration.decoderMode,
      appliedDecoderMode,
      decoderAccelerationConfigured,
      expectedCaptureShortEdge: configuration.captureShortEdge,
      requestedCaptureShortEdge,
      activeCaptureShortEdge,
      captureWidthActive,
      captureHeightActive,
      captureStreamGeneration,
      thermalContaminated,
    },
  )
  const decoderHealthExclusionReasons =
    benchmarkDecoderHealthExclusionReasons(decoderHealth)
  return {
    targetFps: configuration.targetFps,
    requestedEncoderProfile: configuration.encoderProfile,
    activeEncoderProfile,
    requestedEncoderTuning: configuration.encoderTuning,
    activeEncoderTuning,
    requestedDecoderMode: configuration.decoderMode,
    appliedDecoderMode,
    decoderAccelerationConfigured,
    frameAckWindow: report.configuration?.parameters?.frameAckWindow ?? null,
    decoderBacklogPolicy: report.configuration?.parameters?.decoderBacklogPolicy ?? null,
    decoderMaxPendingFrames: report.configuration?.parameters?.decoderMaxPendingFrames ?? null,
    decoderMaxFrameAgeMs: report.configuration?.parameters?.decoderMaxFrameAgeMs ?? null,
    requestedCaptureShortEdge: configuration.captureShortEdge,
    reportedCaptureShortEdgeRequested: requestedCaptureShortEdge,
    activeCaptureShortEdge,
    captureWidthActive,
    captureHeightActive,
    captureStreamGeneration,
    thermalStateStart,
    thermalStateEnd,
    thermalStateWorstObserved,
    thermalContaminated,
    requestedBitstreamFormat,
    activeBitstreamFormat,
    renderPreset,
    browserConfigId:
      report.configuration?.parameters?.browserConfigId ?? null,
    browserConfigGeneration:
      report.configuration?.parameters?.browserConfigGeneration ?? null,
    browserPrepareDurationMs:
      report.configuration?.parameters?.browserPrepareDurationMs ?? null,
    ...configurationDisposition,
    decoderHealthInsufficient: !decoderHealth.clean,
    exclusionReasons: [
      ...configurationDisposition.exclusionReasons,
      ...decoderHealthExclusionReasons,
    ],
    eligibleForRanking:
      configurationDisposition.eligibleForRanking && decoderHealth.clean,
    runId: report.runId,
    renderScheduler: report.renderScheduler ?? null,
    phoneFrameTransport: acceptedBenchmark.phoneFrameTransport,
    phoneControlTransport: acceptedBenchmark.phoneControlTransport,
    durationMs: report.durationMs,
    renderedFps: report.screen.freshRenderedFps ?? report.screen.renderedFps,
    totalRenderedFps: report.screen.renderedFps,
    captureToRenderP50Ms: report.screen.captureToRender.p50Ms,
    captureToRenderP95Ms: report.screen.captureToRender.p95Ms,
    captureToRenderSamples: report.screen.captureToRender.samples,
    interactionToRender: report.screen.interactionToRender ?? null,
    callbackToRenderLowerBoundP50Ms:
      report.screen.callbackToRenderLowerBound?.p50Ms ?? null,
    callbackToRenderLowerBoundP95Ms:
      report.screen.callbackToRenderLowerBound?.p95Ms ?? null,
    renderedFrames: report.screen.renderedFrames,
    freshRenderedFrames: report.screen.freshRenderedFrames ?? null,
    captureTimestampCoveragePercent,
    futureToleratedCaptureTimestampPercent,
    interactionToRenderCoveragePercent,
    arrivalGapP95Ms: report.screen.arrivalGap.p95Ms,
    decodeP95Ms: report.screen.decode.p95Ms,
    renderQueueP95Ms: report.screen.renderQueue.p95Ms,
    droppedBeforeDecode: report.screen.droppedBeforeDecode,
    observedMissingFrameIds: report.screen.observedMissingFrameIds,
    decoderHealth,
    // Kept only as a display/serialization compatibility field. Ranking uses
    // decoderHealth.clean and never infers a zero from this legacy observation.
    decoderResetsDuringRun:
      decoderHealth.source === 'run-local'
        ? decoderHealth.resetDelta
        : decoderHealth.legacyResetObservation.value,
    retryCount: attempts.length - 1,
    attempts,
  }
}

try {
  configurations = configurationMatrix(process.argv.slice(2))
} catch (error) {
  failure = benchmarkFailure(error, 'configuration')
}

if (failure === null) {
  try {
    await readJson(`${bridgeOrigin}/health`)
  } catch (error) {
    failure = benchmarkFailure(error, 'preflight')
  }
}

const runnableConfigurations = failure === null ? configurations : []
for (const [index, configuration] of runnableConfigurations.entries()) {
  const attempts = []
  try {
    const parameters = new URLSearchParams({
      durationMs: String(durationMs),
      warmupMs: String(warmupMs),
      targetFps: String(configuration.targetFps),
      encoderProfile: configuration.encoderProfile,
      encoderTuning: configuration.encoderTuning,
      decoderMode: configuration.decoderMode,
      captureShortEdge: String(configuration.captureShortEdge),
    })
    let acceptedBenchmark = null

    for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex += 1) {
      const started = await startBenchmarkWhenReady(
        parameters,
        retryReadinessTimeoutMs,
      )
      const attempt = {
        attempt: attemptIndex + 1,
        runId: started.runId,
        warmupMs: started.warmupMs,
        durationMs: started.durationMs,
        browserConfigId: started.browserConfigId,
        requestedDecoderMode: started.requestedDecoderMode,
        requestedDecoderAcceleration: started.requestedDecoderAcceleration,
        requestedCaptureShortEdge: started.requestedCaptureShortEdge,
        browserPrepareDurationMs: null,
        outcome: 'running',
        reason: null,
      }
      attempts.push(attempt)
      process.stderr.write(
        `Started ${configuration.targetFps} fps / ${configuration.encoderProfile} / ${configuration.encoderTuning} / ${configuration.decoderMode} / ${configuration.captureShortEdge}px (${started.runId}, attempt ${attemptIndex + 1}/${maximumAttempts})\n`,
      )

      try {
        acceptedBenchmark = await waitForReport(
          started.runId,
          warmupMs + durationMs + 15_000,
        )
        attempt.browserPrepareDurationMs =
          acceptedBenchmark.report.configuration?.parameters
            ?.browserPrepareDurationMs ?? null
        attempt.outcome = 'accepted'
        break
      } catch (error) {
        const events = error?.benchmarkEvents
        const retryable = classifyPreStartPhoneTransportFailure(events)
        attempt.outcome = 'failed'
        attempt.reason = retryable?.reason ?? lastFailureReason(events)

        if (attemptIndex + 1 >= maximumAttempts || retryable === null) throw error

        process.stderr.write(
          `Retrying ${configuration.targetFps} fps / ${configuration.encoderProfile} / ${configuration.encoderTuning} / ${configuration.decoderMode} / ${configuration.captureShortEdge}px after pre-start phone transport failure (${started.runId}: ${retryable.reason}); the retry will use a new runId and full warmup/duration\n`,
        )
        await waitForRetryReadiness(retryReadinessTimeoutMs)
      }
    }

    if (acceptedBenchmark === null) {
      throw new Error('Benchmark retry finished without an accepted report')
    }

    const result = compactResult(configuration, acceptedBenchmark, attempts)
    results.push(result)
    process.stderr.write(
      `Accepted ${index + 1}/${configurations.length}: ${JSON.stringify(result)}\n`,
    )
    await delay(1_000)
  } catch (error) {
    failure = benchmarkFailure(error, 'benchmark', {
      index: index + 1,
      configuration,
      attempts,
    })
    break
  }
}

const ranked = failure === null ? rankEligibleBenchmarkResults(results) : []
const output = buildBenchmarkOutput(results, ranked, failure?.summary ?? null)
const outputText = `${JSON.stringify(output, null, 2)}\n`
process.stdout.write(outputText)
await writeBenchmarkOutput(process.env.BENCHMARK_OUTPUT_PATH, outputText)

if (failure) throw failure.error
