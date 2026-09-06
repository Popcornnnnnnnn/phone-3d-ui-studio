import { describe, expect, it, vi } from 'vitest'
import {
  activeBrowserLeaseFailureReason,
  beginBrowserFrameLease,
  beginBrowserReceiverLease,
  browserDecoderAcceleration,
  browserBenchmarkReadinessError,
  benchmarkBrowserReceiverStatusError,
  browserLeaseHealthHandoffPaused,
  browserPrepareAckValidationError,
  browserPrepareAckShouldAbortRun,
  browserReceiverServerState,
  browserSocketOwnsFrameLease,
  h264OutputFormatShouldForward,
  phoneTransportSnapshot,
  socketAddressScope,
  benchmarkEncoderStatusValidationError,
  benchmarkEncoderReadinessError,
  benchmarkCaptureStatusValidationError,
  benchmarkReportValidationError,
  benchmarkStatusEnvelopeValidationError,
  benchmarkStatusPayload,
  captureFreshnessError,
  captureConfigurationMatches,
  captureDimensionsValidationError,
  measuredCaptureConfigurationError,
  observeBenchmarkThermalState,
  resolutionBenchmarkCaptureSourceError,
  selectBrowserLeaseHandoffCandidate,
  shouldPruneBrowserClient,
  shouldReplaceBrowserClientSocket,
  shouldDropBrowserFrameForBackpressure,
  startBrowserLeaseHealthTimer,
  worstThermalState,
} from './live-bridge.mjs'

describe('inactive browser pruning', () => {
  it('prunes only a different identified browser session', () => {
    expect(shouldPruneBrowserClient('active', 'stale')).toBe(true)
    expect(shouldPruneBrowserClient('active', 'active')).toBe(false)
    expect(shouldPruneBrowserClient('active', null)).toBe(false)
    expect(shouldPruneBrowserClient(null, 'stale')).toBe(false)
  })
})

describe('same-tab browser connection replacement', () => {
  it('replaces only the same role from the same identified tab session', () => {
    expect(
      shouldReplaceBrowserClientSocket(
        'browser',
        'tab-a',
        'browser',
        'tab-a',
      ),
    ).toBe(true)
    expect(
      shouldReplaceBrowserClientSocket(
        'browser-pose',
        'tab-a',
        'browser-pose',
        'tab-a',
      ),
    ).toBe(true)
    expect(
      shouldReplaceBrowserClientSocket(
        'browser',
        'tab-a',
        'browser-pose',
        'tab-a',
      ),
    ).toBe(false)
    expect(
      shouldReplaceBrowserClientSocket(
        'browser',
        'tab-a',
        'browser',
        'tab-b',
      ),
    ).toBe(false)
    expect(
      shouldReplaceBrowserClientSocket('phone', 'tab-a', 'phone', 'tab-a'),
    ).toBe(false)
  })
})

describe('H.264 output-format control idempotence', () => {
  it('forwards a valid initial value and a real format change only', () => {
    expect(h264OutputFormatShouldForward(null, 'annex-b')).toBe(true)
    expect(h264OutputFormatShouldForward('annex-b', 'annex-b')).toBe(false)
    expect(h264OutputFormatShouldForward('annex-b', 'avcc')).toBe(true)
  })

  it('rejects unsupported values', () => {
    expect(h264OutputFormatShouldForward(null, 'raw')).toBe(false)
    expect(h264OutputFormatShouldForward(null, null)).toBe(false)
  })
})

describe('phone transport route observability', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.0.0.2', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['169.254.65.18', 'ipv4-link-local'],
    ['::ffff:169.254.131.86', 'ipv4-link-local'],
    ['fe80::1234%en7', 'ipv6-link-local'],
    ['fe90::1', 'ipv6-link-local'],
    ['febf::1', 'ipv6-link-local'],
    ['fec0::1', 'public-or-other'],
    ['192.168.20.98', 'ipv4-private-lan'],
    ['10.0.0.4', 'ipv4-private-lan'],
    ['172.31.2.3', 'ipv4-private-lan'],
    ['fd12::1', 'ipv6-unique-local'],
    ['8.8.8.8', 'public-or-other'],
    ['192.168.20.98junk', 'public-or-other'],
    [null, 'unknown'],
  ])('classifies %s as %s', (address, expected) => {
    expect(socketAddressScope(address)).toBe(expected)
  })

  it('uses retained request-socket endpoints for WebSocket transports', () => {
    expect(
      phoneTransportSnapshot('phone-pose', null, {
        addressFamily: 'IPv4',
        remoteAddress: '192.168.20.98',
        remotePort: 50_001,
        localAddress: '192.168.20.61',
        localPort: 4_319,
      }),
    ).toEqual({
      role: 'phone-pose',
      addressFamily: 'IPv4',
      remoteAddress: '192.168.20.98',
      remotePort: 50_001,
      localAddress: '192.168.20.61',
      localPort: 4_319,
      addressScope: 'ipv4-private-lan',
    })
  })

  it('uses current net.Socket endpoints for raw frame transports', () => {
    expect(
      phoneTransportSnapshot(
        'raw-frame',
        {
          remoteFamily: 'IPv4',
          remoteAddress: '169.254.131.86',
          remotePort: 50_002,
          localAddress: '169.254.65.18',
          localPort: 4_320,
        },
        {
          remoteAddress: '192.168.20.98',
        },
      ),
    ).toEqual({
      role: 'raw-frame',
      addressFamily: 'IPv4',
      remoteAddress: '169.254.131.86',
      remotePort: 50_002,
      localAddress: '169.254.65.18',
      localPort: 4_320,
      addressScope: 'ipv4-link-local',
    })
  })
})

