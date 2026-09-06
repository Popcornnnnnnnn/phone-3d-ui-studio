// Metadata only. Kept out of the normal /diagnostics history to avoid
// repeatedly serializing the same 128-frame phone ring hundreds of times.
export class TransportTraceStore {
  constructor(capacity = 2048) { this.capacity = capacity; this.records = []; this.seen = new Map(); this.cursor = 0 }
  retain(record) {
    this.records.push({ ...record, cursor: ++this.cursor })
    if (this.records.length > this.capacity) {
      const removed = this.records.shift()
      if (this.seen.get(removed.key) === removed.revision) this.seen.delete(removed.key)
    }
  }
  bridgeACK(metadata, timings, now) {
    if (typeof metadata.producerSessionId !== 'string' || !Number.isSafeInteger(metadata.frameId)) return
    this.retain({ kind: 'bridge-ack-issued', producerSessionId: metadata.producerSessionId,
      frameId: metadata.frameId, timings, bridgeCollectedAtMs: now })
  }
  append(message, now) {
    if (![1, 2].includes(message.frameTransportTraceVersion) || typeof message.producerSessionId !== 'string' ||
        message.producerSessionId.length > 128 || !Array.isArray(message.frameTransportTraceSamples)) return
    const incremental = message.frameTransportTraceVersion === 2
    const through = message.frameTransportTraceThroughRevision
    const acknowledged = message.frameTransportTraceAcknowledgedRevision
    const discarded = message.frameTransportTraceDiscardedThroughRevision
    const generation = message.frameTransportTraceExportGeneration
    // Validate the whole v2 batch before ACKing it. Malformed/truncated input
    // must never advance the phone's delivery cursor and hide missing evidence.
    if (incremental && (![through, acknowledged, discarded, generation].every((value) =>
      Number.isSafeInteger(value) && value >= 0) || acknowledged > through || discarded > through ||
      message.frameTransportTraceSamples.length > 128 || message.frameTransportTraceSamples.some((sample) =>
        !sample || !Number.isSafeInteger(sample.revision) || sample.revision <= acknowledged || sample.revision > through ||
        !Number.isSafeInteger(sample.sequence) || !Number.isSafeInteger(sample.frameId) ||
        !Number.isSafeInteger(sample.generation) || typeof sample.outcome !== 'string' || sample.outcome.length > 160))) return
    if (incremental && (new Set(message.frameTransportTraceSamples.map((sample) => sample.sequence)).size !== message.frameTransportTraceSamples.length ||
      new Set(message.frameTransportTraceSamples.map((sample) => sample.revision)).size !== message.frameTransportTraceSamples.length ||
      (through > acknowledged && through > discarded && !message.frameTransportTraceSamples.some((sample) => sample.revision === through)))) return
    if (incremental && discarded > acknowledged) {
      const key = `${message.producerSessionId}:gap:${generation}:${discarded}`
      if (!this.seen.has(key)) {
        this.seen.set(key, discarded)
        this.retain({ kind: 'phone-trace-gap', key, revision: discarded,
          producerSessionId: message.producerSessionId, exportGeneration: generation,
          acknowledgedRevision: acknowledged, discardedThroughRevision: discarded, bridgeCollectedAtMs: now })
      }
    }
    for (const sample of message.frameTransportTraceSamples.slice(-128)) {
      if (!sample || !Number.isSafeInteger(sample.sequence) || !Number.isSafeInteger(sample.frameId) ||
          !Number.isSafeInteger(sample.generation) || typeof sample.outcome !== 'string' || sample.outcome.length > 160) continue
      const key = `${message.producerSessionId}:${sample.sequence}`
      const revision = incremental ? sample.revision : 0
      if ((this.seen.get(key) ?? -1) >= revision) continue
      const timings = Object.fromEntries(Object.entries(sample.timings ?? {}).slice(0, 24)
        .filter(([key, value]) => key.length < 64 && Number.isFinite(value)))
      this.seen.set(key, revision)
      this.retain({ kind: 'phone-frame', key, revision, producerSessionId: message.producerSessionId,
        frameId: sample.frameId, generation: sample.generation, sequence: sample.sequence,
        bytes: Number.isSafeInteger(sample.bytes) ? sample.bytes : null, keyframe: sample.keyframe === true,
        outcome: sample.outcome, ackPath: ['raw', 'pose-fallback'].includes(sample.ackPath) ? sample.ackPath : null,
        timings, bridgeCollectedAtMs: now })
    }
    if (incremental) return { type: 'frame-transport-trace-ack', producerSessionId: message.producerSessionId,
      throughRevision: through, exportGeneration: generation }
  }
  after(cursor = 0) {
    return { cursor: this.cursor, earliestCursor: this.records[0]?.cursor ?? null,
      records: this.records.filter((record) => record.cursor > cursor) }
  }
}

export function rawACKTiming(read, relayStartedAt, issuedAt) {
  return {
    bridgeReadSpanMs: Math.max(0, read.completedAt - read.startedAt),
    bridgeDispatchMs: Math.max(0, relayStartedAt - read.completedAt),
    bridgeProcessingMs: Math.max(0, issuedAt - relayStartedAt),
  }
}

export function summarizeTransportTrace(records) {
  const latest = new Map()
  for (const record of records.filter((record) => record.kind === 'phone-frame')) {
    const key = `${record.producerSessionId}:${record.sequence}`
    if ((record.revision ?? 0) >= (latest.get(key)?.revision ?? -1)) latest.set(key, record)
  }
  const frames = [...latest.values()]
  const bridgeFrames = new Set(records.filter((record) => record.kind === 'bridge-ack-issued')
    .map((record) => `${record.producerSessionId}:${record.frameId}`))
  const acknowledged = frames.filter((frame) => frame.outcome === 'ack')
  const failed = frames.filter((frame) => frame.outcome !== 'ack')
  const stats = (key) => {
    const values = acknowledged.map((frame) => frame.timings[key]).filter(Number.isFinite).sort((a, b) => a - b)
    const percentile = (fraction) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null
    return { samples: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1) ?? null }
  }
  return {
    scope: 'Diagnostic trace includes preparation, warmup, measurement, and a bounded drain; not a ranked benchmark window',
    semantics: 'Phone/bridge intervals are monotonic same-host measurements. Forward/return are clock-quality-gated estimates, include scheduling and stack delays, and are not radio propagation or visible latency. An issued bridge ACK does not prove network delivery.',
    acknowledgedFrames: acknowledged.length, failedFrames: failed.length,
    phoneTraceGapEvents: records.filter((record) => record.kind === 'phone-trace-gap').length,
    failedWithBridgeACKIssued: failed.filter((frame) => bridgeFrames.has(`${frame.producerSessionId}:${frame.frameId}`)).length,
    paths: Object.fromEntries(['raw', 'pose-fallback'].map((path) => [path, acknowledged.filter((frame) => frame.ackPath === path).length])),
    phases: Object.fromEntries(['ackMs', 'sendCompletionMs', 'bridgeReadSpanMs', 'bridgeDispatchMs',
      'bridgeProcessingMs', 'ackReceiveQueueMs', 'outsideBridgeProcessingMs', 'forwardEstimateMs', 'returnEstimateMs']
      .map((key) => [key, stats(key)])),
    slowest: [...frames].sort((a, b) => (b.timings.ackMs ?? b.timings.unfinishedMs ?? 0) -
      (a.timings.ackMs ?? a.timings.unfinishedMs ?? 0)).slice(0, 12).map((frame) => ({ ...frame,
        bridgeACKObserved: bridgeFrames.has(`${frame.producerSessionId}:${frame.frameId}`) })),
  }
}
