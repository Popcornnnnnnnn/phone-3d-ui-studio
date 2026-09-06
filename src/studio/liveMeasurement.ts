export interface FrameMeasurementSample {
  frameId: number
  codec: 'jpeg' | 'h264'
  producerSessionId?: string | null
  captureSource?: string | null
  captureAtMacMs: number | null
  captureTimestampSource?: string | null
  captureTimestampValid?: boolean | null
  captureSampleAgeMs?: number | null
  captureContentStatus?: string | null
  freshContent?: boolean | null
  callbackAtMacMs: number | null
  conversionStartedAtMacMs?: number | null
  conversionEndedAtMacMs?: number | null
  encodeStartedAtMacMs: number | null
  encodedAtMacMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
  browserReceivedAtMs: number
  decodedAtMs: number | null
  // Epoch-domain time at which the decoded frame requested an R3F render.
  renderRequestedAtMs?: number | null
  renderSchedulerGeneration?: number | null
  // High-resolution epoch timestamp captured in R3F's update phase, before
  // gl.render() for the frame that first observes this decoded image.
  r3fFrameObservedAtMs?: number | null
  // CPU timestamp after Three.js has returned from the VideoFrame texture
  // upload call. This is not GPU completion or compositor presentation.
  textureUploadCompletedAtMs?: number | null
  // CPU-side R3F after-render submission time; not compositor or photon time.
  renderedAtMs: number | null
  payloadBytes: number
  clockRttMs: number | null
  poseScreenSkewMs: number | null
}

export function captureContentIsVerifiedFresh(
  frame: Pick<
    FrameMeasurementSample,
    'captureContentStatus' | 'freshContent'
  >,
) {
  return (
    frame.freshContent === true &&
    (frame.captureContentStatus === 'complete' ||
      frame.captureContentStatus === 'started')
  )
}

export function conservativeCaptureAtMacMs(
  frame: Pick<
    FrameMeasurementSample,
    | 'captureAtMacMs'
    | 'callbackAtMacMs'
    | 'captureTimestampSource'
    | 'captureTimestampValid'
    | 'captureContentStatus'
    | 'freshContent'
  >,
) {
  if (
    !captureContentIsVerifiedFresh(frame) ||
    frame.captureTimestampValid !== true ||
    typeof frame.captureTimestampSource !== 'string' ||
    frame.captureTimestampSource.trim().length === 0 ||
    frame.captureAtMacMs === null ||
    !Number.isFinite(frame.captureAtMacMs)
  ) {
    return null
  }

  if (
    frame.captureTimestampSource ===
    'replaykit-presentation-timestamp-future-tolerated'
  ) {
    // A future presentation timestamp is not capture evidence. Keep the
    // callback-to-render lower bound, but do not relabel it as capture latency.
    return null
  }

  return frame.captureAtMacMs
}

export interface PoseMeasurementSample {
  sampledAtMacMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
  browserReceivedAtMs: number
  clockRttMs: number | null
  arrivalGapMs: number | null
  sensorIntervalMs: number | null
  angularSpeedDegreesPerSecond: number | null
  predictionCorrectionDegrees: number | null
}

export interface PoseRenderMeasurementSample {
  renderedAtMs: number
  frameIntervalMs: number
  sampleAgeMs: number | null
  predictionMs: number | null
  angularSpeedDegreesPerSecond: number | null
  predictionCapped: boolean
}

