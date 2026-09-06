import { describe, expect, it } from 'vitest'
import { parseFrameTransportConfiguration, rawFrameLivenessExpired, wirelessSampleErrors } from './frame-transport-contract.mjs'

describe('bounded transport requests', () => {
  it('rejects ambiguous or unbounded configurations', () => {
    for (const query of ['route=wifi-only&window=0', 'route=wifi-only&window=4', 'route=wifi-only&window=02', 'route=unknown&window=2', 'route=wifi-only']) {
      expect(parseFrameTransportConfiguration(new URLSearchParams(query))).toBeNull()
    }
    expect(parseFrameTransportConfiguration(new URLSearchParams('route=wifi-only&window=2'))).toEqual({ route: 'wifi-only', window: 2 })
  })
})

describe('static raw-frame liveness', () => {
  const raw = { producerSessionId: 'a', captureSource: 'sck', producerIdentityValid: true, lastFrameAtMs: 0 }
  const pose = { ...raw, lastCaptureState: 'streaming', lastCaptureHeartbeatAtMs: 59_000 }
  it('keeps a static identified capture alive without requesting periodic IDRs', () => {
    expect(rawFrameLivenessExpired(raw, [pose], 60_000)).toBe(false)
  })
  it('does not borrow heartbeats from other sessions, inactive captures, or stale producers', () => {
    for (const change of [{ producerSessionId: 'b' }, { captureSource: 'other' }, { lastCaptureState: 'idle' },
      { lastCaptureHeartbeatAtMs: 55_000 }, { producerIdentityValid: false }]) {
      expect(rawFrameLivenessExpired(raw, [{ ...pose, ...change }], 60_000)).toBe(true)
    }
    expect(rawFrameLivenessExpired({ ...raw, producerIdentityValid: null }, [pose], 60_000)).toBe(true)
    expect(rawFrameLivenessExpired({ lastActivityAtMs: 59_000 }, [], 60_000)).toBe(false)
  })
})

describe('wireless evidence isolation', () => {
  const encoder = { bridgeReceivedAtMs: 1_000, frameTransportConfigurationId: 'a', frameAckWindow: 2,
    frameSocketRoutePreference: 'wifi-only', frameSocketRouteUsesWiFi: true, frameSocketRouteUsesWiredEthernet: false,
    encoderAverageBitRate: 15_000_000, captureWidthActive: 960, captureHeightActive: 2088,
    encoderMediaTimeline: 'source-timestamps-v1', thermalState: 'nominal', appForeground: true }
  const diagnostics = { encoderSamples: [encoder], phoneTransports: ['raw-frame', 'phone-pose'].map((role) => ({ role, localAddress: '192.168.1.2' })) }
  it('requires both paths and actual applied settings', () => {
    expect(wirelessSampleErrors(diagnostics, 'a', 2, ['192.168.1.2'], 1_001)).toEqual([])
    expect(wirelessSampleErrors({ ...diagnostics, phoneTransports: [{ role: 'raw-frame', localAddress: 'fe80::1%en8' }] }, 'a', 2, ['192.168.1.2'], 1_001)).toContain('mac-raw-frame-route')
    expect(wirelessSampleErrors(diagnostics, 'b', 3, ['192.168.1.2'], 1_001)).toEqual(['configuration-id', 'window'])
    expect(wirelessSampleErrors(diagnostics, 'a', 2, ['192.168.1.2'], 5_000)).toEqual(['stale-encoder'])
  })
  it('does not rank background or unrelated-screen motion as the test stimulus', () => {
    const running = { ...diagnostics, activeBenchmark: { phase: 'running', runId: 'run' } }
    expect(wirelessSampleErrors(running, 'a', 2, ['192.168.1.2'], 1_001)).toContain('phone-stimulus-not-verified')
    const verified = { ...running, encoderSamples: [{ ...encoder, appForeground: true,
      benchmarkStimulusVisible: true, benchmarkStimulusID: 'run' }] }
    expect(wirelessSampleErrors(verified, 'a', 2, ['192.168.1.2'], 1_001)).toEqual([])
  })
  it('rejects background or uninstrumented phones before starting a benchmark', () => {
    for (const appForeground of [false, undefined]) {
      for (const phase of [undefined, 'requested', 'running']) {
        const state = { ...diagnostics, activeBenchmark: phase ? { phase, runId: 'run' } : null,
          encoderSamples: [{ ...encoder, appForeground }] }
        expect(wirelessSampleErrors(state, 'a', 2, ['192.168.1.2'], 1_001)).toContain('phone-app-not-foreground')
      }
    }
  })
})
