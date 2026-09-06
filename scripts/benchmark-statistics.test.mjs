import { describe, expect, it } from 'vitest'
import {
  benchmarkGroupConfiguration,
  rankBenchmarkGroups,
  summarizeBenchmarkGroups,
} from './benchmark-statistics.mjs'

function cleanDecoderHealth(overrides = {}) {
  return {
    source: 'run-local',
    status: 'valid',
    reason: null,
    clean: true,
    resetDelta: 0,
    errorDelta: 0,
    resetReasonDeltas: {
      queue: 0,
      pending: 0,
      age: 0,
      configuration: 0,
      error: 0,
    },
    formatMismatchDropDelta: 0,
    legacyResetObservation: { field: null, value: null },
    ...overrides,
  }
}

function eligibleRun(overrides = {}) {
  return {
    runId: 'run',
    targetFps: 60,
    requestedEncoderProfile: 'legacy',
    requestedEncoderTuning: 'default',
    requestedDecoderMode: 'software',
    requestedCaptureShortEdge: 960,
    requestedBitstreamFormat: 'annex-b',
    renderPreset: 'quality',
    browserConfigGeneration: 1,
    captureStreamGeneration: 1,
    eligibleForRanking: true,
    thermalContaminated: false,
    interactionToRender: {
      samples: 10,
      runDurationMs: 1_000,
      coveredDurationMs: 1_000,
      rightCensoredDurationMs: 0,
      coveragePercent: 100,
      p50Ms: 20,
      p95Ms: 30,
    },
    captureToRenderP95Ms: 25,
    renderedFps: 59,
    droppedBeforeDecode: 0,
    observedMissingFrameIds: 0,
    decoderResetsDuringRun: 0,
    decoderHealth: cleanDecoderHealth(),
    ...overrides,
  }
}