export interface MetricSummary {
  samples: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface CrossClockMetricSummary extends MetricSummary {
  // `samples` counts only values accepted into the percentile summary.
  observedSamples: number
  missingSamples: number
  toleratedNegativeSamples: number
  invalidNegativeSamples: number
  minimumObservedMs: number | null
  negativeToleranceMs: number
}

export interface DetailedMetricSummary extends MetricSummary {
  p99Ms: number | null
  averageMs: number | null
}

export interface InteractionToRenderMetricSummary
  extends DetailedMetricSummary {
  semantics: typeof LIVE_INTERACTION_TO_RENDER_SEMANTICS
  // `samples` is the number of accepted capture intervals. Each interval is
  // weighted by its duration rather than counted as one equally likely event.
  runDurationMs: number
  coveredDurationMs: number
  // Inputs after the final successfully rendered capture have no observed
  // response inside the run, so they remain right-censored.
  rightCensoredDurationMs: number
  coveragePercent: number
}

export interface GapMetricSummary extends DetailedMetricSummary {
  over100MsCount: number
  over200MsCount: number
}

export type MeasurementConfigurationValue = string | number | boolean | null

export const BROWSER_DECODER_RESET_REASONS = [
  'queue',
  'pending',
  'age',
  'configuration',
  'error',
] as const

export type BrowserDecoderResetReason =
  (typeof BROWSER_DECODER_RESET_REASONS)[number]

export interface BrowserDecoderHealthCounters {
  resets: number
  errors: number
  resetReasons: Record<BrowserDecoderResetReason, number>
  formatMismatchDrops: number
}

export interface BrowserDecoderHealth {
  status: 'valid' | 'invalid' | 'unknown'
  reason:
    | 'counter-regression'
    | 'invalid-counter'
    | 'snapshot-unavailable'
    | null
  resetDelta: number | null
  errorDelta: number | null
  resetReasonDeltas: Record<BrowserDecoderResetReason, number | null>
  formatMismatchDropDelta: number | null
}

const nullBrowserDecoderResetReasonDeltas = () => ({
  queue: null,
  pending: null,
  age: null,
  configuration: null,
  error: null,
})

function unavailableBrowserDecoderHealth(
  status: 'invalid' | 'unknown',
  reason: Exclude<BrowserDecoderHealth['reason'], null>,
): BrowserDecoderHealth {
  return {
    status,
    reason,
    resetDelta: null,
    errorDelta: null,
    resetReasonDeltas: nullBrowserDecoderResetReasonDeltas(),
    formatMismatchDropDelta: null,
  }
}

export function snapshotBrowserDecoderHealthCounters(
  counters: BrowserDecoderHealthCounters,
): BrowserDecoderHealthCounters {
  return {
    resets: counters.resets,
    errors: counters.errors,
    resetReasons: { ...counters.resetReasons },
    formatMismatchDrops: counters.formatMismatchDrops,
  }
}

export function summarizeBrowserDecoderHealth(
  started: BrowserDecoderHealthCounters | null,
  ended: BrowserDecoderHealthCounters | null,
): BrowserDecoderHealth {
  if (!started || !ended) {
    return unavailableBrowserDecoderHealth('unknown', 'snapshot-unavailable')
  }

  const counterPairs = [
    [started.resets, ended.resets],
    [started.errors, ended.errors],
    [started.formatMismatchDrops, ended.formatMismatchDrops],
    ...BROWSER_DECODER_RESET_REASONS.map((reason) => [
      started.resetReasons[reason],
      ended.resetReasons[reason],
    ]),
  ] as const

  if (
    counterPairs.some(([start, end]) =>
      [start, end].some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      ),
    )
  ) {
    return unavailableBrowserDecoderHealth('invalid', 'invalid-counter')
  }
  if (counterPairs.some(([start, end]) => end < start)) {
    // A reconnect or counter reset changes the counter epoch. Returning zeros
    // here would falsely claim a healthy run, so invalidate the whole delta.
    return unavailableBrowserDecoderHealth('invalid', 'counter-regression')
  }

  return {
    status: 'valid',
    reason: null,
    resetDelta: ended.resets - started.resets,
    errorDelta: ended.errors - started.errors,
    resetReasonDeltas: {
      queue: ended.resetReasons.queue - started.resetReasons.queue,
      pending: ended.resetReasons.pending - started.resetReasons.pending,
      age: ended.resetReasons.age - started.resetReasons.age,
      configuration:
        ended.resetReasons.configuration -
        started.resetReasons.configuration,
      error: ended.resetReasons.error - started.resetReasons.error,
    },
    formatMismatchDropDelta:
      ended.formatMismatchDrops - started.formatMismatchDrops,
  }
}

export interface MeasurementConfigurationFingerprint {
  // The caller supplies a stable digest of the exact parameters below.
  fingerprint: string
  parameters: Record<string, MeasurementConfigurationValue>
}

export interface LiveMeasurementReportOptions {
  runId?: string
  configuration?: MeasurementConfigurationFingerprint
  decoderHealth?: BrowserDecoderHealth
  renderScheduler?: LiveRenderSchedulerRunSummary
  crossClockNegativeToleranceMs?: number
}

