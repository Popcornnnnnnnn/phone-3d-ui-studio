import { describe, expect, it } from 'vitest'
import {
  benchmarkDecoderHealthExclusionReasons,
  benchmarkDecoderHealthFromReport,
  benchmarkDecoderHealthIsClean,
} from './benchmark-decoder-health.mjs'

function reportWithDecoderHealth(overrides = {}) {
  return {
    screen: {
      decoderHealth: {
        status: 'valid',
        reason: null,
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
        ...overrides,
      },
    },
  }
}

describe('benchmark decoder health gate', () => {
  it('accepts only an explicitly valid zero-delta run', () => {
    const decoderHealth = benchmarkDecoderHealthFromReport(
      reportWithDecoderHealth(),
    )

    expect(decoderHealth).toEqual({
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
    })
    expect(benchmarkDecoderHealthIsClean(decoderHealth)).toBe(true)
    expect(benchmarkDecoderHealthExclusionReasons(decoderHealth)).toEqual([])
  })

  it.each([
    ['resetDelta', 'decoder-resets-during-run'],
    ['errorDelta', 'decoder-errors-during-run'],
    [
      'formatMismatchDropDelta',
      'decoder-format-mismatch-drops-during-run',
    ],
  ])('excludes a nonzero %s', (field, expectedReason) => {
    const decoderHealth = benchmarkDecoderHealthFromReport(
      reportWithDecoderHealth({ [field]: 1 }),
    )

    expect(decoderHealth.clean).toBe(false)
    expect(benchmarkDecoderHealthExclusionReasons(decoderHealth)).toContain(
      expectedReason,
    )
  })

  it.each([
    ['invalid', 'counter-regression', 'decoder-health-invalid'],
    ['unknown', 'snapshot-unavailable', 'decoder-health-unknown'],
  ])('preserves %s status and reason as non-clean', (status, reason, exclusion) => {
    const decoderHealth = benchmarkDecoderHealthFromReport(
      reportWithDecoderHealth({
        status,
        reason,
        resetDelta: null,
        errorDelta: null,
        formatMismatchDropDelta: null,
      }),
    )

    expect(decoderHealth).toMatchObject({ status, reason, clean: false })
    expect(benchmarkDecoderHealthExclusionReasons(decoderHealth)).toEqual([
      exclusion,
    ])
  })

  it('does not coerce a missing required delta to zero', () => {
    const report = reportWithDecoderHealth()
    delete report.screen.decoderHealth.errorDelta
    const decoderHealth = benchmarkDecoderHealthFromReport(report)

    expect(decoderHealth).toMatchObject({
      status: 'valid',
      errorDelta: null,
      clean: false,
    })
    expect(benchmarkDecoderHealthExclusionReasons(decoderHealth)).toEqual([
      'decoder-health-evidence-incomplete',
    ])
  })

  it('keeps legacy reset evidence for display without admitting it as clean', () => {
    const decoderHealth = benchmarkDecoderHealthFromReport({
      screen: { decoderResetsDuringRun: 0 },
    })

    expect(decoderHealth).toMatchObject({
      source: 'legacy',
      status: 'unknown',
      reason: 'legacy-report-without-run-local-decoder-health',
      clean: false,
      resetDelta: null,
      legacyResetObservation: {
        field: 'decoderResetsDuringRun',
        value: 0,
      },
    })
    expect(benchmarkDecoderHealthIsClean(decoderHealth)).toBe(false)
  })

  it('never lets a legacy zero replace an invalid run-local delta', () => {
    const report = reportWithDecoderHealth({
      status: 'invalid',
      reason: 'counter-regression',
      resetDelta: null,
      errorDelta: null,
      formatMismatchDropDelta: null,
    })
    report.screen.decoderResetsDuringRun = 0
    const decoderHealth = benchmarkDecoderHealthFromReport(report)

    expect(decoderHealth).toMatchObject({
      source: 'run-local',
      status: 'invalid',
      clean: false,
      resetDelta: null,
      legacyResetObservation: {
        field: 'decoderResetsDuringRun',
        value: 0,
      },
    })
  })
})