describe('bridge capture freshness truth', () => {
  it.each([
    [{}, 'capture-content-missing'],
    [{ captureContentStatus: 'missing', freshContent: false }, 'capture-content-missing'],
    [{ captureContentStatus: 'complete' }, 'capture-content-not-fresh'],
    [{ captureContentStatus: 'complete', freshContent: false }, 'capture-content-not-fresh'],
  ])('rejects unverifiable capture metadata %#', (metadata, expected) => {
    expect(captureFreshnessError(metadata)).toBe(expected)
  })

  it.each(['complete', 'started'])('accepts verified fresh %s capture', (status) => {
    expect(
      captureFreshnessError({
        captureContentStatus: status,
        freshContent: true,
      }),
    ).toBeNull()
  })
})

const producerSessionId = 'report-validation-session'
const captureSource = 'screencapturekit-host'
const startedAtMs = 2_000_000_000_000

describe('browser decoder benchmark prepare contract', () => {
  const run = {
    phase: 'browser-preparing',
    runId: 'run-1',
    browserClientId: 'browser-a',
    browserConfigId: 'config-2',
    requestedBrowserConfigGeneration: 2,
    requestedDecoderMode: 'hardware',
    requestedDecoderAcceleration: 'prefer-hardware',
  }
  const details = { clientId: 'browser-a' }
  const ack = {
    status: 'ready',
    runId: 'run-1',
    browserConfigId: 'config-2',
    browserConfigGeneration: 2,
    decoderModeRequested: 'hardware',
    decoderModeApplied: 'hardware',
    decoderAccelerationConfigured: 'prefer-hardware',
    renderedFrameId: 42,
    preparedAtMs: startedAtMs,
    prepareDurationMs: 25,
  }

  it.each([
    ['software', 'prefer-software'],
    ['auto', 'no-preference'],
    ['hardware', 'prefer-hardware'],
  ])('maps %s to the WebCodecs acceleration hint %s', (mode, acceleration) => {
    expect(browserDecoderAcceleration(mode)).toBe(acceleration)
  })

  it('accepts only a rendered ack for the exact pinned client and generation', () => {
    expect(browserPrepareAckValidationError(run, details, ack)).toBeNull()
    expect(
      browserPrepareAckValidationError(
        run,
        details,
        { ...ack, browserConfigGeneration: 1 },
      ),
    ).toBe('browser-prepare-generation-mismatch')
    expect(
      browserPrepareAckValidationError(run, { clientId: 'browser-b' }, ack),
    ).toBe('browser-prepare-client-mismatch')
    expect(
      browserPrepareAckValidationError(
        { ...run, phase: 'requested' },
        details,
        ack,
      ),
    ).toBe('browser-prepare-not-pending')
    expect(
      browserPrepareAckShouldAbortRun(
        { ...run, phase: 'requested' },
        ack,
        'browser-prepare-not-pending',
      ),
    ).toBe(false)
    expect(
      browserPrepareAckShouldAbortRun(
        run,
        { ...ack, browserConfigGeneration: 1 },
        'browser-prepare-generation-mismatch',
      ),
    ).toBe(true)
  })

  it('pauses only the pinned lease health handoff while prepare is pending', () => {
    const frameSocket = {}
    expect(
      browserLeaseHealthHandoffPaused(
        {
          phase: 'browser-preparing',
          browserFrameSocket: frameSocket,
          browserClientId: 'browser-a',
        },
        frameSocket,
        'browser-a',
      ),
    ).toBe(true)
    expect(
      browserLeaseHealthHandoffPaused(
        {
          phase: 'requested',
          browserFrameSocket: frameSocket,
          browserClientId: 'browser-a',
        },
        frameSocket,
        'browser-a',
      ),
    ).toBe(false)
  })

  it('allows expected decoder and capture gaps until measurement starts', () => {
    const receiver = {
      clientId: 'browser-a',
      receiverVisibilityState: 'visible',
      receiverScreenStale: true,
      browserConfigId: 'config-2',
      browserConfigGeneration: 2,
      decoderModeRequested: 'hardware',
      decoderModeApplied: 'hardware',
      decoderAccelerationConfigured: 'prefer-hardware',
    }
    const preparedRun = {
      ...run,
      browserConfigGeneration: 2,
      appliedDecoderMode: 'hardware',
      decoderAccelerationConfigured: 'prefer-hardware',
    }

    expect(
      benchmarkBrowserReceiverStatusError(preparedRun, receiver),
    ).toBeNull()
    expect(
      benchmarkBrowserReceiverStatusError(
        { ...preparedRun, phase: 'requested' },
        receiver,
      ),
    ).toBeNull()
    expect(
      benchmarkBrowserReceiverStatusError(
        { ...preparedRun, phase: 'running' },
        receiver,
      ),
    ).toBe('pinned-browser-stream-became-stale')
    expect(
      benchmarkBrowserReceiverStatusError(
        { ...preparedRun, phase: 'awaiting-report' },
        { ...receiver, receiverScreenStale: false },
      ),
    ).toBeNull()
  })

  it('keeps identity, visibility, and prepared configuration strict', () => {
    const preparedRun = {
      ...run,
      phase: 'requested',
      browserConfigGeneration: 2,
      appliedDecoderMode: 'hardware',
      decoderAccelerationConfigured: 'prefer-hardware',
    }
    const receiver = {
      clientId: 'browser-a',
      receiverVisibilityState: 'visible',
      receiverScreenStale: false,
      browserConfigId: 'config-2',
      browserConfigGeneration: 2,
      decoderModeRequested: 'hardware',
      decoderModeApplied: 'hardware',
      decoderAccelerationConfigured: 'prefer-hardware',
    }

    expect(
      benchmarkBrowserReceiverStatusError(preparedRun, {
        ...receiver,
        clientId: 'browser-b',
      }),
    ).toBe('pinned-browser-client-id-changed')
    expect(
      benchmarkBrowserReceiverStatusError(preparedRun, {
        ...receiver,
        receiverVisibilityState: 'hidden',
      }),
    ).toBe('pinned-browser-became-hidden')
    expect(
      benchmarkBrowserReceiverStatusError(preparedRun, {
        ...receiver,
        browserConfigGeneration: 3,
      }),
    ).toBe('pinned-browser-config-changed')
  })

  it('rejects decoder fallback, missing render proof, and invalid duration', () => {
    expect(
      browserPrepareAckValidationError(
        run,
        details,
        { ...ack, decoderModeApplied: 'auto' },
      ),
    ).toBe('browser-prepare-decoder-mode-mismatch')
    expect(
      browserPrepareAckValidationError(
        run,
        details,
        { ...ack, renderedFrameId: null },
      ),
    ).toBe('browser-prepare-rendered-frame-missing')
    expect(
      browserPrepareAckValidationError(
        run,
        details,
        { ...ack, prepareDurationMs: -1 },
      ),
    ).toBe('browser-prepare-duration-invalid')
  })
})

