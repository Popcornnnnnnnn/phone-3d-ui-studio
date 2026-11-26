import { describe, expect, it } from 'vitest'
import { INITIAL_DEMO_STATE, reduceDemoScreenState } from './demoScreens'

describe('demoScreens state reducer', () => {
  it('switches screens, playback, weather, and expanded notification cards', () => {
    let s = reduceDemoScreenState(INITIAL_DEMO_STATE, 'toggle-play')
    expect(s.playing).toBe(false)

    s = reduceDemoScreenState(s, 'next-track')
    expect(s.trackIndex).toBe(1)
    expect(s.playing).toBe(true)

    s = reduceDemoScreenState(s, 'select-screen', 'weather')
    expect(s.screenId).toBe('weather')

    s = reduceDemoScreenState(s, 'cycle-weather')
    expect(s.weather).toBe('sunny')

    s = reduceDemoScreenState(s, 'select-screen', 'notifications')
    s = reduceDemoScreenState(s, 'cycle-notification')
    expect(s.expandedCard).toBe(1)
  })
})
