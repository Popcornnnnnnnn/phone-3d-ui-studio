import { describe, expect, it } from 'vitest'
import {
  buildLiveMeasurementReport,
  calibrateHighResolutionEpochTimestamp,
  conservativeCaptureAtMacMs,
  highResolutionEpochNowMs,
  LIVE_FRAME_BROWSER_PIPELINE_TIMESTAMP_SEMANTICS,
  LIVE_INTERACTION_TO_RENDER_SEMANTICS,
  LIVE_FRAME_RENDER_TIMESTAMP_SEMANTICS,
  snapshotBrowserDecoderHealthCounters,
  summarizeCrossClockMilliseconds,
  summarizeBrowserDecoderHealth,
  summarizeDetailed,
  summarizeGapMilliseconds,
  summarizeInteractionToRender,
  summarizeMilliseconds,
  type FrameMeasurementSample,
  type BrowserDecoderHealthCounters,
} from './liveMeasurement'

function decoderHealthCounters(
  overrides: Partial<BrowserDecoderHealthCounters> = {},
): BrowserDecoderHealthCounters {
  return {
    resets: 0,
    errors: 0,
    resetReasons: {
      queue: 0,
      pending: 0,
      age: 0,
      configuration: 0,
      error: 0,
    },
    formatMismatchDrops: 0,
    ...overrides,
  }
}

function interactionFrame(
  frameId: number,
  captureAtMacMs: number,
  renderedAtMs: number | null,
  overrides: Partial<FrameMeasurementSample> = {},
): FrameMeasurementSample {
  return {
    frameId,
    codec: 'h264',
    captureAtMacMs,
    captureTimestampSource: 'screencapturekit-display-time',
    captureTimestampValid: true,
    captureSampleAgeMs: 2,
    captureContentStatus: 'complete',
    freshContent: true,
    callbackAtMacMs: captureAtMacMs + 2,
    encodeStartedAtMacMs: captureAtMacMs + 3,
    encodedAtMacMs: captureAtMacMs + 4,
    bridgeReceivedAtMs: captureAtMacMs + 5,
    bridgeRelayedAtMs: captureAtMacMs + 6,
    browserReceivedAtMs: captureAtMacMs + 7,
    decodedAtMs: renderedAtMs === null ? null : renderedAtMs - 1,
    renderedAtMs,
    payloadBytes: 1_000,
    clockRttMs: 1,
    poseScreenSkewMs: null,
    ...overrides,
  }
}

