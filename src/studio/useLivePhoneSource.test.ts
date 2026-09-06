import { describe, expect, it } from 'vitest'
import {
  buildH264DecoderConfig,
  buildH264MeasurementConfiguration,
  browserClientIdForSession,
  browserPrepareReadyAck,
  browserReceiverStatusHeartbeatDue,
  bridgeReconnectDelayMs,
  commitStateIfChanged,
  currentTextureUploadFrameId,
  decodeH264DecoderDescription,
  h264DecoderBacklogResetReason,
  h264DecoderBacklogPolicy,
  h264DecoderConfigurationKey,
  h264DecoderSelectionFromSearch,
  h264BitstreamFormatFromSearch,
  initialH264DecoderDiagnostics,
  liveFrameErrorAfterSuccessfulDecode,
  nextValidFrameLatencyMs,
  recordH264DecoderReset,
  screenStreamIsStale,
  sendH264FormatAfterReceiverStatus,
  worstObservedThermalState,
} from './useLivePhoneSource'
import { studioRenderConfigurationFromSearch } from './renderConfiguration'

describe('hot-path state deduplication', () => {
  it('commits only when the next value differs', () => {
    const current = { current: 'ready' }
    const commits: string[] = []

    expect(commitStateIfChanged(current, 'ready', (value) => commits.push(value))).toBe(
      false,
    )
    expect(commitStateIfChanged(current, 'error', (value) => commits.push(value))).toBe(
      true,
    )
    expect(commitStateIfChanged(current, 'error', (value) => commits.push(value))).toBe(
      false,
    )
    expect(current.current).toBe('error')
    expect(commits).toEqual(['error'])
  })

  it('supports structural equality without losing the latest committed value', () => {
    const current = { current: { width: 884, height: 1_920 } }
    const commits: Array<{ width: number; height: number }> = []
    const sameDimensions = (
      left: { width: number; height: number },
      right: { width: number; height: number },
    ) => left.width === right.width && left.height === right.height

    expect(
      commitStateIfChanged(
        current,
        { width: 884, height: 1_920 },
        (value) => commits.push(value),
        sameDimensions,
      ),
    ).toBe(false)
    expect(
      commitStateIfChanged(
        current,
        { width: 960, height: 2_088 },
        (value) => commits.push(value),
        sameDimensions,
      ),
    ).toBe(true)
    expect(current.current).toEqual({ width: 960, height: 2_088 })
    expect(commits).toEqual([{ width: 960, height: 2_088 }])
  })
})

describe('VideoFrame texture upload attribution', () => {
  it('attributes an upload only when the pending, retained, and texture sources match', () => {
    const frame = { id: 'frame-42' }
    const replacement = { id: 'frame-43' }
    const pending = { frameId: 42, source: frame }

    expect(currentTextureUploadFrameId(pending, frame, frame)).toBe(42)
    expect(currentTextureUploadFrameId(pending, replacement, replacement)).toBeNull()
    expect(currentTextureUploadFrameId(pending, frame, replacement)).toBeNull()
    expect(currentTextureUploadFrameId(null, frame, frame)).toBeNull()
  })
})

describe('live bridge reconnect policy', () => {
  it('retries quickly, backs off, and remains bounded', () => {
    expect(bridgeReconnectDelayMs(0)).toBe(250)
    expect(bridgeReconnectDelayMs(1)).toBe(500)
    expect(bridgeReconnectDelayMs(4)).toBe(4_000)
    expect(bridgeReconnectDelayMs(5)).toBe(5_000)
    expect(bridgeReconnectDelayMs(20)).toBe(5_000)
  })

  it('does not let encoder heartbeats conceal a frozen pixel pipeline', () => {
    expect(screenStreamIsStale(10_000, 1_000, 9_000)).toBe(true)
    expect(screenStreamIsStale(10_000, 9_500, 7_000)).toBe(false)
    expect(screenStreamIsStale(10_000, 8_500, null)).toBe(true)
    expect(screenStreamIsStale(10_000, null, 9_000)).toBe(false)
    expect(screenStreamIsStale(10_000, null, 7_000)).toBe(true)
    expect(screenStreamIsStale(10_000, null, 9_900, 7_000)).toBe(true)
  })
})