function readyBrowserDetails(
  nowMs = startedAtMs,
  leaseActivatedAtMs = nowMs - 1_000,
) {
  return {
    frame: {
      clientId: 'browser-a',
      browserLeaseGeneration: 1,
      browserLeaseActivatedAtMs: leaseActivatedAtMs,
      lastFrameRelayedAtMs: nowMs - 10,
      lastFrameRelayedId: 42,
    },
    receiver: {
      clientId: 'browser-a',
      browserLeaseGeneration: 1,
      browserLeaseActivatedAtMs: leaseActivatedAtMs,
      lastReceiverStatusAtMs: nowMs - 5,
      receiverVisibilityState: 'visible',
      receiverScreenStale: false,
      lastFrameReceivedAtMs: nowMs - 9,
      lastFrameRenderedAtMs: nowMs - 4,
    },
  }
}

describe('bridge browser benchmark readiness truth', () => {
  it('accepts recent relay, receive, and render state from the active frame client', () => {
    const { frame, receiver } = readyBrowserDetails()
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBeNull()
  })

  it('rejects telemetry from a different browser even when every timestamp is fresh', () => {
    const { frame, receiver } = readyBrowserDetails()
    receiver.clientId = 'browser-b'
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-receiver-client-mismatch')
  })

  it.each([
    ['lastFrameRelayedAtMs', 'browser-frame-relay-not-recent', 'frame'],
    ['lastReceiverStatusAtMs', 'browser-receiver-status-not-recent', 'receiver'],
    ['lastFrameReceivedAtMs', 'browser-frame-receive-not-recent', 'receiver'],
    ['lastFrameRenderedAtMs', 'browser-frame-render-not-recent', 'receiver'],
  ])('rejects a stale %s', (field, expected, owner) => {
    const { frame, receiver } = readyBrowserDetails()
    const target = owner === 'frame' ? frame : receiver
    target[field] = startedAtMs - 2_500
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe(expected)
  })

  it('rejects a materially future render timestamp', () => {
    const { frame, receiver } = readyBrowserDetails()
    receiver.lastFrameRenderedAtMs = startedAtMs + 251
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-frame-render-not-recent')
  })

  it.each([null, undefined, Number.NaN])(
    'rejects a missing or invalid render timestamp (%s)',
    (lastFrameRenderedAtMs) => {
      const { frame, receiver } = readyBrowserDetails()
      receiver.lastFrameRenderedAtMs = lastFrameRenderedAtMs
      expect(
        browserBenchmarkReadinessError(
          frame,
          receiver,
          'browser-a',
          startedAtMs,
        ),
      ).toBe('browser-frame-render-not-recent')
    },
  )

  it('rejects a frame socket that is no longer the selected active client', () => {
    const { frame, receiver } = readyBrowserDetails()
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-b',
        startedAtMs,
      ),
    ).toBe('browser-frame-client-not-active')
  })

  it('records server correlation without borrowing frame state across clients', () => {
    const { frame, receiver } = readyBrowserDetails()
    expect(
      browserReceiverServerState(
        receiver,
        frame,
        'browser-a',
        startedAtMs,
      ),
    ).toMatchObject({
      clientId: 'browser-a',
      activeFrameClientId: 'browser-a',
      isActiveFrameClient: true,
      browserLeaseGeneration: 1,
      browserLeaseActivatedAtMs: startedAtMs - 1_000,
      receiverLeaseGeneration: 1,
      lastFrameRelayedAtMs: startedAtMs - 10,
      lastFrameRelayedId: 42,
      reportedLastFrameReceivedAtMs: startedAtMs - 9,
      reportedLastFrameRenderedAtMs: startedAtMs - 4,
      benchmarkReadinessError: null,
    })

    receiver.clientId = 'browser-b'
    expect(
      browserReceiverServerState(
        receiver,
        frame,
        'browser-a',
        startedAtMs,
      ),
    ).toMatchObject({
      clientId: 'browser-b',
      activeFrameClientId: 'browser-a',
      isActiveFrameClient: false,
      browserLeaseGeneration: null,
      receiverLeaseGeneration: 1,
      lastFrameRelayedAtMs: null,
      lastFrameRelayedId: null,
      benchmarkReadinessError: 'browser-receiver-not-active-frame-client',
    })
  })

  it('requires every readiness timestamp to belong to the current lease generation', () => {
    const activatedAtMs = startedAtMs - 100
    const { frame, receiver } = readyBrowserDetails(
      startedAtMs,
      activatedAtMs,
    )

    frame.lastFrameRelayedAtMs = activatedAtMs - 1
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-frame-relay-not-recent')

    frame.lastFrameRelayedAtMs = startedAtMs - 10
    receiver.browserLeaseGeneration = 0
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-receiver-lease-generation-mismatch')

    receiver.browserLeaseGeneration = 1
    receiver.lastFrameRenderedAtMs = activatedAtMs - 1
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-frame-render-not-recent')
  })

  it('clears relay, receive, and render evidence whenever a socket is reactivated', () => {
    const { frame, receiver } = readyBrowserDetails()
    const reactivatedAtMs = startedAtMs - 100

    beginBrowserFrameLease(frame, 2, reactivatedAtMs)
    beginBrowserReceiverLease(receiver, 2, reactivatedAtMs)

    expect(frame).toMatchObject({
      browserLeaseGeneration: 2,
      browserLeaseActivatedAtMs: reactivatedAtMs,
      lastFrameRelayedAtMs: null,
      lastFrameRelayedId: null,
    })
    expect(receiver).toMatchObject({
      browserLeaseGeneration: 2,
      browserLeaseActivatedAtMs: reactivatedAtMs,
      lastFrameReceivedAtMs: null,
      lastFrameRenderedAtMs: null,
    })
    expect(
      browserBenchmarkReadinessError(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
      ),
    ).toBe('browser-frame-relay-not-recent')
  })
})

