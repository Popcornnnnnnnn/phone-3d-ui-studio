import { describe, expect, it } from 'vitest'
import {
  benchmarkConfigurationDisposition,
  encoderTuningConfigurationError,
  normalizeEncoderTuning,
  parseBenchmarkConfiguration,
  rankEligibleBenchmarkResults,
} from './encoder-tuning.mjs'

function interactionToRender(p95Ms, p50Ms = p95Ms) {
  return {
    samples: 10,
    runDurationMs: 1_000,
    coveredDurationMs: 1_000,
    rightCensoredDurationMs: 0,
    coveragePercent: 100,
    p50Ms,
    p95Ms,
  }
}

describe('encoder tuning benchmark configuration', () => {
  it('keeps the old FPS:profile syntax compatible by selecting default tuning', () => {
    expect(parseBenchmarkConfiguration('30:low-latency')).toEqual({
      targetFps: 30,
      encoderProfile: 'low-latency',
      encoderTuning: 'default',
      decoderMode: 'software',
      captureShortEdge: 960,
    })
  })

  it('accepts compatible explicit tunings and bounds FPS', () => {
    expect(parseBenchmarkConfiguration('120:legacy:high-speed-preset')).toEqual({
      targetFps: 120,
      encoderProfile: 'legacy',
      encoderTuning: 'high-speed-preset',
      decoderMode: 'software',
      captureShortEdge: 960,
    })
    expect(
      parseBenchmarkConfiguration(
        '30:low-latency:video-conferencing-preset',
      ),
    ).toMatchObject({ encoderTuning: 'video-conferencing-preset' })
    expect(parseBenchmarkConfiguration('30:legacy:speed-priority')).toMatchObject(
      { encoderTuning: 'speed-priority' },
    )
  })

  it('accepts an explicit decoder mode without changing legacy defaults', () => {
    expect(
      parseBenchmarkConfiguration(
        '30:low-latency:video-conferencing-preset:hardware',
      ),
    ).toEqual({
      targetFps: 30,
      encoderProfile: 'low-latency',
      encoderTuning: 'video-conferencing-preset',
      decoderMode: 'hardware',
      captureShortEdge: 960,
    })
    expect(
      parseBenchmarkConfiguration('30:low-latency:default:auto:640'),
    ).toMatchObject({ decoderMode: 'auto', captureShortEdge: 640 })
    expect(() =>
      parseBenchmarkConfiguration('30:low-latency:default:gpu'),
    ).toThrow('unsupported decoderMode')
    expect(() =>
      parseBenchmarkConfiguration('30:low-latency:default:auto:800'),
    ).toThrow('unsupported captureShortEdge')
  })

  it('rejects unsupported and profile-incompatible tunings', () => {
    expect(() =>
      parseBenchmarkConfiguration('30:low-latency:high-speed-preset'),
    ).toThrow('requires encoderProfile=legacy')
    expect(() =>
      parseBenchmarkConfiguration('30:low-latency:speed-priority'),
    ).toThrow('requires encoderProfile=legacy')
    expect(() =>
      parseBenchmarkConfiguration('30:legacy:video-conferencing-preset'),
    ).toThrow('requires encoderProfile=low-latency')
    expect(() => parseBenchmarkConfiguration('30:legacy:turbo')).toThrow(
      'unsupported encoderTuning',
    )
  })

  it('normalizes omitted legacy wire values without accepting bad requests', () => {
    expect(normalizeEncoderTuning(undefined)).toBe('default')
    expect(normalizeEncoderTuning('turbo')).toBe('default')
    expect(encoderTuningConfigurationError('legacy', 'turbo')).toContain(
      'unsupported',
    )
  })

  it('keeps fallback results but excludes them from A/B ranking', () => {
    const applied = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'default',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 100,
          futureToleratedCaptureTimestampPercent: 0,
          interactionToRenderCoveragePercent: 100,
        },
      ),
      runId: 'applied',
      interactionToRender: interactionToRender(25, 20),
      captureToRenderP95Ms: 20,
      renderedFps: 30,
    }
    const fallback = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'high-speed-preset',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 100,
          futureToleratedCaptureTimestampPercent: 0,
          interactionToRenderCoveragePercent: 100,
        },
      ),
      runId: 'fallback',
      interactionToRender: interactionToRender(10),
      captureToRenderP95Ms: 10,
      renderedFps: 30,
    }

    expect(fallback).toMatchObject({
      fallbackOrUnsupported: true,
      eligibleForRanking: false,
    })
    expect(rankEligibleBenchmarkResults([fallback, applied])).toEqual([applied])
  })

  it('excludes decoder fallback or an inconsistent acceleration hint', () => {
    const fallback = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      {
        requestedDecoderMode: 'hardware',
        appliedDecoderMode: 'auto',
        decoderAccelerationConfigured: 'no-preference',
        captureTimestampCoveragePercent: 100,
        futureToleratedCaptureTimestampPercent: 0,
        interactionToRenderCoveragePercent: 100,
      },
    )
    const wrongHint = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      {
        requestedDecoderMode: 'hardware',
        appliedDecoderMode: 'hardware',
        decoderAccelerationConfigured: 'no-preference',
        captureTimestampCoveragePercent: 100,
        futureToleratedCaptureTimestampPercent: 0,
        interactionToRenderCoveragePercent: 100,
      },
    )

    expect(fallback.exclusionReasons).toContain('fallback-or-unsupported')
    expect(wrongHint.exclusionReasons).toContain('fallback-or-unsupported')
    expect(fallback.eligibleForRanking).toBe(false)
    expect(wrongHint.eligibleForRanking).toBe(false)
  })

  it('excludes a capture dimension or stream-generation mismatch', () => {
    const base = {
      expectedCaptureShortEdge: 720,
      requestedCaptureShortEdge: 720,
      activeCaptureShortEdge: 720,
      captureWidthActive: 720,
      captureHeightActive: 1_566,
      captureStreamGeneration: 8,
      captureTimestampCoveragePercent: 100,
      futureToleratedCaptureTimestampPercent: 0,
      interactionToRenderCoveragePercent: 100,
    }
    const valid = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      base,
    )
    const staleGeneration = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      { ...base, captureStreamGeneration: 0 },
    )
    const wrongSize = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      { ...base, captureWidthActive: 718 },
    )

    expect(valid.captureConfigurationInvalid).toBe(false)
    expect(valid.eligibleForRanking).toBe(true)
    expect(staleGeneration.exclusionReasons).toContain(
      'capture-configuration-invalid',
    )
    expect(wrongSize.eligibleForRanking).toBe(false)
  })

  it('records fair thermals but excludes serious or critical runs', () => {
    const measurement = {
      captureTimestampCoveragePercent: 100,
      futureToleratedCaptureTimestampPercent: 0,
      interactionToRenderCoveragePercent: 100,
    }
    const fair = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      { ...measurement, thermalContaminated: false },
    )
    const serious = benchmarkConfigurationDisposition(
      'low-latency',
      'default',
      'low-latency',
      'default',
      { ...measurement, thermalContaminated: true },
    )

    expect(fair.eligibleForRanking).toBe(true)
    expect(serious).toMatchObject({
      thermalContaminated: true,
      eligibleForRanking: false,
      exclusionReasons: ['thermal-contaminated'],
    })
  })

  it('retains measurement-insufficient runs but excludes them from ranking', () => {
    const lowCoverage = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'default',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 89.9,
          futureToleratedCaptureTimestampPercent: 0,
          interactionToRenderCoveragePercent: 100,
        },
      ),
      runId: 'low-coverage',
      interactionToRender: interactionToRender(5),
      captureToRenderP95Ms: 5,
      renderedFps: 60,
    }
    const futureTolerated = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'default',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 100,
          futureToleratedCaptureTimestampPercent: 1.1,
          interactionToRenderCoveragePercent: 100,
        },
      ),
      runId: 'future-tolerated',
      interactionToRender: interactionToRender(4),
      captureToRenderP95Ms: 4,
      renderedFps: 60,
    }
    const interactionCoverage = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'default',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 100,
          futureToleratedCaptureTimestampPercent: 0,
          interactionToRenderCoveragePercent: 97.9,
        },
      ),
      runId: 'interaction-coverage',
      interactionToRender: {
        ...interactionToRender(3),
        coveragePercent: 97.9,
      },
      captureToRenderP95Ms: 3,
      renderedFps: 60,
    }
    const eligible = {
      ...benchmarkConfigurationDisposition(
        'legacy',
        'default',
        'legacy',
        'default',
        {
          captureTimestampCoveragePercent: 90,
          futureToleratedCaptureTimestampPercent: 1,
          interactionToRenderCoveragePercent: 100,
        },
      ),
      runId: 'eligible',
      interactionToRender: interactionToRender(25, 20),
      captureToRenderP95Ms: 20,
      renderedFps: 30,
    }

    expect(lowCoverage).toMatchObject({
      measurementInsufficient: true,
      eligibleForRanking: false,
      exclusionReasons: ['capture-timestamp-coverage-below-90-percent'],
    })
    expect(futureTolerated).toMatchObject({
      measurementInsufficient: true,
      eligibleForRanking: false,
      exclusionReasons: [
        'future-tolerated-capture-timestamps-above-1-percent',
      ],
    })
    expect(interactionCoverage).toMatchObject({
      measurementInsufficient: true,
      eligibleForRanking: false,
      exclusionReasons: [
        'interaction-to-render-coverage-below-98-percent',
      ],
    })
    expect(
      rankEligibleBenchmarkResults([
        lowCoverage,
        futureTolerated,
        interactionCoverage,
        eligible,
      ]),
    ).toEqual([eligible])
  })

  it('ranks interaction tails and medians before pipeline latency and FPS', () => {
    const result = (
      runId,
      interactionP95,
      interactionP50,
      pipelineP95,
      pipelineP50,
      fps,
    ) => ({
      runId,
      eligibleForRanking: true,
      interactionToRender: interactionToRender(
        interactionP95,
        interactionP50,
      ),
      captureToRenderP95Ms: pipelineP95,
      captureToRenderP50Ms: pipelineP50,
      renderedFps: fps,
    })
    const lowerTail = result('lower-tail', 39, 30, 50, 45, 30)
    const lowerMedian = result('lower-median', 40, 25, 50, 45, 30)
    const lowerPipelineTail = result(
      'lower-pipeline-tail',
      40,
      30,
      45,
      40,
      30,
    )
    const lowerPipelineMedian = result(
      'lower-pipeline-median',
      40,
      30,
      50,
      40,
      30,
    )
    const higherFps = result('higher-fps', 40, 30, 50, 45, 60)

    expect(
      rankEligibleBenchmarkResults([
        higherFps,
        lowerPipelineMedian,
        lowerPipelineTail,
        lowerMedian,
        lowerTail,
      ]).map(({ runId }) => runId),
    ).toEqual([
      'lower-tail',
      'lower-median',
      'lower-pipeline-tail',
      'lower-pipeline-median',
      'higher-fps',
    ])
  })

  it('excludes a fast opening followed by a run-ending stall', () => {
    const healthy = {
      runId: 'healthy',
      eligibleForRanking: true,
      interactionToRender: interactionToRender(40, 25),
      captureToRenderP95Ms: 25,
      renderedFps: 30,
    }
    const terminalStall = {
      runId: 'terminal-stall',
      eligibleForRanking: true,
      interactionToRender: {
        ...interactionToRender(5, 4),
        samples: 1,
        runDurationMs: 15_000,
        coveredDurationMs: 16,
        rightCensoredDurationMs: 14_984,
        coveragePercent: (16 / 15_000) * 100,
      },
      captureToRenderP95Ms: 4,
      renderedFps: 0.13,
    }

    expect(
      rankEligibleBenchmarkResults([terminalStall, healthy]).map(
        ({ runId }) => runId,
      ),
    ).toEqual(['healthy'])
  })

  it('conservatively excludes legacy results without interaction metrics', () => {
    expect(
      rankEligibleBenchmarkResults([
        {
          runId: 'legacy-result',
          eligibleForRanking: true,
          captureToRenderP95Ms: 1,
          renderedFps: 120,
        },
      ]),
    ).toEqual([])
  })
})
