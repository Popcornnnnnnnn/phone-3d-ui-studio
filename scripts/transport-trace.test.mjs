import { describe, expect, it } from 'vitest'
import { rawACKTiming, summarizeTransportTrace, TransportTraceStore } from './transport-trace.mjs'

describe('metadata-only transport trace', () => {
  const batch = (samples, through, acknowledged = 0, discarded = 0, generation = 1) => ({
    producerSessionId: 'phone', frameTransportTraceVersion: 2,
    frameTransportTraceThroughRevision: through, frameTransportTraceAcknowledgedRevision: acknowledged,
    frameTransportTraceDiscardedThroughRevision: discarded, frameTransportTraceExportGeneration: generation,
    frameTransportTraceSamples: samples,
  })
  const sample = (sequence, revision, timings = {}) => ({ sequence, revision, frameId: sequence,
    generation: 1, outcome: 'ack', ackPath: 'raw', timings })
  it('ACKs revision batches and empty heartbeats without re-retaining delivered records', () => {
    const store = new TransportTraceStore()
    const message = batch([sample(2, 1, { ackMs: 12 })], 1)
    expect(store.append(message, 100)).toEqual({ type: 'frame-transport-trace-ack',
      producerSessionId: 'phone', throughRevision: 1, exportGeneration: 1 })
    store.append(message, 101) // ACK loss: retry the same batch.
    store.append(batch([], 1, 1), 102)
    expect(store.after().records).toHaveLength(1)
    store.append(batch([sample(1, 2, { ackMs: 20 })], 2, 1), 103) // Reordered frame ACK.
    expect(summarizeTransportTrace(store.after().records).acknowledgedFrames).toBe(2)
  })
  it('updates late send completion once without counting a frame twice', () => {
    const store = new TransportTraceStore(3)
    store.append(batch([sample(1, 1, { ackMs: 20 })], 1), 100)
    store.append(batch([sample(1, 2, { ackMs: 20, sendCompletionMs: 0.5 })], 2, 1), 101)
    // Eviction of an older revision must not forget a newer retained one.
    store.bridgeACK({ producerSessionId: 'phone', frameId: 3 }, {}, 102)
    store.bridgeACK({ producerSessionId: 'phone', frameId: 4 }, {}, 103)
    store.append(batch([sample(1, 2, { ackMs: 20, sendCompletionMs: 0.5 })], 2, 1), 104)
    const summary = summarizeTransportTrace(store.after().records)
    expect(summary.acknowledgedFrames).toBe(1)
    expect(summary.phases.sendCompletionMs.p50Ms).toBe(0.5)
  })
  it('refuses malformed or incomplete batches before ACK or retention', () => {
    for (const message of [batch([sample(1, 2)], 1), batch([], 2), batch([sample(1, 1)], 1, 2),
      batch([sample(1, 1), sample(1, 2)], 2), batch([sample(1, 1), sample(2, 1)], 1),
      batch([sample(1, 1)], 1, 0, 2), batch(Array.from({ length: 129 }, (_, i) => sample(i + 1, i + 1)), 129)]) {
      const store = new TransportTraceStore()
      expect(store.append(message, 100)).toBeUndefined()
      expect(store.after().records).toHaveLength(0)
    }
  })
  it('records bounded offline loss explicitly and only once per export generation', () => {
    const store = new TransportTraceStore()
    const message = batch([sample(3, 3)], 3, 0, 2)
    expect(store.append(message, 100)?.throughRevision).toBe(3)
    store.append(message, 101)
    expect(summarizeTransportTrace(store.after().records).phoneTraceGapEvents).toBe(1)
    store.append(batch([], 3, 3, 2), 102)
    expect(summarizeTransportTrace(store.after().records).phoneTraceGapEvents).toBe(1)
  })
  it('separates same-host read, dispatch, and processing intervals', () => {
    expect(rawACKTiming({ startedAt: 10, completedAt: 40 }, 41, 42)).toEqual({
      bridgeReadSpanMs: 30, bridgeDispatchMs: 1, bridgeProcessingMs: 1,
    })
  })
  it('deduplicates repeated phone rings, preserves failure samples and bounds memory', () => {
    const store = new TransportTraceStore(2)
    const message = { producerSessionId: 'phone', frameTransportTraceVersion: 1,
      frameTransportTraceSamples: [1, 2].map((sequence) => ({ sequence, frameId: sequence, generation: 1,
        outcome: sequence === 1 ? 'ack' : 'frame-ack-hard-timeout', timings: { ackMs: 12, bad: NaN } })) }
    store.append(message, 100)
    store.append(message, 101)
    expect(store.after().records).toHaveLength(2)
    expect(store.after(1).records[0].outcome).toBe('frame-ack-hard-timeout')
    expect(store.after().records[0].timings).toEqual({ ackMs: 12 })
    store.append({ ...message, frameTransportTraceSamples: [{ sequence: 3, frameId: 3, generation: 2, outcome: 'ack' }] }, 102)
    expect(store.after().records.map((record) => record.sequence)).toEqual([2, 3])
  })
  it('does not let unacknowledged failures disappear into successful RTT percentiles', () => {
    const store = new TransportTraceStore()
    store.bridgeACK({ producerSessionId: 'phone', frameId: 2 }, { bridgeProcessingMs: 0.1 }, 100)
    store.append({ producerSessionId: 'phone', frameTransportTraceVersion: 1,
      frameTransportTraceSamples: [
        { sequence: 1, frameId: 1, generation: 1, outcome: 'ack', ackPath: 'raw', timings: { ackMs: 20 } },
        { sequence: 2, frameId: 2, generation: 1, outcome: 'frame-ack-hard-timeout', timings: { unfinishedMs: 600 } },
      ] }, 101)
    const summary = summarizeTransportTrace(store.after().records)
    expect(summary.acknowledgedFrames).toBe(1)
    expect(summary.failedFrames).toBe(1)
    expect(summary.failedWithBridgeACKIssued).toBe(1)
    expect(summary.phases.ackMs).toEqual({ samples: 1, p50Ms: 20, p95Ms: 20, maxMs: 20 })
    expect(summary.slowest[0].timings.unfinishedMs).toBe(600)
    expect(summary.phases.forwardEstimateMs.samples).toBe(0)
  })
})