export interface LiveRenderSchedulerRunSummary {
  mode: 'vsync' | 'phase'
  generationStart: number
  generationEnd: number
  generationStable: boolean
  capHz: number | null
  phaseCreditFrames: number
  visibleAtStart: boolean
  visibleAtEnd: boolean
  advancesDelta: number | null
  eventAdvancesDelta: number | null
  cadenceAdvancesDelta: number | null
  wakeupAdvancesDelta: number | null
  cadenceSkipsForPhaseShiftDelta: number | null
  rateLimitedAttemptsDelta: number | null
  coalescedVideoFramesDelta: number | null
  visibilityInterruptionsDelta: number | null
  maximumAdvanceDepth: number
}

export const LIVE_FRAME_RENDER_TIMESTAMP_SEMANTICS =
  'CPU-side R3F after-render submission; not compositor presentation or photon time.' as const
export const LIVE_FRAME_BROWSER_PIPELINE_TIMESTAMP_SEMANTICS =
  'High-resolution monotonic timestamps anchored to the current Date.now() wall-clock domain and re-anchored after a wall-clock step; texture upload completion means the CPU-side upload call returned, not GPU or compositor completion.' as const
export const LIVE_INTERACTION_TO_RENDER_SEMANTICS =
  'Input time is uniformly distributed from the run start and over each interval between fresh frames with strictly increasing valid capture timestamps, and is answered by the next successfully rendered fresh frame. Intervals are weighted by duration, so dropped or unrendered frames extend the wait. Time after the final successfully rendered capture has no observed response and is reported as right-censored rather than included in percentiles. The endpoint is CPU-side R3F render submission, not compositor presentation or photon time.' as const

interface HighResolutionEpochClock {
  timeOrigin: number
  now: () => number
}

export interface HighResolutionEpochAnchor {
  monotonicMs: number
  wallMs: number
}

export function calibrateHighResolutionEpochTimestamp(
  monotonicMs: number,
  wallMs: number,
  anchor: HighResolutionEpochAnchor | null,
  maximumWallDriftMs = 5,
) {
  const projectedWallMs = anchor
    ? anchor.wallMs + monotonicMs - anchor.monotonicMs
    : Number.NaN
  const nextAnchor =
    anchor === null ||
    !Number.isFinite(projectedWallMs) ||
    Math.abs(projectedWallMs - wallMs) > maximumWallDriftMs
      ? { monotonicMs, wallMs }
      : anchor
  return {
    timestampMs:
      nextAnchor.wallMs + monotonicMs - nextAnchor.monotonicMs,
    anchor: nextAnchor,
  }
}

let defaultHighResolutionEpochAnchor: HighResolutionEpochAnchor | null = null

export function highResolutionEpochNowMs(
  clock?: HighResolutionEpochClock,
) {
  if (clock) return clock.timeOrigin + clock.now()

  const monotonicMs = globalThis.performance.now()
  const calibrated = calibrateHighResolutionEpochTimestamp(
    monotonicMs,
    Date.now(),
    defaultHighResolutionEpochAnchor,
  )
  defaultHighResolutionEpochAnchor = calibrated.anchor
  return calibrated.timestampMs
}

