export type StudioRenderPreset = 'quality' | 'latency'
export type StudioRenderScheduleMode = 'vsync' | 'phase'

export interface StudioRenderConfiguration {
  preset: StudioRenderPreset
  canvasDpr: number | [number, number]
  effectiveDpr: number
  browserDevicePixelRatio: number
  antialias: boolean
  canvasShadows: 'basic' | false
  softShadows: boolean
  powerPreference: 'high-performance'
  renderScheduleMode: StudioRenderScheduleMode
  renderScheduleCapHz: number | null
  renderSchedulePhaseCreditFrames: number
}

function validDevicePixelRatio(devicePixelRatio: number) {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
}

export function studioRenderConfigurationFromSearch(
  search: string,
  devicePixelRatio: number,
): StudioRenderConfiguration {
  const browserDevicePixelRatio = validDevicePixelRatio(devicePixelRatio)
  const searchParams = new URLSearchParams(search)
  // Preserve Retina detail independently of lighting cost. Fixed DPR 1 made
  // both the model edges and its screen texture soft on high-density displays.
  // Keep bounded DPR overrides for same-scene resolution comparisons.
  const requestedDpr = Number(searchParams.get('renderDpr'))
  const canvasDpr: number | [number, number] = [1, 1.5, 2].includes(requestedDpr)
    ? requestedDpr
    : [1, 2]
  const effectiveDpr = typeof canvasDpr === 'number'
    ? canvasDpr
    : Math.min(2, Math.max(1, browserDevicePixelRatio))
  const preset =
    searchParams.get('render') === 'quality'
      ? 'quality'
      : 'latency'
  // The phase-aware loop is the measured production default. Keep the native
  // R3F loop available as an explicit control for diagnostics and regression
  // comparisons.
  const renderScheduleMode =
    searchParams.get('renderSchedule') === 'vsync'
      ? 'vsync'
      : 'phase'
  const requestedRenderCapHz = Number(searchParams.get('renderCapHz'))
  const renderCapHz = [60, 90, 120].includes(requestedRenderCapHz)
    ? requestedRenderCapHz
    : 120
  const renderSchedule = {
    renderScheduleMode,
    renderScheduleCapHz: renderScheduleMode === 'phase' ? renderCapHz : null,
    renderSchedulePhaseCreditFrames: renderScheduleMode === 'phase' ? 1 : 0,
  } as const

  if (preset === 'latency') {
    return {
      preset,
      canvasDpr,
      effectiveDpr,
      browserDevicePixelRatio,
      antialias: true,
      canvasShadows: false,
      softShadows: false,
      powerPreference: 'high-performance',
      ...renderSchedule,
    }
  }

  return {
    preset,
    canvasDpr,
    effectiveDpr,
    browserDevicePixelRatio,
    antialias: true,
    canvasShadows: 'basic',
    softShadows: true,
    powerPreference: 'high-performance',
    ...renderSchedule,
  }
}
