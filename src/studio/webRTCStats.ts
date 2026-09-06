export interface WebRTCReceiverSample {
  codecMimeType: string | null
  timestampMs: number
  bytesReceived: number
  framesDecoded: number
  framesDropped: number
  framesPerSecond: number | null
  packetsReceived: number
  packetsLost: number
  jitterBufferDelaySeconds: number
  jitterBufferEmittedCount: number
  jitterBufferMinimumDelaySeconds: number | null
  jitterBufferTargetDelaySeconds: number | null
  totalDecodeTimeSeconds: number
  roundTripTimeSeconds: number | null
}

export interface WebRTCReceiverMetrics {
  bitrateMbps: number | null
  decodeMs: number | null
  estimatedPipelineMs: number | null
  fps: number | null
  framesDropped: number
  jitterBufferMs: number | null
  jitterBufferMinimumMs: number | null
  jitterBufferTargetMs: number | null
  packetLossPercent: number | null
  roundTripMs: number | null
}

export function rollingDecodedFps(
  samples: WebRTCReceiverSample[],
): number | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last) return null
  const elapsedMs = last.timestampMs - first.timestampMs
  const frameDelta = last.framesDecoded - first.framesDecoded
  if (elapsedMs <= 0 || frameDelta < 0) return null
  return (frameDelta * 1_000) / elapsedMs
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordType(record: Record<string, unknown>) {
  return typeof record.type === 'string' ? record.type : ''
}

export function readWebRTCReceiverSample(
  stats: RTCStatsReport,
): WebRTCReceiverSample | null {
  const records: Array<Record<string, unknown>> = []
  stats.forEach((value) => {
    records.push(value as unknown as Record<string, unknown>)
  })

  const inbound = records.find(
    (record) =>
      recordType(record) === 'inbound-rtp' &&
      (record.kind === 'video' || record.mediaType === 'video'),
  )
  if (!inbound) return null

  const transport = records.find(
    (record) => recordType(record) === 'transport',
  )
  const selectedPairId =
    typeof transport?.selectedCandidatePairId === 'string'
      ? transport.selectedCandidatePairId
      : null
  const candidatePair =
    records.find((record) => record.id === selectedPairId) ??
    records.find(
      (record) =>
        recordType(record) === 'candidate-pair' &&
        record.state === 'succeeded' &&
        record.nominated === true,
    )
  const codecId = typeof inbound.codecId === 'string' ? inbound.codecId : null
  const codec = codecId
    ? records.find((record) => record.id === codecId)
    : undefined

  return {
    codecMimeType:
      codec && recordType(codec) === 'codec' && typeof codec.mimeType === 'string'
        ? codec.mimeType
        : null,
    timestampMs: finiteNumber(inbound.timestamp, performance.now()),
    bytesReceived: finiteNumber(inbound.bytesReceived),
    framesDecoded: finiteNumber(inbound.framesDecoded),
    framesDropped: finiteNumber(inbound.framesDropped),
    framesPerSecond: optionalFiniteNumber(inbound.framesPerSecond),
    packetsReceived: finiteNumber(inbound.packetsReceived),
    packetsLost: finiteNumber(inbound.packetsLost),
    jitterBufferDelaySeconds: finiteNumber(inbound.jitterBufferDelay),
    jitterBufferEmittedCount: finiteNumber(inbound.jitterBufferEmittedCount),
    jitterBufferMinimumDelaySeconds: optionalFiniteNumber(
      inbound.jitterBufferMinimumDelay,
    ),
    jitterBufferTargetDelaySeconds: optionalFiniteNumber(
      inbound.jitterBufferTargetDelay,
    ),
    totalDecodeTimeSeconds: finiteNumber(inbound.totalDecodeTime),
    roundTripTimeSeconds: optionalFiniteNumber(
      candidatePair?.currentRoundTripTime,
    ),
  }
}

