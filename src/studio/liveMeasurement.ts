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
}

export interface MetricSummary {
  samples: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface LiveMeasurementReport {
  schemaVersion: 1
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
  }
  synchronization: {
    screenPoseSkew: MetricSummary
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

function difference(later: number | null, earlier: number | null) {
  if (later === null || earlier === null) return null
  return Math.max(0, later - earlier)
}

export function buildLiveMeasurementReport(
  startedAtMs: number,
  endedAtMs: number,
  frames: FrameMeasurementSample[],
  poses: PoseMeasurementSample[],
  droppedBeforeDecode: number,
): LiveMeasurementReport {
  const durationMs = Math.max(1, endedAtMs - startedAtMs)
  const renderedFrames = frames.filter((frame) => frame.renderedAtMs !== null)
  const decodedFrames = frames.filter((frame) => frame.decodedAtMs !== null)
  const payloadBytes = frames.reduce((sum, frame) => sum + frame.payloadBytes, 0)
  const codecs = new Set(frames.map((frame) => frame.codec))

  return {
    schemaVersion: 1,
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
    },
    synchronization: {
      screenPoseSkew: summarizeMilliseconds(
        frames.map((frame) => frame.poseScreenSkewMs),
      ),
    },
  }
}