describe('bridge automatic browser lease health handoff', () => {
  it('forwards frames only to the exact lease holder and to nobody while unleased', () => {
    const browserA = {}
    const browserB = {}
    expect(browserSocketOwnsFrameLease(browserA, browserA)).toBe(true)
    expect(browserSocketOwnsFrameLease(browserB, browserA)).toBe(false)
    expect(browserSocketOwnsFrameLease(browserA, null)).toBe(false)
    expect(browserSocketOwnsFrameLease(browserB, null)).toBe(false)
  })

  it('does not fail the active lease during grace or without recent relayed frames', () => {
    const graceActivatedAtMs = startedAtMs - 3_499
    const duringGrace = readyBrowserDetails(startedAtMs, graceActivatedAtMs)
    expect(
      activeBrowserLeaseFailureReason(
        duringGrace.frame,
        { ...duringGrace.receiver, lastFrameRenderedAtMs: null },
        'browser-a',
        startedAtMs,
        graceActivatedAtMs,
      ),
    ).toBeNull()

    const activeActivatedAtMs = startedAtMs - 3_500
    const withoutRecentRelay = readyBrowserDetails(
      startedAtMs,
      activeActivatedAtMs,
    )
    withoutRecentRelay.frame.lastFrameRelayedAtMs = startedAtMs - 2_500
    expect(
      activeBrowserLeaseFailureReason(
        withoutRecentRelay.frame,
        { ...withoutRecentRelay.receiver, lastFrameRenderedAtMs: null },
        'browser-a',
        startedAtMs,
        activeActivatedAtMs,
      ),
    ).toBeNull()
  })

  it.each([
    [null, 'active-browser-render-not-recent'],
    [startedAtMs - 2_500, 'active-browser-render-not-recent'],
    [startedAtMs + 251, 'active-browser-render-not-recent'],
  ])('fails a relaying lease with invalid render time %s', (renderedAtMs, expected) => {
    const activatedAtMs = startedAtMs - 3_500
    const { frame, receiver } = readyBrowserDetails(
      startedAtMs,
      activatedAtMs,
    )
    receiver.lastFrameRenderedAtMs = renderedAtMs
    expect(
      activeBrowserLeaseFailureReason(
        frame,
        receiver,
        'browser-a',
        startedAtMs,
        activatedAtMs,
      ),
    ).toBe(expected)
  })

  it('selects a visible connected candidate without requiring prior rendering', () => {
    const candidate = selectBrowserLeaseHandoffCandidate(
      [
        {
          clientId: 'browser-b',
          frameConnected: true,
          visibilityState: 'visible',
          hasFocus: false,
          lastReceiverStatusAtMs: startedAtMs - 10,
          frameConnectedAtMs: startedAtMs - 100,
          lastFrameRenderedAtMs: null,
        },
      ],
      'browser-a',
      startedAtMs,
    )
    expect(candidate?.clientId).toBe('browser-b')
  })

  it('prioritizes focus, then status recency, then newer frame connection', () => {
    const base = {
      frameConnected: true,
      visibilityState: 'visible',
      hasFocus: false,
      lastReceiverStatusAtMs: startedAtMs - 10,
      frameConnectedAtMs: startedAtMs - 100,
    }
    expect(
      selectBrowserLeaseHandoffCandidate(
        [
          { ...base, clientId: 'recent' },
          {
            ...base,
            clientId: 'focused',
            hasFocus: true,
            lastReceiverStatusAtMs: startedAtMs - 100,
          },
        ],
        'active',
        startedAtMs,
      )?.clientId,
    ).toBe('focused')
    expect(
      selectBrowserLeaseHandoffCandidate(
        [
          { ...base, clientId: 'older', lastReceiverStatusAtMs: startedAtMs - 20 },
          { ...base, clientId: 'recent' },
        ],
        'active',
        startedAtMs,
      )?.clientId,
    ).toBe('recent')
    expect(
      selectBrowserLeaseHandoffCandidate(
        [
          { ...base, clientId: 'older-connection' },
          {
            ...base,
            clientId: 'newer-connection',
            frameConnectedAtMs: startedAtMs - 50,
          },
        ],
        'active',
        startedAtMs,
      )?.clientId,
    ).toBe('newer-connection')
  })

  it.each([
    [{ frameConnected: false }, 'disconnected'],
    [{ visibilityState: 'hidden' }, 'hidden'],
    [{ lastReceiverStatusAtMs: startedAtMs - 2_500 }, 'stale'],
    [{ blockedUntilMs: startedAtMs + 1 }, 'backoff'],
  ])('rejects %s candidates', (override) => {
    const candidate = selectBrowserLeaseHandoffCandidate(
      [
        {
          clientId: 'browser-b',
          frameConnected: true,
          visibilityState: 'visible',
          hasFocus: true,
          lastReceiverStatusAtMs: startedAtMs - 10,
          frameConnectedAtMs: startedAtMs - 100,
          ...override,
        },
      ],
      'browser-a',
      startedAtMs,
    )
    expect(candidate).toBeNull()
  })

  it('uses the same health ordering for disconnect replacement and ignores unsafe fallbacks', () => {
    const orphan = {
      clientId: 'orphan-newest',
      frameConnected: true,
      visibilityState: null,
      hasFocus: false,
      lastReceiverStatusAtMs: null,
      frameConnectedAtMs: startedAtMs,
    }
    expect(
      selectBrowserLeaseHandoffCandidate([orphan], null, startedAtMs),
    ).toBeNull()
    expect(
      selectBrowserLeaseHandoffCandidate(
        [
          orphan,
          {
            clientId: 'healthy-visible',
            frameConnected: true,
            visibilityState: 'visible',
            hasFocus: true,
            lastReceiverStatusAtMs: startedAtMs - 50,
            frameConnectedAtMs: startedAtMs - 1_000,
          },
        ],
        null,
        startedAtMs,
      )?.clientId,
    ).toBe('healthy-visible')
  })

  it('runs bridge health checks from an independent periodic callback', () => {
    const check = vi.fn()
    const unref = vi.fn()
    let scheduledCallback = null
    let scheduledIntervalMs = null
    let nowMs = startedAtMs
    const timer = startBrowserLeaseHealthTimer(
      check,
      500,
      (callback, intervalMs) => {
        scheduledCallback = callback
        scheduledIntervalMs = intervalMs
        return { unref }
      },
      () => nowMs,
    )

    expect(timer).toEqual({ unref })
    expect(unref).toHaveBeenCalledOnce()
    expect(scheduledIntervalMs).toBe(500)
    nowMs += 2_750
    scheduledCallback()
    expect(check).toHaveBeenCalledWith(nowMs)
  })
})