describe('browser client identity', () => {
  it('reuses one per-tab identity across page reloads', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    let sequence = 0
    const createId = () => `browser-${++sequence}`

    expect(browserClientIdForSession(storage, createId)).toBe('browser-1')
    expect(browserClientIdForSession(storage, createId)).toBe('browser-1')
    expect(sequence).toBe(1)
  })

  it('falls back to a fresh identity when session storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
    }

    expect(browserClientIdForSession(storage, () => 'fallback')).toBe(
      'fallback',
    )
  })
})

describe('H.264 decoder runtime selection', () => {
  it('keys decoder instances by acceleration hint and browser config generation', () => {
    const software = h264DecoderSelectionFromSearch('?decoder=software')
    const hardware = h264DecoderSelectionFromSearch('?decoder=hardware')
    const base = h264DecoderConfigurationKey(
      'avc1.420029',
      'annex-b',
      null,
      software,
      1,
    )

    expect(
      h264DecoderConfigurationKey(
        'avc1.420029',
        'annex-b',
        null,
        hardware,
        1,
      ),
    ).not.toBe(base)
    expect(
      h264DecoderConfigurationKey(
        'avc1.420029',
        'annex-b',
        null,
        software,
        2,
      ),
    ).not.toBe(base)
  })

  it('acknowledges prepare only after the exact decoder generation renders', () => {
    const pending = {
      runId: 'run-1',
      browserConfigId: 'config-2',
      generation: 2,
      decoderMode: 'hardware' as const,
      decoderAcceleration: 'prefer-hardware' as const,
      requestedAtMs: 1_000,
    }
    const runtime = {
      browserConfigId: 'config-2',
      generation: 2,
      requestedMode: 'hardware' as const,
      appliedMode: 'hardware' as const,
      configuredAcceleration: 'prefer-hardware' as const,
      prepareDurationMs: null,
    }

    expect(browserPrepareReadyAck(pending, runtime, 42, 1, 1_025)).toBeNull()
    expect(
      browserPrepareReadyAck(
        pending,
        { ...runtime, browserConfigId: 'stale-config' },
        42,
        2,
        1_025,
      ),
    ).toBeNull()
    expect(browserPrepareReadyAck(pending, runtime, 42, 2, 1_025)).toEqual({
      type: 'browser-benchmark-prepare-ack',
      status: 'ready',
      runId: 'run-1',
      browserConfigId: 'config-2',
      browserConfigGeneration: 2,
      decoderModeRequested: 'hardware',
      decoderModeApplied: 'hardware',
      decoderAccelerationConfigured: 'prefer-hardware',
      renderedFrameId: 42,
      preparedAtMs: 1_025,
      prepareDurationMs: 25,
    })
  })

  it.each([
    ['', 'software', 'prefer-software'],
    ['?decoder=software', 'software', 'prefer-software'],
    ['?decoder=hardware', 'hardware', 'prefer-hardware'],
    ['?decoder=auto', 'auto', 'no-preference'],
    ['?decoder=unsupported', 'software', 'prefer-software'],
  ] as const)(
    'maps %s to %s / %s',
    (search, expectedMode, expectedAcceleration) => {
      expect(h264DecoderSelectionFromSearch(search)).toEqual({
        mode: expectedMode,
        hardwareAcceleration: expectedAcceleration,
      })
    },
  )

  it.each([
    ['', 'annex-b'],
    ['?decoder=software', 'annex-b'],
    ['?decoder=hardware', 'avcc'],
    ['?decoder=auto', 'annex-b'],
    ['?decoder=hardware&h264=annex-b', 'annex-b'],
    ['?decoder=software&h264=avcc', 'avcc'],
    ['?decoder=hardware&h264=unsupported', 'avcc'],
  ] as const)('maps %s to H.264 %s framing', (search, expectedFormat) => {
    expect(h264BitstreamFormatFromSearch(search)).toBe(expectedFormat)
  })

  it('adds description only for AVCC decoder configurations', () => {
    const selection = h264DecoderSelectionFromSearch('?decoder=hardware')
    const avcC = 'AWQAKv/hAARnZAAqAQACaAD9+PgA'
    const annexB = buildH264DecoderConfig(
      'avc1.64002a',
      selection,
      'annex-b',
      null,
    )
    const avcc = buildH264DecoderConfig(
      'avc1.64002a',
      selection,
      'avcc',
      avcC,
    )

    expect(annexB).toMatchObject({
      codec: 'avc1.64002a',
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    })
    expect(annexB).not.toHaveProperty('description')
    expect([...(avcc?.description as Uint8Array)]).toEqual([
      1, 100, 0, 42, 255, 225, 0, 4, 103, 100, 0, 42, 1, 0, 2, 104, 0,
      253, 248, 248, 0,
    ])
    expect(buildH264DecoderConfig('avc1.64002a', selection, 'avcc', null)).toBeNull()
    expect(decodeH264DecoderDescription('not base64')).toBeNull()
  })

  it('announces the receiver lease before its scoped format command', () => {
    const sends: string[] = []
    sendH264FormatAfterReceiverStatus(
      () => sends.push('browser-receiver-status'),
      () => sends.push('h264-output-format'),
    )
    expect(sends).toEqual(['browser-receiver-status', 'h264-output-format'])
  })

  it('keeps inactive receiver telemetry alive without assuming exact timer cadence', () => {
    expect(browserReceiverStatusHeartbeatDue(1_000, null)).toBe(true)
    expect(browserReceiverStatusHeartbeatDue(1_999, 1_000)).toBe(false)
    expect(browserReceiverStatusHeartbeatDue(2_000, 1_000)).toBe(true)
    // A background tab can be throttled for much longer than one interval. Its
    // first delayed callback must publish immediately instead of waiting for an
    // exact wall-clock slot or trying to replay missed ticks.
    expect(browserReceiverStatusHeartbeatDue(8_750, 1_000)).toBe(true)
    expect(browserReceiverStatusHeartbeatDue(900, 1_000)).toBe(true)
  })

  it('uses the resolved WebCodecs hint in parameters and the fingerprint', () => {
    const configurations = ['software', 'hardware', 'auto'].map((mode) => {
      const decoderSelection = h264DecoderSelectionFromSearch(
        `?decoder=${mode}`,
      )
      return buildH264MeasurementConfiguration({
        decoderSelection,
        bitstreamFormat: h264BitstreamFormatFromSearch(`?decoder=${mode}`),
        devicePixelRatio: 2,
        sourceTargetFps: 30,
      })
    })

    expect(configurations.map(({ fingerprint }) => fingerprint)).toEqual([
      expect.stringContaining('software-prefer-software'),
      expect.stringContaining('hardware-prefer-hardware'),
      expect.stringContaining('auto-no-preference'),
    ])
    expect(
      configurations.map(({ parameters }) => parameters.decoderAcceleration),
    ).toEqual(['prefer-software', 'prefer-hardware', 'no-preference'])
    expect(configurations.map(({ parameters }) => parameters.decoderMode)).toEqual(
      ['software', 'hardware', 'auto'],
    )
    expect(
      configurations.map(
        ({ parameters }) => parameters.h264BitstreamFormatRequested,
      ),
    ).toEqual(['annex-b', 'avcc', 'annex-b'])
    expect(
      configurations.map(({ parameters }) => parameters.decoderBacklogPolicy),
    ).toEqual(['default', 'hardware-avcc', 'default'])
    expect(new Set(configurations.map(({ fingerprint }) => fingerprint)).size).toBe(
      3,
    )
  })

  it('defaults manual recordings to the ReplayKit low-latency profile', () => {
    const configuration = buildH264MeasurementConfiguration({
      decoderSelection: h264DecoderSelectionFromSearch(''),
      devicePixelRatio: 2,
    })

    expect(configuration.parameters.sourceTargetFps).toBe(30)
    expect(configuration.parameters.encoderProfile).toBe('low-latency')
    expect(configuration.parameters.encoderTuning).toBe('default')
    expect(configuration.parameters.encoderTuningRequested).toBe('default')
    expect(configuration.parameters.browserPrepareDurationMs).toBeNull()
    expect(configuration.fingerprint).toContain('low-latency')
    expect(configuration.fingerprint).toContain(
      'tuningdefault-requesteddefault',
    )
    expect(configuration.fingerprint).toContain('fps30')
  })

  it('reports prepare duration without changing the configuration fingerprint', () => {
    const decoderSelection = h264DecoderSelectionFromSearch('')
    const withoutDuration = buildH264MeasurementConfiguration({
      decoderSelection,
      browserConfigId: 'config-2',
      browserConfigGeneration: 2,
    })
    const prepared = buildH264MeasurementConfiguration({
      decoderSelection,
      browserConfigId: 'config-2',
      browserConfigGeneration: 2,
      browserPrepareDurationMs: 42.5,
    })

    expect(prepared.parameters.browserPrepareDurationMs).toBe(42.5)
    expect(prepared.fingerprint).toBe(withoutDuration.fingerprint)
  })

  it('binds capture resolution and stream generation into report identity', () => {
    const configuration = buildH264MeasurementConfiguration({
      decoderSelection: h264DecoderSelectionFromSearch(''),
      captureShortEdgeRequested: 720,
      captureShortEdgeActive: 720,
      captureWidthActive: 720,
      captureHeightActive: 1_566,
      captureStreamGeneration: 8,
    })

    expect(configuration.parameters).toMatchObject({
      captureShortEdgeRequested: 720,
      captureShortEdgeActive: 720,
      captureWidthActive: 720,
      captureHeightActive: 1_566,
      captureStreamGeneration: 8,
    })
    expect(configuration.fingerprint).toContain(
      '-capture720-active720-720x1566-generation8-',
    )
  })

  it('records the worst thermal state and keeps it outside the stable fingerprint', () => {
    expect(worstObservedThermalState(null, null)).toBeNull()
    expect(worstObservedThermalState('fair', 'nominal')).toBe('fair')
    expect(worstObservedThermalState('fair', 'critical')).toBe('critical')

    const decoderSelection = h264DecoderSelectionFromSearch('')
    const nominal = buildH264MeasurementConfiguration({
      decoderSelection,
      thermalStateStart: 'nominal',
      thermalStateEnd: 'fair',
      thermalStateWorstObserved: 'fair',
      thermalContaminated: false,
    })
    const serious = buildH264MeasurementConfiguration({
      decoderSelection,
      thermalStateStart: 'nominal',
      thermalStateEnd: 'serious',
      thermalStateWorstObserved: 'serious',
      thermalContaminated: true,
    })

    expect(serious.parameters).toMatchObject({
      thermalStateStart: 'nominal',
      thermalStateEnd: 'serious',
      thermalStateWorstObserved: 'serious',
      thermalContaminated: true,
    })
    expect(serious.fingerprint).toBe(nominal.fingerprint)
  })

  it('fingerprints requested and active encoder tuning without mislabeling fallback', () => {
    const decoderSelection = h264DecoderSelectionFromSearch('')
    const applied = buildH264MeasurementConfiguration({
      decoderSelection,
      encoderProfile: 'legacy',
      encoderTuning: 'high-speed-preset',
      encoderTuningRequested: 'high-speed-preset',
    })
    const fallback = buildH264MeasurementConfiguration({
      decoderSelection,
      encoderProfile: 'legacy',
      encoderTuning: 'default',
      encoderTuningRequested: 'high-speed-preset',
    })

    expect(applied.parameters).toMatchObject({
      encoderTuning: 'high-speed-preset',
      encoderTuningRequested: 'high-speed-preset',
    })
    expect(fallback.parameters).toMatchObject({
      encoderTuning: 'default',
      encoderTuningRequested: 'high-speed-preset',
    })
    expect(applied.fingerprint).not.toBe(fallback.fingerprint)
    expect(fallback.fingerprint).toContain(
      'tuningdefault-requestedhigh-speed-preset',
    )
  })

  it('binds benchmark configuration and fingerprint to one producer identity', () => {
    const configuration = buildH264MeasurementConfiguration({
      decoderSelection: h264DecoderSelectionFromSearch(''),
      producerSessionId: 'producer-session-1',
      captureSource: 'screencapturekit-host',
    })

    expect(configuration.parameters).toMatchObject({
      producerSessionId: 'producer-session-1',
      captureSource: 'screencapturekit-host',
    })
    expect(configuration.fingerprint).toContain(
      '-sourcescreencapturekit-host-sessionproducer-session-1',
    )
  })

  it('keeps quality and latency Canvas benchmark samples in separate fingerprints', () => {
    const decoderSelection = h264DecoderSelectionFromSearch('')
    const quality = buildH264MeasurementConfiguration({
      decoderSelection,
      renderConfiguration: studioRenderConfigurationFromSearch(
        '?render=quality',
        2.5,
      ),
    })
    const latency = buildH264MeasurementConfiguration({
      decoderSelection,
      renderConfiguration: studioRenderConfigurationFromSearch(
        '?render=latency',
        2.5,
      ),
    })

    expect(quality.parameters).toMatchObject({
      browserDevicePixelRatio: 2.5,
      renderPreset: 'quality',
      renderDevicePixelRatio: 2,
      renderDprPolicy: 'clamp-1-2',
      renderAntialias: true,
      renderCanvasShadows: 'basic',
      renderSoftShadows: true,
    })
    expect(latency.parameters).toMatchObject({
      browserDevicePixelRatio: 2.5,
      renderPreset: 'latency',
      renderDevicePixelRatio: 2,
      renderDprPolicy: 'clamp-1-2',
      renderAntialias: true,
      renderCanvasShadows: 'disabled',
      renderSoftShadows: false,
    })
    expect(quality.fingerprint).toContain(
      'renderquality-dpr2-aa1-shadowbasic-soft1',
    )
    expect(latency.fingerprint).toContain(
      'renderlatency-dpr2-aa1-shadowdisabled-soft0',
    )
    expect(quality.fingerprint).not.toBe(latency.fingerprint)
  })

  it('binds scheduler mode, cap, phase credit, and generation into benchmark identity', () => {
    const decoderSelection = h264DecoderSelectionFromSearch('')
    const vsync = buildH264MeasurementConfiguration({
      decoderSelection,
      renderConfiguration: studioRenderConfigurationFromSearch(
        '?renderSchedule=vsync',
        2,
      ),
      renderSchedulerGeneration: 1,
    })
    const phase = buildH264MeasurementConfiguration({
      decoderSelection,
      renderConfiguration: studioRenderConfigurationFromSearch(
        '?renderSchedule=phase',
        2,
      ),
      renderSchedulerModeApplied: 'phase',
      renderSchedulerGeneration: 4,
    })

    expect(vsync.parameters).toMatchObject({
      renderSchedulerModeRequested: 'vsync',
      renderSchedulerModeApplied: 'vsync',
      renderSchedulerGeneration: 1,
      renderSchedulerCapHz: null,
      renderSchedulerPhaseCreditFrames: 0,
    })
    expect(phase.parameters).toMatchObject({
      renderSchedulerModeRequested: 'phase',
      renderSchedulerModeApplied: 'phase',
      renderSchedulerGeneration: 4,
      renderSchedulerCapHz: 120,
      renderSchedulerPhaseCreditFrames: 1,
    })
    expect(vsync.fingerprint).toContain(
      '-schedulevsync-vsync-sg1-capnative-credit0-',
    )
    expect(phase.fingerprint).toContain(
      '-schedulephase-phase-sg4-cap120-credit1-',
    )
    expect(phase.fingerprint).not.toBe(vsync.fingerprint)
  })
})

