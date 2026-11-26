import { useSyncExternalStore } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'
const changeEvent = 'phone-studio-appearance-change'
let current: { appearance: Appearance; colorScheme: ColorScheme } = { appearance: 'system', colorScheme: 'light' }

export function initializeAppearance() {
  const search = new URLSearchParams(window.location.search)
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (appearance: Appearance) => {
    const colorScheme = appearance === 'system' ? (system.matches ? 'dark' : 'light') : appearance
    if (current.appearance === appearance && current.colorScheme === colorScheme && document.documentElement.dataset.colorScheme) return
    current = { appearance, colorScheme }
    document.documentElement.dataset.appearance = appearance
    document.documentElement.dataset.colorScheme = colorScheme
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: current }))
  }
  window.phoneStudioSetAppearance = (value) => apply(value === 'light' || value === 'dark' ? value : 'system')
  document.documentElement.dataset.desktop = search.get('desktop') === '1' ? 'true' : 'false'
  window.phoneStudioSetAppearance(search.get('appearance') as Appearance)
  system.addEventListener('change', () => {
    if (current.appearance === 'system') apply('system')
  })
}

function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener)
  return () => window.removeEventListener(changeEvent, listener)
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, () => current)
}

export const workspaceColors = {
  light: { background: '#f2f3f5', grid: '#d9dce1', gridSection: '#bdc3cc', slab: '#e6e8ec' },
  dark: { background: '#1b1d21', grid: '#323740', gridSection: '#4a535f', slab: '#252930' },
} as const

declare global {
  interface Window {
    phoneStudioSetAppearance: (appearance: Appearance) => void
    phoneStudioSetWorkspace?: (workspace: 'marble' | 'tracking' | 'mirroring') => void
    webkit?: { messageHandlers?: { studio?: { postMessage: (message: string) => void } } }
  }
}