function benchmarkRun(overrides = {}) {
  return {
    runId: 'report-validation-run',
    durationMs: 5_000,
    targetFps: 30,
    phoneStartedAtMs: startedAtMs,
    phoneCompletedAtMs: startedAtMs + 5_000,
    requestedEncoderProfile: 'low-latency',
    activeEncoderProfile: 'low-latency',
    requestedEncoderTuning: 'default',
    activeEncoderTuning: 'default',
    browserConfigId: 'browser-config-2',
    browserConfigGeneration: 2,
    requestedDecoderMode: 'software',
    appliedDecoderMode: 'software',
    decoderAccelerationConfigured: 'prefer-software',
    browserPrepareClientDurationMs: 25,
    requestedCaptureShortEdge: 960,
    captureShortEdgeActive: 960,
    captureWidthActive: 960,
    captureHeightActive: 2_088,
    captureStreamGeneration: 12,
    thermalStateStart: null,
    thermalStateEnd: null,
    thermalStateWorstObserved: null,
    thermalContaminated: false,
    producerSessionId,
    captureSource,
    ...overrides,
  }
}

function benchmarkReport(parameterOverrides = {}) {
  return {
    schemaVersion: 3,
    runId: 'report-validation-run',
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(startedAtMs + 5_000).toISOString(),
    durationMs: 5_000,
    screen: {
      codec: 'h264',
      receivedFrames: 150,
      decodedFrames: 150,
      renderedFrames: 150,
    },
    configuration: {
      fingerprint:
        `benchmark-capture960-active960-960x2088-generation12-source${captureSource}-session${producerSessionId}`,
      parameters: {
        sourceTargetFps: 30,
        encoderProfile: 'low-latency',
        encoderTuningRequested: 'default',
        encoderTuning: 'default',
        browserConfigId: 'browser-config-2',
        browserConfigGeneration: 2,
        decoderModeRequested: 'software',
        decoderModeApplied: 'software',
        decoderAccelerationConfigured: 'prefer-software',
        browserPrepareDurationMs: 25,
        captureShortEdgeRequested: 960,
        captureShortEdgeActive: 960,
        captureWidthActive: 960,
        captureHeightActive: 2_088,
        captureStreamGeneration: 12,
        thermalStateStart: null,
        thermalStateEnd: null,
        thermalStateWorstObserved: null,
        thermalContaminated: false,
        producerSessionId,
        captureSource,
        ...parameterOverrides,
      },
    },
  }
}

