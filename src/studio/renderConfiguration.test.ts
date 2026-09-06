import { describe, expect, it } from 'vitest'
import { studioRenderConfigurationFromSearch } from './renderConfiguration'

describe('studio render configuration', () => {
  it('preserves Retina detail without adding shadows or changing the scheduler', () => {
    expect(studioRenderConfigurationFromSearch('', 2.5)).toEqual({
      preset: 'latency',
      canvasDpr: [1, 2],
      effectiveDpr: 2,
      browserDevicePixelRatio: 2.5,
      antialias: true,
      canvasShadows: false,
      softShadows: false,
      powerPreference: 'high-performance',
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
      renderSchedulePhaseCreditFrames: 1,
    })
  })

  it('preserves Retina detail even with an existing latency preset URL', () => {
    expect(
      studioRenderConfigurationFromSearch('?decoder=software&render=latency', 2),
    ).toEqual({
      preset: 'latency',
      canvasDpr: [1, 2],
      effectiveDpr: 2,
      browserDevicePixelRatio: 2,
      antialias: true,
      canvasShadows: false,
      softShadows: false,
      powerPreference: 'high-performance',
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
      renderSchedulePhaseCreditFrames: 1,
    })
  })

  it('keeps the higher-cost quality Canvas behind an explicit URL control', () => {
    expect(
      studioRenderConfigurationFromSearch('?render=quality', 2.5),
    ).toEqual({
      preset: 'quality',
      canvasDpr: [1, 2],
      effectiveDpr: 2,
      browserDevicePixelRatio: 2.5,
      antialias: true,
      canvasShadows: 'basic',
      softShadows: true,
      powerPreference: 'high-performance',
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
      renderSchedulePhaseCreditFrames: 1,
    })
  })

  it('allows resolution-only comparisons while preserving latency settings', () => {
    for (const dpr of [1, 1.5, 2]) {
      expect(studioRenderConfigurationFromSearch(`?renderDpr=${dpr}`, 2))
        .toMatchObject({
          canvasDpr: dpr,
          effectiveDpr: dpr,
          canvasShadows: false,
          softShadows: false,
          renderScheduleMode: 'phase',
        })
    }
    for (const dpr of ['0', '3', 'NaN']) {
      expect(studioRenderConfigurationFromSearch(`?renderDpr=${dpr}`, 2))
        .toMatchObject({ canvasDpr: [1, 2], effectiveDpr: 2 })
    }
    expect(studioRenderConfigurationFromSearch('', 1))
      .toMatchObject({ canvasDpr: [1, 2], effectiveDpr: 1 })
  })

  it('falls back to latency for unknown presets and invalid browser DPR values', () => {
    expect(
      studioRenderConfigurationFromSearch('?render=unsupported', Number.NaN),
    ).toMatchObject({
      preset: 'latency',
      effectiveDpr: 1,
      browserDevicePixelRatio: 1,
    })
  })

  it('keeps native vsync available only as an explicit diagnostic control', () => {
    expect(
      studioRenderConfigurationFromSearch(
        '?decoder=software&renderSchedule=phase',
        2,
      ),
    ).toMatchObject({
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
      renderSchedulePhaseCreditFrames: 1,
    })
    expect(
      studioRenderConfigurationFromSearch('?renderSchedule=vsync', 2),
    ).toMatchObject({
      renderScheduleMode: 'vsync',
      renderScheduleCapHz: null,
      renderSchedulePhaseCreditFrames: 0,
    })
    expect(
      studioRenderConfigurationFromSearch('?renderSchedule=unsupported', 2),
    ).toMatchObject({
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
      renderSchedulePhaseCreditFrames: 1,
    })
  })

  it('allows bounded phase-render caps for sustained-load diagnostics', () => {
    expect(
      studioRenderConfigurationFromSearch('?renderCapHz=90', 2),
    ).toMatchObject({
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 90,
    })
    expect(
      studioRenderConfigurationFromSearch('?renderCapHz=75', 2),
    ).toMatchObject({
      renderScheduleMode: 'phase',
      renderScheduleCapHz: 120,
    })
  })

})
