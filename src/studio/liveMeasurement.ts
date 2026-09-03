export interface FrameMeasurementSample {
  frameId: number
  codec: 'jpeg' | 'h264'
  captureAtMacMs: number | null
  callbackAtMacMs: number | null
  encodeStartedAtMacMs: number | null
  encodedAtMacMs: number | null
  bridgeReceivedAtMs: number | null
  bridgeRelayedAtMs: number | null
  browserReceivedAtMs: number
  decodedAtMs: number | null
  renderedAtMs: number | null
  payloadBytes: number
  clockRttMs: number | null
  poseScreenSkewMs: number | null
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

export interface DetailedMetricSummary extends MetricSummary {
  p99Ms: number | null
  averageMs: number | null
}

export interface LiveMeasurementReport {
  schemaVersion: 2
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
    codec: 'jpeg' | 'h264' | 'mixed' | 'unknown'
    receivedFrames: number
    decodedFrames: number
    renderedFrames: number
    droppedBeforeDecode: number
    renderedFps: number
    averagePayloadBytes: number | null
    averageBitrateMbps: number | null
    captureCallback: MetricSummary
    encode: MetricSummary
    phoneToBridge: MetricSummary
    bridgeToBrowser: MetricSummary
    decode: MetricSummary
    renderQueue: MetricSummary
    captureToRender: MetricSummary
  }
  pose: {
    receivedSamples: number
    samplesPerSecond: number
    phoneToBrowser: MetricSummary
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

function difference(later: number | null, earlier: number | null) {
  if (later === null || earlier === null) return null
  return Math.max(0, later - earlier)
}

export function buildLiveMeasurementReport(
  startedAtMs: number,
  endedAtMs: number,
  frames: FrameMeasurementSample[],
  poses: PoseMeasurementSample[],
  renderSamples: PoseRenderMeasurementSample[],
  droppedBeforeDecode: number,
): LiveMeasurementReport {
  const durationMs = Math.max(1, endedAtMs - startedAtMs)
  const renderedFrames = frames.filter((frame) => frame.renderedAtMs !== null)
  const decodedFrames = frames.filter((frame) => frame.decodedAtMs !== null)
  const payloadBytes = frames.reduce((sum, frame) => sum + frame.payloadBytes, 0)
  const codecs = new Set(frames.map((frame) => frame.codec))

  return {
    schemaVersion: 2,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs,
    privacy: 'Timing, dimensions, and byte counts only; no screen pixels.',
    clock: {
      synchronizedFrameSamples: frames.filter(
        (frame) => frame.captureAtMacMs !== null,
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
      codec:
        codecs.size === 0
          ? 'unknown'
          : codecs.size === 1
            ? (codecs.values().next().value ?? 'unknown')
            : 'mixed',
      receivedFrames: frames.length,
      decodedFrames: decodedFrames.length,
      renderedFrames: renderedFrames.length,
      droppedBeforeDecode,
      renderedFps: renderedFrames.length / (durationMs / 1_000),
      averagePayloadBytes: frames.length > 0 ? payloadBytes / frames.length : null,
      averageBitrateMbps: (payloadBytes * 8) / durationMs / 1_000,
      captureCallback: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.callbackAtMacMs, frame.captureAtMacMs),
        ),
      ),
      encode: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.encodedAtMacMs, frame.encodeStartedAtMacMs),
        ),
      ),
      phoneToBridge: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.bridgeReceivedAtMs, frame.encodedAtMacMs),
        ),
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
      renderQueue: summarizeMilliseconds(
        frames.map((frame) => difference(frame.renderedAtMs, frame.decodedAtMs)),
      ),
      captureToRender: summarizeMilliseconds(
        frames.map((frame) =>
          difference(frame.renderedAtMs, frame.captureAtMacMs),
        ),
      ),
    },
    pose: {
      receivedSamples: poses.length,
      samplesPerSecond: poses.length / (durationMs / 1_000),
      phoneToBrowser: summarizeMilliseconds(
        poses.map((pose) =>
          difference(pose.browserReceivedAtMs, pose.sampledAtMacMs),
        ),
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
      pose: poses,
      render: renderSamples,
    },
  }
}