describe('benchmark capture configuration truth', () => {
  const status = {
    captureShortEdgeRequested: 960,
    captureShortEdgeActive: 960,
    captureWidthActive: 960,
    captureHeightActive: 2_088,
    captureStreamGeneration: 12,
  }

  it('accepts only supported dimensions whose short edge is exact', () => {
    expect(captureDimensionsValidationError(960, 960, 2_088)).toBeNull()
    expect(captureDimensionsValidationError(800, 800, 1_740)).toBe(
      'capture-active-short-edge-invalid',
    )
    expect(captureDimensionsValidationError(960, 958, 2_088)).toBe(
      'capture-active-dimensions-short-edge-mismatch',
    )
  })

  it('pins started/completed status to one requested edge, size, and generation', () => {
    expect(
      benchmarkCaptureStatusValidationError(benchmarkRun(), status),
    ).toBeNull()
    expect(
      benchmarkCaptureStatusValidationError(benchmarkRun(), {
        ...status,
        captureStreamGeneration: 11,
      }),
    ).toBe('capture-stream-generation-changed')
    expect(
      benchmarkCaptureStatusValidationError(benchmarkRun(), {
        ...status,
        captureHeightActive: 2_090,
      }),
    ).toBe('active-capture-height-changed')
    expect(
      benchmarkCaptureStatusValidationError(benchmarkRun(), {
        ...status,
        captureShortEdgeRequested: 720,
      }),
    ).toBe('requested-capture-short-edge-mismatch')
  })

  it('rejects legacy, late, and wrong-source benchmark statuses before mutation', () => {
    const envelope = {
      benchmarkProtocolVersion: 2,
      runId: 'report-validation-run',
      producerSessionId,
      captureSource,
    }
    expect(
      benchmarkStatusEnvelopeValidationError(benchmarkRun(), envelope),
    ).toBeNull()
    expect(
      benchmarkStatusEnvelopeValidationError(benchmarkRun(), {
        ...envelope,
        benchmarkProtocolVersion: 1,
      }),
    ).toBe('benchmark-protocol-version-mismatch')
    expect(
      benchmarkStatusEnvelopeValidationError(benchmarkRun(), {
        ...envelope,
        runId: 'late-run',
      }),
    ).toBe('run-id-mismatch')
    expect(
      benchmarkStatusEnvelopeValidationError(benchmarkRun(), {
        ...envelope,
        captureSource: 'replaykit-broadcast-upload',
      }),
    ).toBe('status-producer-identity-mismatch')
    expect(
      benchmarkStatusEnvelopeValidationError(benchmarkRun(), {
        ...envelope,
        thermalState: 'overheated',
      }),
    ).toBe('thermal-state-invalid')
  })

  it('invalidates measured frame or heartbeat drift and missing generations', () => {
    const run = benchmarkRun()
    expect(
      measuredCaptureConfigurationError(run, {
        width: 960,
        height: 2_088,
        captureStreamGeneration: 12,
      }),
    ).toBeNull()
    expect(
      measuredCaptureConfigurationError(run, {
        width: 960,
        height: 2_088,
      }),
    ).toBe('capture-stream-generation-missing')
    expect(
      measuredCaptureConfigurationError(run, {
        width: 960,
        height: 2_088,
        captureStreamGeneration: 13,
      }),
    ).toBe('capture-stream-generation-drift')
    expect(
      measuredCaptureConfigurationError(run, {
        width: 960,
        height: 2_090,
        captureShortEdgeActive: 960,
        captureWidthActive: 960,
        captureHeightActive: 2_088,
        captureStreamGeneration: 12,
      }),
    ).toBe('frame-capture-dimensions-drift')
    expect(
      measuredCaptureConfigurationError(
        run,
        {
          ...status,
          captureWidthActive: undefined,
        },
        { requireNamedDimensions: true },
      ),
    ).toBe('active-capture-dimensions-missing')
  })

  it('binds a reconnected frame socket only when its latest capture identity matches', () => {
    const required = {
      captureShortEdgeRequested: 720,
      captureShortEdgeActive: 720,
      captureWidthActive: 720,
      captureHeightActive: 1_566,
      captureStreamGeneration: 8,
    }
    expect(captureConfigurationMatches({ ...required }, required)).toBe(true)
    expect(
      captureConfigurationMatches(
        { ...required, captureStreamGeneration: 7 },
        required,
      ),
    ).toBe(false)
    expect(
      captureConfigurationMatches(
        { ...required, captureShortEdgeRequested: null },
        required,
      ),
    ).toBe(true)
  })
})