export interface LiveMeasurementReport {
  schemaVersion: 3
  runId?: string
  configuration?: MeasurementConfigurationFingerprint
  renderScheduler?: LiveRenderSchedulerRunSummary
  startedAt: string
  endedAt: string
  durationMs: number
  privacy: 'Timing, dimensions, and byte counts only; no screen pixels.'
  clock: {
    synchronizedFrameSamples: number
    synchronizedPoseSamples: number
    rtt: MetricSummary
  }
  screen: {
    renderTimestampSemantics: typeof LIVE_FRAME_RENDER_TIMESTAMP_SEMANTICS
    browserPipelineTimestampSemantics: typeof LIVE_FRAME_BROWSER_PIPELINE_TIMESTAMP_SEMANTICS
    codec: 'jpeg' | 'h264' | 'mixed' | 'unknown'
    receivedFrames: number
    decodedFrames: number
    renderedFrames: number
    freshRenderedFrames: number
    droppedBeforeDecode: number
    decoderHealth: BrowserDecoderHealth
    renderedFps: number
    freshRenderedFps: number
    averagePayloadBytes: number | null
    averageBitrateMbps: number | null
    arrivalGap: GapMetricSummary
    outputGap: GapMetricSummary
    renderGap: GapMetricSummary
    longestConsecutiveUndecodedFrames: number
    longestConsecutiveUnrenderedFrames: number
    observedMissingFrameIds: number
    longestConsecutiveMissingFrameIds: number
    captureCallback: MetricSummary
    conversion: MetricSummary
    invalidCaptureTimestampSamples: number
    captureTimestamp: {
      renderedFrames: number
      usableSamples: number
      coveragePercent: number
      futureToleratedSamples: number
      futureToleratedPercent: number
      observedSampleAgeSamples: number
      negativeSampleAgeSamples: number
      minimumSampleAgeMs: number | null
      maximumSampleAgeMs: number | null
    }
    encode: MetricSummary
    phoneToBridge: CrossClockMetricSummary
    bridgeToBrowser: MetricSummary
    decode: MetricSummary
    renderRequestToR3fFrameObserved: MetricSummary
    renderRequestToRenderSubmitted: MetricSummary
    decoderOutputToR3fFrameObserved: MetricSummary
    r3fFrameObservedToTextureUpload: MetricSummary
    textureUploadToRenderSubmitted: MetricSummary
    decoderOutputToTextureUpload: MetricSummary
    renderQueue: MetricSummary
    callbackToRenderLowerBound: CrossClockMetricSummary
    captureToRender: CrossClockMetricSummary
    interactionToRender: InteractionToRenderMetricSummary
  }
  pose: {
    receivedSamples: number
    samplesPerSecond: number
    phoneToBrowser: CrossClockMetricSummary
    arrivalGap: DetailedMetricSummary
    sensorInterval: DetailedMetricSummary
    angularSpeedDegreesPerSecond: DetailedMetricSummary
    predictionCorrectionDegrees: DetailedMetricSummary
  }
  render: {
    receivedSamples: number
    samplesPerSecond: number
    frameInterval: DetailedMetricSummary
    sampleAge: DetailedMetricSummary
    prediction: DetailedMetricSummary
    predictionCapHits: number
    predictionCapHitPercent: number
  }
  synchronization: {
    screenPoseSkew: MetricSummary
  }
  raw: {
    frames: FrameMeasurementSample[]
    pose: PoseMeasurementSample[]
    render: PoseRenderMeasurementSample[]
  }
}

function finiteValues(values: Array<number | null>) {
  return values.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  )
}

function percentile(sortedValues: number[], fraction: number) {
  if (sortedValues.length === 0) return null
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1),
  )
  return sortedValues[index]
}

interface InteractionLatencyInterval {
  minimumMs: number
  maximumMs: number
  durationMs: number
}

function interactionPercentile(
  intervals: InteractionLatencyInterval[],
  coveredDurationMs: number,
  fraction: number,
) {
  if (intervals.length === 0 || coveredDurationMs <= 0) return null
  if (fraction >= 1) {
    return Math.max(...intervals.map((interval) => interval.maximumMs))
  }

  const events = intervals
    .flatMap((interval) => [
      { latencyMs: interval.minimumMs, densityDelta: 1 },
      { latencyMs: interval.maximumMs, densityDelta: -1 },
    ])
    .sort((left, right) => left.latencyMs - right.latencyMs)
  const targetDurationMs = coveredDurationMs * fraction
  let accumulatedDurationMs = 0
  let activeDensity = 0
  let previousLatencyMs = events[0].latencyMs
  let index = 0

  while (index < events.length) {
    const latencyMs = events[index].latencyMs
    if (latencyMs > previousLatencyMs && activeDensity > 0) {
      const intervalMassMs =
        (latencyMs - previousLatencyMs) * activeDensity
      if (accumulatedDurationMs + intervalMassMs >= targetDurationMs) {
        return (
          previousLatencyMs +
          (targetDurationMs - accumulatedDurationMs) / activeDensity
        )
      }
      accumulatedDurationMs += intervalMassMs
    }

    while (index < events.length && events[index].latencyMs === latencyMs) {
      activeDensity += events[index].densityDelta
      index += 1
    }
    previousLatencyMs = latencyMs
  }

  return Math.max(...intervals.map((interval) => interval.maximumMs))
}