describe('live measurement report', () => {
  it('reports only decoder health changes inside the run boundary', () => {
    const afterPrepare = decoderHealthCounters({
      resets: 7,
      errors: 1,
      resetReasons: {
        queue: 2,
        pending: 1,
        age: 1,
        configuration: 2,
        error: 1,
      },
      formatMismatchDrops: 3,
    })
    const afterRun = decoderHealthCounters({
      resets: 11,
      errors: 2,
      resetReasons: {
        queue: 3,
        pending: 2,
        age: 2,
        configuration: 2,
        error: 2,
      },
      formatMismatchDrops: 5,
    })

    // The seven resets (including any deliberate prepare reset) are already
    // in the start snapshot and therefore cannot contaminate the run delta.
    expect(summarizeBrowserDecoderHealth(afterPrepare, afterRun)).toEqual({
      status: 'valid',
      reason: null,
      resetDelta: 4,
      errorDelta: 1,
      resetReasonDeltas: {
        queue: 1,
        pending: 1,
        age: 1,
        configuration: 0,
        error: 1,
      },
      formatMismatchDropDelta: 2,
    })
  })

  it('takes an immutable atomic copy of decoder counters', () => {
    const counters = decoderHealthCounters({
      resets: 2,
      resetReasons: {
        queue: 2,
        pending: 0,
        age: 0,
        configuration: 0,
        error: 0,
      },
    })
    const snapshot = snapshotBrowserDecoderHealthCounters(counters)

    counters.resets = 3
    counters.resetReasons.queue = 3

    expect(snapshot.resets).toBe(2)
    expect(snapshot.resetReasons.queue).toBe(2)
  })

  it('invalidates decoder deltas after a counter epoch regression', () => {
    const started = decoderHealthCounters({
      resets: 10,
      errors: 2,
      resetReasons: {
        queue: 5,
        pending: 1,
        age: 1,
        configuration: 1,
        error: 2,
      },
      formatMismatchDrops: 4,
    })
    const reconnected = decoderHealthCounters({
      resets: 1,
      resetReasons: {
        queue: 1,
        pending: 0,
        age: 0,
        configuration: 0,
        error: 0,
      },
    })

    expect(summarizeBrowserDecoderHealth(started, reconnected)).toEqual({
      status: 'invalid',
      reason: 'counter-regression',
      resetDelta: null,
      errorDelta: null,
      resetReasonDeltas: {
        queue: null,
        pending: null,
        age: null,
        configuration: null,
        error: null,
      },
      formatMismatchDropDelta: null,
    })
  })

  it('marks decoder health unknown when either boundary snapshot is absent', () => {
    expect(
      summarizeBrowserDecoderHealth(null, decoderHealthCounters()),
    ).toMatchObject({
      status: 'unknown',
      reason: 'snapshot-unavailable',
      resetDelta: null,
      formatMismatchDropDelta: null,
    })
  })

  it('anchors monotonic high-resolution time in the epoch domain', () => {
    expect(
      highResolutionEpochNowMs({
        timeOrigin: 1_700_000_000_000.125,
        now: () => 42.375,
      }),
    ).toBe(1_700_000_000_042.5)
  })

  it('keeps sub-millisecond monotonic time but re-anchors after a wall-clock step', () => {
    const started = calibrateHighResolutionEpochTimestamp(10, 1_000, null)
    const advanced = calibrateHighResolutionEpochTimestamp(
      10.5,
      1_001,
      started.anchor,
    )
    const stepped = calibrateHighResolutionEpochTimestamp(
      20,
      1_060,
      advanced.anchor,
    )

    expect(started.timestampMs).toBe(1_000)
    expect(advanced.timestampMs).toBe(1_000.5)
    expect(advanced.anchor).toBe(started.anchor)
    expect(stepped.timestampMs).toBe(1_060)
    expect(stepped.anchor).not.toBe(started.anchor)
  })

  it('keeps a future-tolerated ReplayKit timestamp out of capture latency', () => {
    expect(
      conservativeCaptureAtMacMs({
        captureAtMacMs: 1_005,
        callbackAtMacMs: 1_000,
        captureTimestampSource:
          'replaykit-presentation-timestamp-future-tolerated',
        captureTimestampValid: true,
        captureContentStatus: 'complete',
        freshContent: true,
      }),
    ).toBeNull()
    expect(
      conservativeCaptureAtMacMs({
        captureAtMacMs: 995,
        callbackAtMacMs: 1_000,
        captureTimestampSource: 'replaykit-presentation-timestamp',
        captureTimestampValid: true,
        captureContentStatus: 'complete',
        freshContent: true,
      }),
    ).toBe(995)
    expect(
      conservativeCaptureAtMacMs({
        captureAtMacMs: 1_005,
        callbackAtMacMs: null,
        captureTimestampSource:
          'replaykit-presentation-timestamp-future-tolerated',
        captureTimestampValid: true,
        captureContentStatus: 'complete',
        freshContent: true,
      }),
    ).toBeNull()
  })

  it('requires explicit timestamp validity and a non-empty source', () => {
    const sample = {
      captureAtMacMs: 995,
      callbackAtMacMs: 1_000,
      captureTimestampSource: 'replaykit-presentation-timestamp',
      captureTimestampValid: true as boolean | null,
      captureContentStatus: 'complete' as string | null,
      freshContent: true as boolean | null,
    }

    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        captureTimestampValid: null,
      }),
    ).toBeNull()
    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        captureTimestampSource: '',
      }),
    ).toBeNull()
    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        captureTimestampSource: null,
      }),
    ).toBeNull()
    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        freshContent: null,
      }),
    ).toBeNull()
    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        captureContentStatus: 'unknown',
      }),
    ).toBeNull()
    // An explicitly valid, non-empty future source remains forward-compatible;
    // the protocol parser turns malformed or missing sources into null.
    expect(
      conservativeCaptureAtMacMs({
        ...sample,
        captureTimestampSource: 'future-capture-clock-v3',
      }),
    ).toBe(995)
  })

  it('computes nearest-rank percentiles', () => {
    expect(summarizeMilliseconds([10, 20, 30, 40, 50])).toEqual({
      samples: 5,
      p50Ms: 30,
      p95Ms: 50,
      maxMs: 50,
    })
  })

  it('computes detailed tail metrics for stress diagnostics', () => {
    expect(summarizeDetailed([10, 20, 30, 40, 50])).toEqual({
      samples: 5,
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
      maxMs: 50,
      averageMs: 30,
    })
  })

  it('analytically weights interaction latency by covered capture duration', () => {
    const summary = summarizeInteractionToRender(
      [
        interactionFrame(1, 0, 10),
        interactionFrame(2, 10, 20),
        interactionFrame(3, 30, 40),
      ],
      0,
      30,
    )

    expect(summary).toEqual({
      semantics: LIVE_INTERACTION_TO_RENDER_SEMANTICS,
      samples: 2,
      runDurationMs: 30,
      coveredDurationMs: 30,
      rightCensoredDurationMs: 0,
      coveragePercent: 100,
      p50Ms: 17.5,
      p95Ms: 28.5,
      p99Ms: 29.7,
      maxMs: 30,
      averageMs: 55 / 3,
    })
  })

  it('charges dropped and unrendered frames to the next rendered response', () => {
    const summary = summarizeInteractionToRender(
      [
        interactionFrame(1, 0, 10),
        interactionFrame(2, 10, null),
        interactionFrame(3, 20, null),
        interactionFrame(4, 30, 40),
      ],
      0,
      30,
    )

    expect(summary).toEqual({
      semantics: LIVE_INTERACTION_TO_RENDER_SEMANTICS,
      samples: 1,
      runDurationMs: 30,
      coveredDurationMs: 30,
      rightCensoredDurationMs: 0,
      coveragePercent: 100,
      p50Ms: 25,
      p95Ms: 38.5,
      p99Ms: 39.7,
      maxMs: 40,
      averageMs: 25,
    })
  })

  it('strictly excludes invalid, future, and non-monotonic timestamps', () => {
    const summary = summarizeInteractionToRender(
      [
        interactionFrame(1, 0, 10),
        interactionFrame(2, 10, 20, {
          captureTimestampSource:
            'replaykit-presentation-timestamp-future-tolerated',
        }),
        interactionFrame(3, 20, 30),
        interactionFrame(4, 15, 31),
        interactionFrame(5, 25, 35, { callbackAtMacMs: 24 }),
        interactionFrame(6, 27, 37, { captureSampleAgeMs: -1 }),
        interactionFrame(7, 28, 38, { captureTimestampValid: false }),
        interactionFrame(8, 29, 39, { captureSampleAgeMs: Number.NaN }),
        interactionFrame(9, 30, 40),
      ],
      0,
      30,
    )

    expect(summary).toMatchObject({
      samples: 2,
      runDurationMs: 30,
      coveredDurationMs: 30,
      rightCensoredDurationMs: 0,
      coveragePercent: 100,
      p50Ms: 17.5,
      p95Ms: 28.5,
      maxMs: 30,
    })
  })

  it('returns explicit right-censoring when no interval is answered', () => {
    expect(
      summarizeInteractionToRender([interactionFrame(1, 0, 10)], 0, 10),
    ).toEqual({
      semantics: LIVE_INTERACTION_TO_RENDER_SEMANTICS,
      samples: 0,
      runDurationMs: 10,
      coveredDurationMs: 0,
      rightCensoredDurationMs: 10,
      coveragePercent: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      averageMs: null,
    })
  })

  it('includes run start through the first rendered capture and keeps the tail censored', () => {
    const summary = summarizeInteractionToRender(
      [interactionFrame(1, 10, 20)],
      0,
      20,
    )

    expect(summary).toMatchObject({
      samples: 1,
      runDurationMs: 20,
      coveredDurationMs: 10,
      rightCensoredDurationMs: 10,
      coveragePercent: 50,
      p50Ms: 15,
      p95Ms: 19.5,
      maxMs: 20,
      averageMs: 15,
    })
  })

  it('counts only gaps strictly over the stall thresholds', () => {
    expect(summarizeGapMilliseconds([50, 100, 150, 200, 250])).toEqual({
      samples: 5,
      p50Ms: 150,
      p95Ms: 250,
      p99Ms: 250,
      maxMs: 250,
      averageMs: 150,
      over100MsCount: 3,
      over200MsCount: 1,
    })
  })

  it('rejects material cross-clock negatives while tolerating rounding noise', () => {
    expect(
      summarizeCrossClockMilliseconds([-12.5, -0.5, 4, null], 1),
    ).toEqual({
      samples: 2,
      p50Ms: 0,
      p95Ms: 4,
      maxMs: 4,
      observedSamples: 3,
      missingSamples: 1,
      toleratedNegativeSamples: 1,
      invalidNegativeSamples: 1,
      minimumObservedMs: -12.5,
      negativeToleranceMs: 1,
    })
  })

  it('keeps pixels out and separates latency stages', () => {
    const frame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'jpeg',
      captureAtMacMs: 1_000,
      captureTimestampSource: 'replaykit-presentation-timestamp',
      captureTimestampValid: true,
      captureSampleAgeMs: 4,
      captureContentStatus: 'complete',
      freshContent: true,
      callbackAtMacMs: 1_004,
      conversionStartedAtMacMs: 1_004,
      conversionEndedAtMacMs: 1_007,
      encodeStartedAtMacMs: 1_007,
      encodedAtMacMs: 1_025,
      bridgeReceivedAtMs: 1_035,
      bridgeRelayedAtMs: 1_036,
      browserReceivedAtMs: 1_041,
      decodedAtMs: 1_050,
      renderRequestedAtMs: 1_051,
      renderSchedulerGeneration: 3,
      r3fFrameObservedAtMs: 1_058,
      textureUploadCompletedAtMs: 1_061,
      renderedAtMs: 1_066,
      payloadBytes: 100_000,
      clockRttMs: 4,
      poseScreenSkewMs: 7,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [frame],
      [],
      [],
      0,
    )

    expect(report.screen.captureToRender.p50Ms).toBe(66)
    expect(report.screen.callbackToRenderLowerBound.p50Ms).toBe(62)
    expect(report.screen.renderTimestampSemantics).toBe(
      LIVE_FRAME_RENDER_TIMESTAMP_SEMANTICS,
    )
    expect(report.screen.browserPipelineTimestampSemantics).toBe(
      LIVE_FRAME_BROWSER_PIPELINE_TIMESTAMP_SEMANTICS,
    )
    expect(report.screen.decoderOutputToR3fFrameObserved.p50Ms).toBe(8)
    expect(report.screen.renderRequestToR3fFrameObserved.p50Ms).toBe(7)
    expect(report.screen.renderRequestToRenderSubmitted.p50Ms).toBe(15)
    expect(report.screen.r3fFrameObservedToTextureUpload.p50Ms).toBe(3)
    expect(report.screen.textureUploadToRenderSubmitted.p50Ms).toBe(5)
    expect(report.screen.decoderOutputToTextureUpload.p50Ms).toBe(11)
    expect(report.screen.renderQueue.p50Ms).toBe(16)
    expect(report.screen.encode.p50Ms).toBe(18)
    expect(report.screen.conversion.p50Ms).toBe(3)
    expect(report.screen.invalidCaptureTimestampSamples).toBe(0)
    expect(report.screen.captureTimestamp).toEqual({
      renderedFrames: 1,
      usableSamples: 1,
      coveragePercent: 100,
      futureToleratedSamples: 0,
      futureToleratedPercent: 0,
      observedSampleAgeSamples: 1,
      negativeSampleAgeSamples: 0,
      minimumSampleAgeMs: 4,
      maximumSampleAgeMs: 4,
    })
    expect(report.screen.averageBitrateMbps).toBe(0.8)
    expect(report.schemaVersion).toBe(3)
    expect(report.raw.frames).toEqual([frame])
    expect(JSON.stringify(report)).not.toContain('pixelData')
  })

  it('excludes callback fallbacks from capture-to-render latency', () => {
    const frame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'h264',
      captureAtMacMs: null,
      captureTimestampSource: 'callback-fallback',
      captureTimestampValid: false,
      captureSampleAgeMs: -75,
      captureContentStatus: 'missing',
      freshContent: false,
      callbackAtMacMs: 1_000,
      encodeStartedAtMacMs: 1_003,
      encodedAtMacMs: 1_010,
      bridgeReceivedAtMs: 1_012,
      bridgeRelayedAtMs: 1_013,
      browserReceivedAtMs: 1_015,
      decodedAtMs: 1_018,
      renderedAtMs: 1_020,
      payloadBytes: 4_096,
      clockRttMs: 2,
      poseScreenSkewMs: null,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [frame],
      [],
      [],
      0,
    )

    expect(report.screen.captureToRender.samples).toBe(0)
    expect(report.screen.callbackToRenderLowerBound).toMatchObject({
      samples: 1,
      p50Ms: 20,
    })
    expect(report.screen.invalidCaptureTimestampSamples).toBe(1)
    expect(report.screen.captureTimestamp).toMatchObject({
      renderedFrames: 0,
      usableSamples: 0,
      coveragePercent: 0,
      futureToleratedSamples: 0,
      negativeSampleAgeSamples: 1,
      minimumSampleAgeMs: -75,
      maximumSampleAgeMs: -75,
    })
    expect(report.clock.synchronizedFrameSamples).toBe(0)
  })

  it('counts rendered but stale or unverified content outside fresh FPS', () => {
    const frame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'h264',
      captureAtMacMs: 1_000,
      captureTimestampSource: 'screencapturekit-display-time',
      captureTimestampValid: true,
      captureSampleAgeMs: 2,
      captureContentStatus: 'unknown',
      freshContent: false,
      callbackAtMacMs: 1_002,
      encodeStartedAtMacMs: 1_003,
      encodedAtMacMs: 1_004,
      bridgeReceivedAtMs: 1_005,
      bridgeRelayedAtMs: 1_006,
      browserReceivedAtMs: 1_007,
      decodedAtMs: 1_008,
      renderedAtMs: 1_009,
      payloadBytes: 100,
      clockRttMs: 1,
      poseScreenSkewMs: null,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [frame],
      [],
      [],
      0,
    )

    expect(report.screen.renderedFrames).toBe(1)
    expect(report.screen.renderedFps).toBe(1)
    expect(report.screen.freshRenderedFrames).toBe(0)
    expect(report.screen.freshRenderedFps).toBe(0)
    expect(report.screen.captureToRender.samples).toBe(0)
    expect(report.screen.callbackToRenderLowerBound.samples).toBe(1)
  })

  it('reports future-tolerated PTS coverage without hiding signed age', () => {
    const frame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'h264',
      captureAtMacMs: 1_005,
      captureTimestampSource:
        'replaykit-presentation-timestamp-future-tolerated',
      captureTimestampValid: true,
      captureSampleAgeMs: -5,
      captureContentStatus: 'complete',
      freshContent: true,
      callbackAtMacMs: 1_000,
      encodeStartedAtMacMs: 1_003,
      encodedAtMacMs: 1_010,
      bridgeReceivedAtMs: 1_012,
      bridgeRelayedAtMs: 1_013,
      browserReceivedAtMs: 1_015,
      decodedAtMs: 1_018,
      renderedAtMs: 1_020,
      payloadBytes: 4_096,
      clockRttMs: 2,
      poseScreenSkewMs: null,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [frame],
      [],
      [],
      0,
    )

    expect(report.screen.captureToRender).toMatchObject({
      samples: 0,
      p50Ms: null,
      invalidNegativeSamples: 0,
    })
    expect(report.screen.captureCallback.p50Ms).toBeNull()
    expect(report.screen.callbackToRenderLowerBound.p50Ms).toBe(20)
    expect(report.screen.captureTimestamp).toEqual({
      renderedFrames: 1,
      usableSamples: 0,
      coveragePercent: 0,
      futureToleratedSamples: 1,
      futureToleratedPercent: 100,
      observedSampleAgeSamples: 1,
      negativeSampleAgeSamples: 1,
      minimumSampleAgeMs: -5,
      maximumSampleAgeMs: -5,
    })
  })

  it('records benchmark identity, configuration, and invalid clock samples', () => {
    const invalidFrame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'h264',
      captureAtMacMs: 1_000,
      callbackAtMacMs: 1_004,
      encodeStartedAtMacMs: 1_005,
      encodedAtMacMs: 1_025,
      bridgeReceivedAtMs: 1_012.5,
      bridgeRelayedAtMs: 1_013,
      browserReceivedAtMs: 1_018,
      decodedAtMs: 1_020,
      renderedAtMs: 1_040,
      payloadBytes: 4_096,
      clockRttMs: 12,
      poseScreenSkewMs: 2,
    }
    const validFrame: FrameMeasurementSample = {
      ...invalidFrame,
      frameId: 2,
      encodedAtMacMs: 1_100,
      bridgeReceivedAtMs: 1_105,
      bridgeRelayedAtMs: 1_106,
      browserReceivedAtMs: 1_110,
      decodedAtMs: 1_112,
      renderedAtMs: 1_120,
    }
    const configuration = {
      fingerprint: 'sha256:benchmark-config',
      parameters: {
        transport: 'h264-websocket',
        width: 960,
        targetFps: 20,
        lowLatency: true,
      },
    }
    const renderScheduler = {
      mode: 'phase' as const,
      generationStart: 3,
      generationEnd: 3,
      generationStable: true,
      capHz: 120,
      phaseCreditFrames: 1,
      visibleAtStart: true,
      visibleAtEnd: true,
      advancesDelta: 120,
      eventAdvancesDelta: 55,
      cadenceAdvancesDelta: 65,
      wakeupAdvancesDelta: 0,
      cadenceSkipsForPhaseShiftDelta: 55,
      rateLimitedAttemptsDelta: 12,
      coalescedVideoFramesDelta: 2,
      visibilityInterruptionsDelta: 0,
      maximumAdvanceDepth: 1,
    }

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [invalidFrame, validFrame],
      [],
      [],
      0,
      {
        runId: 'run-001',
        configuration,
        renderScheduler,
        decoderHealth: summarizeBrowserDecoderHealth(
          decoderHealthCounters({ resets: 5 }),
          decoderHealthCounters({
            resets: 6,
            resetReasons: {
              queue: 1,
              pending: 0,
              age: 0,
              configuration: 0,
              error: 0,
            },
          }),
        ),
      },
    )

    expect(report.runId).toBe('run-001')
    expect(report.configuration).toEqual(configuration)
    expect(report.renderScheduler).toEqual(renderScheduler)
    expect(report.screen.decoderHealth).toEqual({
      status: 'valid',
      reason: null,
      resetDelta: 1,
      errorDelta: 0,
      resetReasonDeltas: {
        queue: 1,
        pending: 0,
        age: 0,
        configuration: 0,
        error: 0,
      },
      formatMismatchDropDelta: 0,
    })
    expect(
      JSON.parse(JSON.stringify(report)).screen.decoderHealth,
    ).toEqual(report.screen.decoderHealth)
    expect(report.screen.phoneToBridge).toMatchObject({
      samples: 1,
      p50Ms: 5,
      invalidNegativeSamples: 1,
      toleratedNegativeSamples: 0,
      minimumObservedMs: -12.5,
    })
    expect(report.raw.frames).toEqual([invalidFrame, validFrame])
  })

  it('reports screen cadence stalls and auditable consecutive frame loss', () => {
    const baseFrame: FrameMeasurementSample = {
      frameId: 1,
      codec: 'h264',
      captureAtMacMs: null,
      callbackAtMacMs: null,
      encodeStartedAtMacMs: null,
      encodedAtMacMs: null,
      bridgeReceivedAtMs: null,
      bridgeRelayedAtMs: null,
      browserReceivedAtMs: 1_000,
      decodedAtMs: 1_010,
      renderedAtMs: 1_020,
      payloadBytes: 1_000,
      clockRttMs: null,
      poseScreenSkewMs: null,
    }
    const frames: FrameMeasurementSample[] = [
      baseFrame,
      {
        ...baseFrame,
        frameId: 2,
        browserReceivedAtMs: 1_050,
        decodedAtMs: null,
        renderedAtMs: null,
      },
      {
        ...baseFrame,
        frameId: 5,
        browserReceivedAtMs: 1_200,
        decodedAtMs: null,
        renderedAtMs: null,
      },
      {
        ...baseFrame,
        frameId: 6,
        browserReceivedAtMs: 1_450,
        decodedAtMs: 1_460,
        renderedAtMs: 1_470,
      },
    ]

    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      frames,
      [],
      [],
      2,
    )

    expect(report.schemaVersion).toBe(3)
    expect(report.screen.arrivalGap).toMatchObject({
      samples: 3,
      p95Ms: 250,
      p99Ms: 250,
      maxMs: 250,
      over100MsCount: 2,
      over200MsCount: 1,
    })
    expect(report.screen.outputGap).toMatchObject({
      samples: 1,
      p95Ms: 450,
      p99Ms: 450,
      maxMs: 450,
      over100MsCount: 1,
      over200MsCount: 1,
    })
    expect(report.screen.renderGap).toMatchObject({
      samples: 1,
      p95Ms: 450,
      p99Ms: 450,
      maxMs: 450,
      over100MsCount: 1,
      over200MsCount: 1,
    })
    expect(report.screen.longestConsecutiveUndecodedFrames).toBe(2)
    expect(report.screen.longestConsecutiveUnrenderedFrames).toBe(2)
    expect(report.screen.observedMissingFrameIds).toBe(2)
    expect(report.screen.longestConsecutiveMissingFrameIds).toBe(2)
  })

  it('records pose and render tail behavior for a stress run', () => {
    const report = buildLiveMeasurementReport(
      1_000,
      2_000,
      [],
      [
        {
          sampledAtMacMs: 1_010,
          bridgeReceivedAtMs: 1_014,
          bridgeRelayedAtMs: 1_015,
          browserReceivedAtMs: 1_020,
          clockRttMs: 2,
          arrivalGapMs: 10,
          sensorIntervalMs: 10,
          angularSpeedDegreesPerSecond: 720,
          predictionCorrectionDegrees: 1.25,
        },
      ],
      [
        {
          renderedAtMs: 1_025,
          frameIntervalMs: 16.7,
          sampleAgeMs: 15,
          predictionMs: 23,
          angularSpeedDegreesPerSecond: 720,
          predictionCapped: false,
        },
        {
          renderedAtMs: 1_055,
          frameIntervalMs: 30,
          sampleAgeMs: 45,
          predictionMs: 30,
          angularSpeedDegreesPerSecond: 900,
          predictionCapped: true,
        },
      ],
      0,
    )

    expect(report.pose.predictionCorrectionDegrees.maxMs).toBe(1.25)
    expect(report.render.frameInterval.maxMs).toBe(30)
    expect(report.render.sampleAge.maxMs).toBe(45)
    expect(report.render.predictionCapHitPercent).toBe(50)
    expect(report.raw.render).toHaveLength(2)
  })
})