describe('benchmark source and thermal truth', () => {
  it('accepts only ScreenCaptureKit as the resolution benchmark source', () => {
    expect(
      resolutionBenchmarkCaptureSourceError({
        pair: { captureSource: 'screencapturekit-host' },
      }),
    ).toBeNull()
    expect(
      resolutionBenchmarkCaptureSourceError({
        pair: { captureSource: 'replaykit-broadcast-upload' },
      }),
    ).toBe('screencapturekit-host-required')
    expect(resolutionBenchmarkCaptureSourceError({ pair: null })).toBeNull()
  })

  it('records start/end/worst thermal state without inventing missing values', () => {
    const run = benchmarkRun()
    expect(worstThermalState('fair', 'nominal')).toBe('fair')
    expect(worstThermalState(null, 'fair')).toBe('fair')
    expect(observeBenchmarkThermalState(run, undefined, 'started')).toBe(false)
    expect(run.thermalStateStart).toBeNull()

    observeBenchmarkThermalState(run, 'fair', 'started')
    observeBenchmarkThermalState(run, 'serious')
    observeBenchmarkThermalState(run, 'nominal', 'completed')
    expect(run).toMatchObject({
      thermalStateStart: 'fair',
      thermalStateEnd: 'nominal',
      thermalStateWorstObserved: 'serious',
      thermalContaminated: true,
    })
  })
})

describe('bridge benchmark report encoder tuning validation', () => {
  it('accepts explicit requested and active tuning, including a verified fallback', () => {
    expect(
      benchmarkReportValidationError(benchmarkRun(), benchmarkReport()),
    ).toBeNull()

    expect(
      benchmarkReportValidationError(
        benchmarkRun({
          requestedEncoderTuning: 'high-speed-preset',
          activeEncoderTuning: 'default',
        }),
        benchmarkReport({
          encoderTuningRequested: 'high-speed-preset',
          encoderTuning: 'default',
        }),
      ),
    ).toBeNull()
  })

  it.each([undefined, null])(
    'rejects a missing requested tuning value (%s) instead of defaulting it',
    (encoderTuningRequested) => {
      expect(
        benchmarkReportValidationError(
          benchmarkRun(),
          benchmarkReport({ encoderTuningRequested }),
        ),
      ).toBe('invalid-report-requested-encoder-tuning')
    },
  )

  it.each([undefined, null])(
    'rejects a missing active tuning value (%s) instead of defaulting it',
    (encoderTuning) => {
      expect(
        benchmarkReportValidationError(
          benchmarkRun(),
          benchmarkReport({ encoderTuning }),
        ),
      ).toBe('invalid-report-encoder-tuning')
    },
  )

  it('distinguishes explicit invalid values from valid mismatches', () => {
    expect(
      benchmarkReportValidationError(
        benchmarkRun(),
        benchmarkReport({ encoderTuningRequested: 'unknown' }),
      ),
    ).toBe('invalid-report-requested-encoder-tuning')
    expect(
      benchmarkReportValidationError(
        benchmarkRun(),
        benchmarkReport({ encoderTuningRequested: 'speed-priority' }),
      ),
    ).toBe('report-requested-encoder-tuning-mismatch')
    expect(
      benchmarkReportValidationError(
        benchmarkRun(),
        benchmarkReport({ encoderTuning: 'speed-priority' }),
      ),
    ).toBe('report-encoder-tuning-mismatch')
  })

  it.each([
    ['browserConfigId', 'stale-config', 'report-browser-config-id-mismatch'],
    [
      'browserConfigGeneration',
      1,
      'report-browser-config-generation-mismatch',
    ],
    ['decoderModeApplied', 'auto', 'report-decoder-mode-mismatch'],
    [
      'decoderAccelerationConfigured',
      'no-preference',
      'report-decoder-acceleration-mismatch',
    ],
    [
      'browserPrepareDurationMs',
      26,
      'report-browser-prepare-duration-mismatch',
    ],
    [
      'captureShortEdgeActive',
      720,
      'report-capture-dimensions-mismatch',
    ],
    [
      'captureStreamGeneration',
      11,
      'report-capture-stream-generation-mismatch',
    ],
    ['thermalContaminated', true, 'report-thermal-state-mismatch'],
  ])('rejects a changed browser config field %s', (field, value, expected) => {
    expect(
      benchmarkReportValidationError(
        benchmarkRun(),
        benchmarkReport({ [field]: value }),
      ),
    ).toBe(expected)
  })

  it('requires the capture identity in the report fingerprint', () => {
    const report = benchmarkReport()
    report.configuration.fingerprint =
      `benchmark-source${captureSource}-session${producerSessionId}`
    expect(
      benchmarkReportValidationError(benchmarkRun(), report),
    ).toBe('report-capture-fingerprint-mismatch')
  })
})