function strictInteractionCaptureAtMacMs(frame: FrameMeasurementSample) {
  const captureAtMacMs = conservativeCaptureAtMacMs(frame)
  const callbackAtMacMs = frame.callbackAtMacMs
  const captureSampleAgeMs = frame.captureSampleAgeMs
  if (
    captureAtMacMs === null ||
    callbackAtMacMs === null ||
    !Number.isFinite(callbackAtMacMs) ||
    captureAtMacMs > callbackAtMacMs ||
    (typeof captureSampleAgeMs === 'number' &&
      (!Number.isFinite(captureSampleAgeMs) || captureSampleAgeMs < 0))
  ) {
    return null
  }
  return { captureAtMacMs, callbackAtMacMs }
}

export function summarizeInteractionToRender(
  frames: FrameMeasurementSample[],
  startedAtMs: number,
  endedAtMs: number,
): InteractionToRenderMetricSummary {
  const runDurationMs = Math.max(0, endedAtMs - startedAtMs)
  const intervals: InteractionLatencyInterval[] = []
  let lastObservedCaptureAtMs: number | null = null
  let previousRenderedPoint: {
    captureAtMacMs: number
    renderedAtMs: number
  } | null = null

  for (const frame of frames) {
    const capturePoint = strictInteractionCaptureAtMacMs(frame)
    if (capturePoint === null) continue
    const { captureAtMacMs, callbackAtMacMs } = capturePoint
    if (
      (lastObservedCaptureAtMs !== null &&
        captureAtMacMs <= lastObservedCaptureAtMs)
    ) {
      continue
    }
    lastObservedCaptureAtMs = captureAtMacMs

    const renderedAtMs = frame.renderedAtMs
    if (
      renderedAtMs === null ||
      !Number.isFinite(renderedAtMs) ||
      renderedAtMs < callbackAtMacMs ||
      renderedAtMs < captureAtMacMs ||
      (previousRenderedPoint !== null &&
        renderedAtMs <= previousRenderedPoint.renderedAtMs)
    ) {
      continue
    }

    const intervalStartedAtMs = Math.max(
      startedAtMs,
      previousRenderedPoint?.captureAtMacMs ?? startedAtMs,
    )
    const intervalEndedAtMs = Math.min(captureAtMacMs, endedAtMs)
    if (intervalEndedAtMs > intervalStartedAtMs) {
      const durationMs = intervalEndedAtMs - intervalStartedAtMs
      intervals.push({
        minimumMs: renderedAtMs - intervalEndedAtMs,
        maximumMs: renderedAtMs - intervalStartedAtMs,
        durationMs,
      })
    }
    previousRenderedPoint = { captureAtMacMs, renderedAtMs }
  }

  const coveredDurationMs = intervals.reduce(
    (sum, interval) => sum + interval.durationMs,
    0,
  )
  const boundedCoveredDurationMs = Math.min(runDurationMs, coveredDurationMs)
  const rightCensoredDurationMs = Math.max(
    0,
    runDurationMs - boundedCoveredDurationMs,
  )
  const maximumMs =
    intervals.length === 0
      ? null
      : Math.max(...intervals.map((interval) => interval.maximumMs))
  const averageMs =
    coveredDurationMs <= 0
      ? null
      : intervals.reduce(
          (sum, interval) =>
            sum +
            interval.durationMs *
              ((interval.minimumMs + interval.maximumMs) / 2),
          0,
        ) / coveredDurationMs

  return {
    semantics: LIVE_INTERACTION_TO_RENDER_SEMANTICS,
    samples: intervals.length,
    runDurationMs,
    coveredDurationMs: boundedCoveredDurationMs,
    rightCensoredDurationMs,
    coveragePercent:
      runDurationMs === 0 ? 0 : (boundedCoveredDurationMs / runDurationMs) * 100,
    p50Ms: interactionPercentile(intervals, coveredDurationMs, 0.5),
    p95Ms: interactionPercentile(intervals, coveredDurationMs, 0.95),
    p99Ms: interactionPercentile(intervals, coveredDurationMs, 0.99),
    maxMs: maximumMs,
    averageMs,
  }
}

export function summarizeMilliseconds(
  values: Array<number | null>,
): MetricSummary {
  const sorted = finiteValues(values).sort((left, right) => left - right)
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? null,
  }
}

export function summarizeDetailed(
  values: Array<number | null>,
): DetailedMetricSummary {
  const sorted = finiteValues(values).sort((left, right) => left - right)
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1) ?? null,
    averageMs:
      sorted.length === 0
        ? null
        : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  }
}

