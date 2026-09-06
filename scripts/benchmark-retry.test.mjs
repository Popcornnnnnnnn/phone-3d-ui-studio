import { describe, expect, it } from 'vitest'
import {
  advanceConsecutiveReadiness,
  classifyPreStartPhoneTransportFailure,
  retryReadiness,
} from './benchmark-retry.mjs'

const runId = 'run-1'

function requested() {
  return {
    type: 'benchmark-request',
    runId,
    phase: 'requested',
  }
}

function invalidated(reason) {
  return {
    type: 'benchmark-state',
    runId,
    phase: 'invalidated',
    reason,
    bridgeReceivedAtMs: 1_000,
  }
}

function readyState(nowMs = 10_000) {
  return {
    nowMs,
    health: {
      phones: 1,
      phonePose: 1,
      browsers: 1,
      browserPose: 1,
    },
    diagnostics: {
      encoderSamples: [
        {
          bridgeReceivedAtMs: nowMs - 100,
          captureState: 'streaming',
          encoderStatus: 0,
          codec: 'H.264',
          frameSocket: 'connected',
          poseSocket: 'connected',
        },
      ],
      receiverSamples: [
        {
          bridgeReceivedAtMs: nowMs - 80,
          visibilityState: 'visible',
          screenStale: false,
          lastFrameReceivedAtMs: nowMs - 50,
          lastFrameRenderedAtMs: nowMs - 40,
        },
      ],
    },
  }
}

describe('benchmark retry classification', () => {
  it('allows only a requested-phase phone transport disconnect', () => {
    expect(
      classifyPreStartPhoneTransportFailure([
        requested(),
        invalidated('pinned-phone-control-disconnected'),
      ]),
    ).toEqual({
      reason: 'pinned-phone-control-disconnected',
      invalidatedAtMs: 1_000,
    })

    expect(
      classifyPreStartPhoneTransportFailure([
        requested(),
        invalidated('pinned-phone-raw-frame-disconnected'),
      ])?.reason,
    ).toBe('pinned-phone-raw-frame-disconnected')
  })

  it('does not retry after the measured interval has started', () => {
    expect(
      classifyPreStartPhoneTransportFailure([
        requested(),
        {
          type: 'benchmark-status',
          runId,
          phase: 'started',
        },
        invalidated('pinned-phone-control-disconnected'),
      ]),
    ).toBeNull()
  })

  it('does not retry browser, timeout, or validation failures', () => {
    for (const reason of [
      'pinned-browser-became-hidden',
      'phone-frame-not-ready-at-start',
      'invalid-phone-status:target-fps-mismatch',
    ]) {
      expect(
        classifyPreStartPhoneTransportFailure([
          requested(),
          invalidated(reason),
        ]),
      ).toBeNull()
    }
  })
})

describe('benchmark retry readiness', () => {
  it('accepts a fresh, uniquely connected phone and visible live receiver', () => {
    const state = readyState()
    expect(
      retryReadiness(state.health, state.diagnostics, state.nowMs),
    ).toEqual({ ready: true, reasons: [] })
  })

  it('rejects duplicate phones and stale telemetry', () => {
    const state = readyState()
    state.health.phones = 2
    state.diagnostics.encoderSamples[0].bridgeReceivedAtMs = 8_000
    state.diagnostics.receiverSamples[0].lastFrameRenderedAtMs = 8_000

    const result = retryReadiness(
      state.health,
      state.diagnostics,
      state.nowMs,
    )
    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'connection-counts',
        'stale-encoder-heartbeat',
        'browser-not-ready',
      ]),
    )
  })

  it('does not require browser focus, but does require visibility and freshness', () => {
    const state = readyState()
    state.diagnostics.receiverSamples[0].hasFocus = false
    expect(
      retryReadiness(state.health, state.diagnostics, state.nowMs).ready,
    ).toBe(true)

    state.diagnostics.receiverSamples[0].visibilityState = 'hidden'
    expect(
      retryReadiness(state.health, state.diagnostics, state.nowMs).ready,
    ).toBe(false)
  })

  it('requires two consecutive ready samples while no benchmark is active', () => {
    const ready = { ready: true, reasons: [] }
    const notReady = { ready: false, reasons: ['phone-not-ready'] }

    const first = advanceConsecutiveReadiness(0, null, ready)
    expect(first).toBe(1)
    expect(advanceConsecutiveReadiness(first, null, ready)).toBe(2)
    expect(advanceConsecutiveReadiness(first, { runId: 'other' }, ready)).toBe(0)
    expect(advanceConsecutiveReadiness(first, null, notReady)).toBe(0)
  })
})