describe('bridge running encoder heartbeat validation', () => {
  const activeHeartbeat = {
    encoderProfileActive: 'low-latency',
    encoderTuningActive: 'default',
    captureShortEdgeRequested: 960,
    captureShortEdgeActive: 960,
    captureWidthActive: 960,
    captureHeightActive: 2_088,
    captureStreamGeneration: 12,
  }

  it('does not require active configuration during requested warmup', () => {
    expect(
      benchmarkEncoderStatusValidationError(
        benchmarkRun({ phase: 'requested' }),
        {},
      ),
    ).toBeNull()
  })

  it('allows capture startup during warmup but not during measurement', () => {
    const starting = {
      captureState: 'starting',
      encoderStatus: 0,
      codec: 'H.264',
      captureContentStatus: 'started',
      freshContent: true,
    }
    expect(
      benchmarkEncoderReadinessError(
        benchmarkRun({ phase: 'requested' }),
        starting,
      ),
    ).toBeNull()
    expect(
      benchmarkEncoderReadinessError(
        benchmarkRun({ phase: 'running' }),
        starting,
      ),
    ).toBe('capture-state-starting')
    expect(
      benchmarkEncoderReadinessError(
        benchmarkRun({ phase: 'running' }),
        { ...starting, captureState: 'streaming' },
      ),
    ).toBeNull()
  })

  it.each(['running', 'awaiting-report'])(
    'requires the pinned active configuration while %s',
    (phase) => {
      const run = benchmarkRun({ phase })
      expect(
        benchmarkEncoderStatusValidationError(run, activeHeartbeat),
      ).toBeNull()
      expect(
        benchmarkEncoderStatusValidationError(run, {
          encoderTuningActive: 'default',
        }),
      ).toBe('encoder-active-profile-missing')
      expect(
        benchmarkEncoderStatusValidationError(run, {
          encoderProfileActive: 'low-latency',
        }),
      ).toBe('encoder-active-tuning-missing')
      expect(
        benchmarkEncoderStatusValidationError(run, {
          ...activeHeartbeat,
          encoderProfileActive: 'legacy',
        }),
      ).toBe('encoder-active-profile-changed')
      expect(
        benchmarkEncoderStatusValidationError(run, {
          ...activeHeartbeat,
          encoderTuningActive: 'video-conferencing-preset',
        }),
      ).toBe('encoder-active-tuning-changed')
    },
  )
})

describe('bridge lightweight benchmark status', () => {
  it('reports active and accepted run identities without the full report', () => {
    const rawSampleSentinel = 'raw-sample-must-not-be-serialized'
    const active = {
      runId: 'active-run',
      phase: 'running',
      valid: true,
    }
    const status = benchmarkStatusPayload(
      {
        runId: 'accepted-run',
        receivedAtMs: 2_000_000_010_000,
        report: {
          screen: { frames: [rawSampleSentinel] },
          pose: { samples: [rawSampleSentinel] },
        },
      },
      active,
    )

    expect(status).toEqual({
      ok: true,
      latestAccepted: {
        runId: 'accepted-run',
        receivedAtMs: 2_000_000_010_000,
      },
      active,
    })
    expect(JSON.stringify(status)).not.toContain(rawSampleSentinel)
    expect(status.latestAccepted).not.toHaveProperty('report')
  })

  it('reports idle state without inventing an accepted run', () => {
    expect(benchmarkStatusPayload(null, null)).toEqual({
      ok: true,
      latestAccepted: null,
      active: null,
    })
  })
})

describe('bridge browser frame backpressure admission', () => {
  const maximumBufferedBytes = 64 * 1024

  it('admits one oversized frame when the browser queue is empty', () => {
    expect(
      shouldDropBrowserFrameForBackpressure(
        0,
        maximumBufferedBytes * 2,
        maximumBufferedBytes,
      ),
    ).toBe(false)
  })

  it('rejects an oversized frame when any older bytes are queued', () => {
    expect(
      shouldDropBrowserFrameForBackpressure(
        1,
        maximumBufferedBytes * 2,
        maximumBufferedBytes,
      ),
    ).toBe(true)
  })

  it('rejects a small frame when its projected queue crosses the limit', () => {
    expect(
      shouldDropBrowserFrameForBackpressure(
        maximumBufferedBytes - 1,
        2,
        maximumBufferedBytes,
      ),
    ).toBe(true)
  })

  it('admits a frame that makes the projected queue exactly the limit', () => {
    expect(
      shouldDropBrowserFrameForBackpressure(
        maximumBufferedBytes - 1_024,
        1_024,
        maximumBufferedBytes,
      ),
    ).toBe(false)
  })

  it('rejects another byte once the queue is already at the limit', () => {
    expect(
      shouldDropBrowserFrameForBackpressure(
        maximumBufferedBytes,
        1,
        maximumBufferedBytes,
      ),
    ).toBe(true)
  })
})