export function summarizeGapMilliseconds(
  values: Array<number | null>,
): GapMetricSummary {
  const valid = finiteValues(values)
  return {
    ...summarizeDetailed(valid),
    over100MsCount: valid.filter((value) => value > 100).length,
    over200MsCount: valid.filter((value) => value > 200).length,
  }
}

function summarizeEventGaps(
  timestamps: Array<number | null>,
): GapMetricSummary {
  const sorted = finiteValues(timestamps).sort((left, right) => left - right)
  return summarizeGapMilliseconds(
    sorted.slice(1).map((timestamp, index) => timestamp - sorted[index]),
  )
}

function framesInArrivalOrder(frames: FrameMeasurementSample[]) {
  return frames
    .map((frame, index) => ({ frame, index }))
    .sort(
      (left, right) =>
        left.frame.browserReceivedAtMs - right.frame.browserReceivedAtMs ||
        left.frame.frameId - right.frame.frameId ||
        left.index - right.index,
    )
    .map(({ frame }) => frame)
}

function longestConsecutiveFrames(
  frames: FrameMeasurementSample[],
  predicate: (frame: FrameMeasurementSample) => boolean,
) {
  let current = 0
  let longest = 0
  for (const frame of frames) {
    current = predicate(frame) ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

function summarizeMissingFrameIds(frames: FrameMeasurementSample[]) {
  let previousFrameId: number | null = null
  let observedMissingFrameIds = 0
  let longestConsecutiveMissingFrameIds = 0

  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 0) continue
    if (previousFrameId !== null && frame.frameId > previousFrameId) {
      const missing = frame.frameId - previousFrameId - 1
      observedMissingFrameIds += missing
      longestConsecutiveMissingFrameIds = Math.max(
        longestConsecutiveMissingFrameIds,
        missing,
      )
    }
    // A non-increasing ID is treated as a stream reset, not a giant gap.
    previousFrameId = frame.frameId
  }

  return { observedMissingFrameIds, longestConsecutiveMissingFrameIds }
}

export function summarizeCrossClockMilliseconds(
  values: Array<number | null>,
  negativeToleranceMs = 1,
): CrossClockMetricSummary {
  const tolerance =
    Number.isFinite(negativeToleranceMs) && negativeToleranceMs >= 0
      ? negativeToleranceMs
      : 1
  const observed = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )
  const invalidNegativeSamples = observed.filter(
    (value) => value < -tolerance,
  ).length
  const toleratedNegativeSamples = observed.filter(
    (value) => value < 0 && value >= -tolerance,
  ).length
  const valid = observed
    .filter((value) => value >= -tolerance)
    .map((value) => (value < 0 ? 0 : value))
  const summary = summarizeMilliseconds(valid)

  return {
    ...summary,
    observedSamples: observed.length,
    missingSamples: values.length - observed.length,
    toleratedNegativeSamples,
    invalidNegativeSamples,
    minimumObservedMs:
      observed.length === 0 ? null : Math.min(...observed),
    negativeToleranceMs: tolerance,
  }
}

function difference(
  later: number | null | undefined,
  earlier: number | null | undefined,
) {
  if (later === null || later === undefined || earlier === null || earlier === undefined) {
    return null
  }
  return later - earlier
}