function intervalAverage(
  currentTotal: number,
  previousTotal: number,
  currentCount: number,
  previousCount: number,
) {
  const countDelta = currentCount - previousCount
  const totalDelta = currentTotal - previousTotal
  if (countDelta <= 0 || totalDelta < 0) return null
  return totalDelta / countDelta
}

export function deriveWebRTCReceiverMetrics(
  current: WebRTCReceiverSample,
  previous: WebRTCReceiverSample | null,
): WebRTCReceiverMetrics {
  const elapsedMs = previous ? current.timestampMs - previous.timestampMs : 0
  const byteDelta = previous ? current.bytesReceived - previous.bytesReceived : 0
  const frameDelta = previous ? current.framesDecoded - previous.framesDecoded : 0

  const jitterSeconds = previous
    ? intervalAverage(
        current.jitterBufferDelaySeconds,
        previous.jitterBufferDelaySeconds,
        current.jitterBufferEmittedCount,
        previous.jitterBufferEmittedCount,
      )
    : current.jitterBufferEmittedCount > 0
      ? current.jitterBufferDelaySeconds / current.jitterBufferEmittedCount
      : null
  const decodeSeconds = previous
    ? intervalAverage(
        current.totalDecodeTimeSeconds,
        previous.totalDecodeTimeSeconds,
        current.framesDecoded,
        previous.framesDecoded,
      )
    : current.framesDecoded > 0
      ? current.totalDecodeTimeSeconds / current.framesDecoded
      : null
  const minimumDelaySeconds = previous
    ? current.jitterBufferMinimumDelaySeconds === null ||
      previous.jitterBufferMinimumDelaySeconds === null
      ? null
      : intervalAverage(
          current.jitterBufferMinimumDelaySeconds,
          previous.jitterBufferMinimumDelaySeconds,
          current.jitterBufferEmittedCount,
          previous.jitterBufferEmittedCount,
        )
    : current.jitterBufferMinimumDelaySeconds === null ||
        current.jitterBufferEmittedCount <= 0
      ? null
      : current.jitterBufferMinimumDelaySeconds /
        current.jitterBufferEmittedCount
  const targetDelaySeconds = previous
    ? current.jitterBufferTargetDelaySeconds === null ||
      previous.jitterBufferTargetDelaySeconds === null
      ? null
      : intervalAverage(
          current.jitterBufferTargetDelaySeconds,
          previous.jitterBufferTargetDelaySeconds,
          current.jitterBufferEmittedCount,
          previous.jitterBufferEmittedCount,
        )
    : current.jitterBufferTargetDelaySeconds === null ||
        current.jitterBufferEmittedCount <= 0
      ? null
      : current.jitterBufferTargetDelaySeconds /
        current.jitterBufferEmittedCount
  const roundTripMs =
    current.roundTripTimeSeconds === null
      ? null
      : current.roundTripTimeSeconds * 1_000
  const jitterBufferMs = jitterSeconds === null ? null : jitterSeconds * 1_000
  const decodeMs = decodeSeconds === null ? null : decodeSeconds * 1_000
  const receivedPackets = current.packetsReceived + current.packetsLost

  return {
    bitrateMbps:
      elapsedMs > 0 && byteDelta >= 0
        ? (byteDelta * 8) / elapsedMs / 1_000
        : null,
    decodeMs,
    estimatedPipelineMs:
      jitterBufferMs === null || decodeMs === null
        ? null
        : jitterBufferMs + decodeMs + (roundTripMs ?? 0) / 2,
    fps:
      current.framesPerSecond ??
      (elapsedMs > 0 && frameDelta >= 0 ? (frameDelta * 1_000) / elapsedMs : null),
    framesDropped: current.framesDropped,
    jitterBufferMs,
    jitterBufferMinimumMs:
      minimumDelaySeconds === null ? null : minimumDelaySeconds * 1_000,
    jitterBufferTargetMs:
      targetDelaySeconds === null ? null : targetDelaySeconds * 1_000,
    packetLossPercent:
      receivedPackets > 0 ? (current.packetsLost / receivedPackets) * 100 : null,
    roundTripMs,
  }
}