describe('H.264 decoder recovery diagnostics', () => {
  it('admits a three-frame transport burst without relaxing its age limit', () => {
    const selection = h264DecoderSelectionFromSearch('?decoder=software')
    const policy = h264DecoderBacklogPolicy(selection, 'annex-b', 3)
    expect(policy).toEqual({ name: 'transport-window-3',
      maxQueueSize: 3, maxPendingFrames: 3, maxFrameAgeMs: 75 })
    expect(h264DecoderBacklogResetReason(2, 2, 74, policy)).toBeNull()
    expect(h264DecoderBacklogResetReason(3, 0, 0, policy)).toBe('queue')
    expect(h264DecoderBacklogResetReason(0, 3, 0, policy)).toBe('pending')
    expect(h264DecoderBacklogResetReason(0, 0, 76, policy)).toBe('age')
    for (const window of [null, 1, 2, 4, 100, Number.NaN]) {
      expect(h264DecoderBacklogPolicy(selection, 'annex-b', window).maxPendingFrames).toBe(2)
    }
    const configuration = buildH264MeasurementConfiguration({
      decoderSelection: selection, frameAckWindow: 3,
    })
    expect(configuration.parameters).toMatchObject({
      frameAckWindow: 3, decoderMaxPendingFrames: 3, decoderMaxFrameAgeMs: 75,
    })
    expect(configuration.fingerprint).toContain('rawtcp-nodelay-w3-')
  })

  it('classifies backlog resets at the configured boundaries', () => {
    expect(h264DecoderBacklogResetReason(2, 0, 0)).toBe('queue')
    expect(h264DecoderBacklogResetReason(0, 2, 0)).toBe('pending')
    expect(h264DecoderBacklogResetReason(0, 0, 75)).toBeNull()
    expect(h264DecoderBacklogResetReason(0, 0, 76)).toBe('age')
    expect(h264DecoderBacklogResetReason(0, 0, 0)).toBeNull()
  })

  it('gives hardware AVCC a bounded startup window without changing Annex-B', () => {
    const selection = h264DecoderSelectionFromSearch('?decoder=hardware')
    const hardwareAvcc = h264DecoderBacklogPolicy(selection, 'avcc')
    const hardwareAnnexB = h264DecoderBacklogPolicy(selection, 'annex-b')

    expect(hardwareAvcc).toEqual({
      name: 'hardware-avcc',
      maxQueueSize: 8,
      maxPendingFrames: 8,
      maxFrameAgeMs: 250,
    })
    expect(h264DecoderBacklogResetReason(2, 2, 76, hardwareAvcc)).toBeNull()
    expect(h264DecoderBacklogResetReason(8, 0, 0, hardwareAvcc)).toBe('queue')
    expect(h264DecoderBacklogResetReason(0, 8, 0, hardwareAvcc)).toBe('pending')
    expect(h264DecoderBacklogResetReason(0, 0, 251, hardwareAvcc)).toBe('age')
    expect(hardwareAnnexB).toEqual({
      name: 'default',
      maxQueueSize: 2,
      maxPendingFrames: 2,
      maxFrameAgeMs: 75,
    })
  })

  it('uses a stable primary reason and counts error recovery separately', () => {
    expect(h264DecoderBacklogResetReason(2, 2, 100)).toBe('queue')

    let diagnostics = initialH264DecoderDiagnostics()
    diagnostics = recordH264DecoderReset(diagnostics, 'queue')
    diagnostics = recordH264DecoderReset(diagnostics, 'age')
    diagnostics = recordH264DecoderReset(diagnostics, 'error')

    expect(diagnostics).toEqual({
      resets: 3,
      errors: 1,
      resetReasons: {
        queue: 1,
        pending: 0,
        age: 1,
        configuration: 0,
        error: 1,
      },
      lastResetReason: 'error',
    })
  })

  it('clears a recovered frame decoder alert without hiding other failures', () => {
    expect(
      liveFrameErrorAfterSuccessfulDecode(
        'The browser H.264 decoder rejected the live stream.',
      ),
    ).toBeNull()
    expect(
      liveFrameErrorAfterSuccessfulDecode(
        'The live bridge sent a frame this browser could not decode.',
      ),
    ).toBeNull()
    expect(
      liveFrameErrorAfterSuccessfulDecode(
        'Cannot reach the local phone bridge on port 4319.',
      ),
    ).toBe('Cannot reach the local phone bridge on port 4319.')
    expect(liveFrameErrorAfterSuccessfulDecode(null)).toBeNull()
  })

  it('retains the latest valid frame latency across invalid timestamps', () => {
    expect(nextValidFrameLatencyMs(null, 120, null)).toBeNull()
    expect(nextValidFrameLatencyMs(null, 120, 100)).toBe(20)
    expect(nextValidFrameLatencyMs(20, 130, null)).toBe(20)
    expect(nextValidFrameLatencyMs(20, 100, 110)).toBe(20)
  })
})