export function buildLiveMeasurementReport(
  startedAtMs: number,
  endedAtMs: number,
  frames: FrameMeasurementSample[],
  poses: PoseMeasurementSample[],
  renderSamples: PoseRenderMeasurementSample[],
  droppedBeforeDecode: number,
  options: LiveMeasurementReportOptions = {},
): LiveMeasurementReport {
  const durationMs = Math.max(1, endedAtMs - startedAtMs)
  const renderedFrames = frames.filter((frame) => frame.renderedAtMs !== null)
  const freshRenderedFrames = renderedFrames.filter(
    captureContentIsVerifiedFresh,
  )
  const decodedFrames = frames.filter((frame) => frame.decodedAtMs !== null)
  const payloadBytes = frames.reduce((sum, frame) => sum + frame.payloadBytes, 0)
  const codecs = new Set(frames.map((frame) => frame.codec))
  const arrivalOrderedFrames = framesInArrivalOrder(frames)
  const missingFrameIds = summarizeMissingFrameIds(arrivalOrderedFrames)
  const crossClockNegativeToleranceMs =
    options.crossClockNegativeToleranceMs ?? 1
  const captureToRender = summarizeCrossClockMilliseconds(
    frames.map((frame) =>
      difference(frame.renderedAtMs, conservativeCaptureAtMacMs(frame)),
    ),
    crossClockNegativeToleranceMs,
  )
  const callbackToRenderLowerBound = summarizeCrossClockMilliseconds(
    frames.map((frame) =>
      difference(frame.renderedAtMs, frame.callbackAtMacMs),
    ),
    crossClockNegativeToleranceMs,
  )
  const futureToleratedSamples = freshRenderedFrames.filter(
    (frame) =>
      frame.captureTimestampSource ===
      'replaykit-presentation-timestamp-future-tolerated',
  ).length
  const captureSampleAges = frames
    .map((frame) => frame.captureSampleAgeMs)
    .filter(
      (value): value is number =>
        value !== null && value !== undefined && Number.isFinite(value),
    )

  return {
    schemaVersion: 3,
    runId: options.runId,
    configuration: options.configuration
      ? {
          fingerprint: options.configuration.fingerprint,
          parameters: { ...options.configuration.parameters },
        }
      : undefined,
    renderScheduler: options.renderScheduler
      ? { ...options.renderScheduler }
      : undefined,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs,
    privacy: 'Timing, dimensions, and byte counts only; no screen pixels.',
    clock: {
      synchronizedFrameSamples: frames.filter(
        (frame) => conservativeCaptureAtMacMs(frame) !== null,
      ).length,
      synchronizedPoseSamples: poses.filter(
        (pose) => pose.sampledAtMacMs !== null,
      ).length,
      rtt: summarizeMilliseconds([
        ...frames.map((frame) => frame.clockRttMs),
        ...poses.map((pose) => pose.clockRttMs),
      ]),
    },
    screen: {
      renderTimestampSemantics: LIVE_FRAME_RENDER_TIMESTAMP_SEMANTICS,
      browserPipelineTimestampSemantics:
        LIVE_FRAME_BROWSER_PIPELINE_TIMESTAMP_SEMANTICS,
      codec:
        codecs.size === 0
          ? 'unknown'
          : codecs.size === 1
            ? (codecs.values().next().value ?? 'unknown')
            : 'mixed',
      receivedFrames: frames.length,
      decodedFrames: decodedFrames.length,
      renderedFrames: renderedFrames.length,
      freshRenderedFrames: freshRenderedFrames.length,
      droppedBeforeDecode,
      decoderHealth:
        options.decoderHealth ??
        unavailableBrowserDecoderHealth('unknown', 'snapshot-unavailable'),
      renderedFps: renderedFrames.length / (durationMs / 1_000),
      freshRenderedFps: freshRenderedFrames.length / (durationMs / 1_000),
      averagePayloadBytes: frames.length > 0 ? payloadBytes / frames.length : null,
      averageBitrateMbps: (payloadBytes * 8) / durationMs / 1_000,
      arrivalGap: summarizeEventGaps(
        frames.map((frame) => frame.browserReceivedAtMs),
      ),
      outputGap: summarizeEventGaps(
        frames.map((frame) => frame.decodedAtMs),
      ),
      renderGap: summarizeEventGaps(
        frames.map((frame) => frame.renderedAtMs),
      ),
      longestConsecutiveUndecodedFrames: longestConsecutiveFrames(
        arrivalOrderedFrames,
        (frame) => frame.decodedAtMs === null,
      ),
      longestConsecutiveUnrenderedFrames: longestConsecutiveFrames(
        arrivalOrderedFrames,
        (frame) => frame.renderedAtMs === null,
      ),
      ...missingFrameIds,
      captureCallback: summarizeMilliseconds(
        frames.map((frame) =>
          difference(
            frame.callbackAtMacMs,
            conservativeCaptureAtMacMs(frame),
          ),
        ),
      ),
      conversion: summarizeMilliseconds(
        frames.map((frame) =>
          difference(
            frame.conversionEndedAtMacMs ?? null,
            frame.conversionStartedAtMacMs ?? null,
          ),
        ),
      ),
      invalidCaptureTimestampSamples: frames.filter(
        (frame) => frame.captureTimestampValid === false,
      ).length,
      captureTimestamp: {
        renderedFrames: freshRenderedFrames.length,
        usableSamples: captureToRender.samples,
        coveragePercent:
          freshRenderedFrames.length === 0
            ? 0
            : (captureToRender.samples / freshRenderedFrames.length) * 100,
        futureToleratedSamples,
        futureToleratedPercent:
          freshRenderedFrames.length === 0
            ? 0
            : (futureToleratedSamples / freshRenderedFrames.length) * 100,
        observedSampleAgeSamples: captureSampleAges.length,
        negativeSampleAgeSamples: captureSampleAges.filter(
          (value) => value < 0,
        ).length,
        minimumSampleAgeMs:
          captureSampleAges.length === 0 ? null : Math.min(...captureSampleAges),
        maximumSampleAgeMs:
          captureSampleAges.length === 0 ? null : Math.max(...captureSampleAges),
      },
      encode: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.encodedAtMacMs, frame.encodeStartedAtMacMs),
        ),
      ),
      phoneToBridge: summarizeCrossClockMilliseconds(
        frames.map((frame) =>
          difference(frame.bridgeReceivedAtMs, frame.encodedAtMacMs),
        ),
        crossClockNegativeToleranceMs,
      ),
      bridgeToBrowser: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.browserReceivedAtMs, frame.bridgeRelayedAtMs),
        ),
      ),
      decode: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.decodedAtMs, frame.browserReceivedAtMs),
        ),
      ),
      renderRequestToR3fFrameObserved: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.r3fFrameObservedAtMs, frame.renderRequestedAtMs),
        ),
      ),
      renderRequestToRenderSubmitted: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.renderedAtMs, frame.renderRequestedAtMs),
        ),
      ),
      decoderOutputToR3fFrameObserved: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.r3fFrameObservedAtMs, frame.decodedAtMs),
        ),
      ),
      r3fFrameObservedToTextureUpload: summarizeMilliseconds(
        frames.map((frame) =>
          difference(
            frame.textureUploadCompletedAtMs,
            frame.r3fFrameObservedAtMs,
          ),
        ),
      ),
      textureUploadToRenderSubmitted: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.renderedAtMs, frame.textureUploadCompletedAtMs),
        ),
      ),
      decoderOutputToTextureUpload: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.textureUploadCompletedAtMs, frame.decodedAtMs),
        ),
      ),
      renderQueue: summarizeMilliseconds(
        frames.map((frame) => difference(frame.renderedAtMs, frame.decodedAtMs)),
      ),
      callbackToRenderLowerBound,
      captureToRender,
      interactionToRender: summarizeInteractionToRender(
        frames,
        startedAtMs,
        endedAtMs,
      ),
    },
    pose: {
      receivedSamples: poses.length,
      samplesPerSecond: poses.length / (durationMs / 1_000),
      phoneToBrowser: summarizeCrossClockMilliseconds(
        poses.map((pose) =>
          difference(pose.browserReceivedAtMs, pose.sampledAtMacMs),
        ),
        crossClockNegativeToleranceMs,
      ),
      arrivalGap: summarizeDetailed(poses.map((pose) => pose.arrivalGapMs)),
      sensorInterval: summarizeDetailed(
        poses.map((pose) => pose.sensorIntervalMs),
      ),
      angularSpeedDegreesPerSecond: summarizeDetailed(
        poses.map((pose) => pose.angularSpeedDegreesPerSecond),
      ),
      predictionCorrectionDegrees: summarizeDetailed(
        poses.map((pose) => pose.predictionCorrectionDegrees),
      ),
    },
    render: {
      receivedSamples: renderSamples.length,
      samplesPerSecond: renderSamples.length / (durationMs / 1_000),
      frameInterval: summarizeDetailed(
        renderSamples.map((sample) => sample.frameIntervalMs),
      ),
      sampleAge: summarizeDetailed(
        renderSamples.map((sample) => sample.sampleAgeMs),
      ),
      prediction: summarizeDetailed(
        renderSamples.map((sample) => sample.predictionMs),
      ),
      predictionCapHits: renderSamples.filter(
        (sample) => sample.predictionCapped,
      ).length,
      predictionCapHitPercent:
        renderSamples.length === 0
          ? 0
          : (renderSamples.filter((sample) => sample.predictionCapped).length /
              renderSamples.length) *
            100,
    },
    synchronization: {
      screenPoseSkew: summarizeMilliseconds(
        frames.map((frame) => frame.poseScreenSkewMs),
      ),
    },
    raw: {
      frames,
      pose: poses,
      render: renderSamples,
    },
  }
}