describe('benchmark grouped statistics', () => {
  it('groups by only the seven requested configuration dimensions', () => {
    const results = [
      eligibleRun({
        runId: 'one',
        browserConfigGeneration: 2,
        captureStreamGeneration: 7,
      }),
      eligibleRun({
        runId: 'two',
        browserConfigGeneration: 99,
        captureStreamGeneration: 100,
      }),
      eligibleRun({
        runId: 'three',
        browserConfigGeneration: 200,
        captureStreamGeneration: 201,
      }),
    ]

    const summary = summarizeBenchmarkGroups(results)
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0]).toMatchObject({
      configuration: {
        targetFps: 60,
        profile: 'legacy',
        tuning: 'default',
        decoderMode: 'software',
        captureShortEdge: 960,
        bitstream: 'annex-b',
        renderPreset: 'quality',
      },
      runCount: 3,
      eligibleCount: 3,
      eligibleForRanking: true,
    })
    expect(summary.ranked).toHaveLength(1)
  })

  it.each([
    ['targetFps', { targetFps: 30 }],
    ['profile', { requestedEncoderProfile: 'low-latency' }],
    ['tuning', { requestedEncoderTuning: 'speed-priority' }],
    ['decoderMode', { requestedDecoderMode: 'hardware' }],
    ['captureShortEdge', { requestedCaptureShortEdge: 720 }],
    ['bitstream', { requestedBitstreamFormat: 'avcc' }],
    ['renderPreset', { renderPreset: 'latency' }],
  ])('splits groups when %s changes', (_field, override) => {
    expect(
      summarizeBenchmarkGroups([eligibleRun(), eligibleRun(override)]).groups,
    ).toHaveLength(2)
  })

  it('requires three per-run-eligible samples before publishing a group rank', () => {
    const excluded = eligibleRun({
      runId: 'excluded',
      eligibleForRanking: false,
    })
    const twoEligible = summarizeBenchmarkGroups([
      eligibleRun({ runId: 'one' }),
      eligibleRun({ runId: 'two' }),
      excluded,
    ])

    expect(twoEligible.groups[0]).toMatchObject({
      runCount: 3,
      eligibleCount: 2,
      eligibleForRanking: false,
    })
    expect(twoEligible.ranked).toEqual([])
  })

  it('independently excludes dirty, invalid, unknown, and missing decoder health', () => {
    const dirty = eligibleRun({
      runId: 'dirty',
      decoderHealth: cleanDecoderHealth({ resetDelta: 1, clean: false }),
    })
    const invalid = eligibleRun({
      runId: 'invalid',
      decoderHealth: cleanDecoderHealth({
        status: 'invalid',
        reason: 'counter-regression',
        resetDelta: null,
        errorDelta: null,
        formatMismatchDropDelta: null,
        clean: false,
      }),
    })
    const unknown = eligibleRun({
      runId: 'unknown',
      decoderHealth: cleanDecoderHealth({
        status: 'unknown',
        reason: 'snapshot-unavailable',
        resetDelta: null,
        errorDelta: null,
        formatMismatchDropDelta: null,
        clean: false,
      }),
    })
    const missing = eligibleRun({ runId: 'missing' })
    delete missing.decoderHealth
    const summary = summarizeBenchmarkGroups(
      [eligibleRun({ runId: 'clean' }), dirty, invalid, unknown, missing],
      1,
    ).groups[0]

    expect(summary).toMatchObject({
      runCount: 5,
      eligibleCount: 1,
      eligibleForRanking: true,
      decoderHealth: {
        authority: 'report.screen.decoderHealth',
        cleanRunCount: 1,
        nonCleanRunCount: 4,
        statusCounts: { valid: 2, invalid: 1, unknown: 2 },
        reasonCounts: {
          'compact-decoder-health-missing': 1,
          'counter-regression': 1,
          none: 2,
          'snapshot-unavailable': 1,
        },
      },
    })
    expect(summary.decoderHealth.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'dirty',
          status: 'valid',
          clean: false,
          resetDelta: 1,
        }),
        expect.objectContaining({
          runId: 'invalid',
          status: 'invalid',
          reason: 'counter-regression',
          resetDelta: null,
        }),
        expect.objectContaining({
          runId: 'unknown',
          status: 'unknown',
          reason: 'snapshot-unavailable',
        }),
      ]),
    )
    expect(summary.decoderHealth.resetDelta).toEqual({
      total: 1,
      observedRunCount: 2,
      missingRunCount: 3,
    })
    expect(summary.decoderHealth.errorDelta).toEqual({
      total: 0,
      observedRunCount: 2,
      missingRunCount: 3,
    })
    expect(summary.decoderHealth.formatMismatchDropDelta).toEqual({
      total: 0,
      observedRunCount: 2,
      missingRunCount: 3,
    })
  })

  it('computes group medians, worst values, MAD, minima, and stability totals', () => {
    const result = summarizeBenchmarkGroups([
      eligibleRun({
        runId: 'one',
        interactionToRender: {
          ...eligibleRun().interactionToRender,
          p95Ms: 10,
        },
        captureToRenderP95Ms: 20,
        renderedFps: 58,
        droppedBeforeDecode: 1,
        observedMissingFrameIds: 2,
        decoderResetsDuringRun: 0,
      }),
      eligibleRun({
        runId: 'two',
        interactionToRender: {
          ...eligibleRun().interactionToRender,
          p95Ms: 20,
        },
        captureToRenderP95Ms: 30,
        renderedFps: 59,
        droppedBeforeDecode: 3,
        observedMissingFrameIds: 4,
        decoderResetsDuringRun: 1,
      }),
      eligibleRun({
        runId: 'three',
        interactionToRender: {
          ...eligibleRun().interactionToRender,
          p95Ms: 50,
        },
        captureToRenderP95Ms: 40,
        renderedFps: 60,
        droppedBeforeDecode: 5,
        observedMissingFrameIds: 6,
        decoderResetsDuringRun: 2,
      }),
    ]).groups[0]

    expect(result.interactionP95Ms).toMatchObject({
      median: 20,
      worst: 50,
      mad: 10,
    })
    expect(result.captureP95Ms).toMatchObject({
      median: 30,
      worst: 40,
      mad: 10,
    })
    expect(result.renderedFps).toMatchObject({ median: 59, min: 58 })
    expect(result.totals).toEqual({
      droppedBeforeDecode: {
        total: 9,
        observedRunCount: 3,
        missingRunCount: 0,
      },
      observedMissingFrameIds: {
        total: 12,
        observedRunCount: 3,
        missingRunCount: 0,
      },
      decoderResets: {
        total: 3,
        observedRunCount: 3,
        missingRunCount: 0,
      },
    })
  })

  it('keeps missing reset evidence distinct from an observed zero', () => {
    const withoutResetMetric = eligibleRun()
    delete withoutResetMetric.decoderResetsDuringRun
    const summary = summarizeBenchmarkGroups([
      withoutResetMetric,
      eligibleRun({ decoderResetsDuringRun: 0 }),
      eligibleRun({
        decoderResetsDuringRun: 2,
        thermalContaminated: true,
        eligibleForRanking: false,
      }),
    ]).groups[0]

    expect(summary.thermalContaminatedCount).toBe(1)
    expect(summary.totals.decoderResets).toEqual({
      total: 2,
      observedRunCount: 2,
      missingRunCount: 1,
    })
  })

  it('uses the same interaction coverage gate as the legacy per-run ranking', () => {
    const badCoverage = eligibleRun({
      interactionToRender: {
        ...eligibleRun().interactionToRender,
        coveragePercent: 97.9,
      },
    })
    const summary = summarizeBenchmarkGroups([
      eligibleRun(),
      eligibleRun(),
      badCoverage,
    ]).groups[0]

    expect(summary.eligibleCount).toBe(2)
    expect(summary.eligibleForRanking).toBe(false)
  })

  it('orders by median interaction P95, worst interaction P95, median capture P95, then FPS', () => {
    const group = (
      key,
      interactionMedian,
      interactionWorst,
      captureMedian,
      fpsMedian,
    ) => ({
      configurationKey: key,
      eligibleForRanking: true,
      interactionP95Ms: {
        median: interactionMedian,
        worst: interactionWorst,
      },
      captureP95Ms: { median: captureMedian },
      renderedFps: { median: fpsMedian, min: fpsMedian },
    })
    const lowerMedian = group('lower-median', 19, 100, 100, 30)
    const lowerWorst = group('lower-worst', 20, 30, 100, 30)
    const lowerCapture = group('lower-capture', 20, 40, 20, 30)
    const higherFps = group('higher-fps', 20, 40, 30, 60)
    const baseline = group('baseline', 20, 40, 30, 30)

    expect(
      rankBenchmarkGroups([
        baseline,
        higherFps,
        lowerCapture,
        lowerWorst,
        lowerMedian,
      ]).map((result) => result.configurationKey),
    ).toEqual([
      'lower-median',
      'lower-worst',
      'lower-capture',
      'higher-fps',
      'baseline',
    ])
  })

  it('normalizes legacy aliases without admitting runtime identity fields', () => {
    expect(
      benchmarkGroupConfiguration({
        targetFps: 30,
        encoderProfile: 'legacy',
        encoderTuning: 'default',
        decoderMode: 'auto',
        captureShortEdge: 640,
        h264BitstreamFormatRequested: 'avcc',
        requestedRenderPreset: 'latency',
        runId: 'ignored',
        browserConfigGeneration: 42,
      }),
    ).toEqual({
      targetFps: 30,
      profile: 'legacy',
      tuning: 'default',
      decoderMode: 'auto',
      captureShortEdge: 640,
      bitstream: 'avcc',
      renderPreset: 'latency',
    })
  })

  it('rejects an invalid sample threshold', () => {
    expect(() => summarizeBenchmarkGroups([], 0)).toThrow(
      'minimumEligibleRuns must be a positive integer',
    )
  })
})
