import { useSyncExternalStore } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'
const changeEvent = 'phone-studio-appearance-change'
const THEME_STORAGE_KEY = 'phone3d.theme.v1'

let current: { appearance: Appearance; colorScheme: ColorScheme } = {
  appearance: 'dark',
  colorScheme: 'dark',
}

function parseAppearance(raw: string | null): Appearance | null {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
}

export function initializeAppearance() {
  const search = new URLSearchParams(window.location.search)
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  const isDesktop = search.get('desktop') === '1'

  const apply = (appearance: Appearance) => {
    const colorScheme = appearance === 'system' ? (system.matches ? 'dark' : 'light') : appearance
    if (
      current.appearance === appearance &&
      current.colorScheme === colorScheme &&
      document.documentElement.dataset.colorScheme
    ) {
      return
    }
    current = { appearance, colorScheme }
    document.documentElement.dataset.appearance = appearance
    document.documentElement.dataset.colorScheme = colorScheme
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: current }))
  }

  window.phoneStudioSetAppearance = (value) => {
    const normalized: Appearance = value === 'light' || value === 'dark' ? value : 'system'
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, normalized)
    } catch {
      // ignore storage errors
    }
    apply(normalized)
  }

  document.documentElement.dataset.desktop = isDesktop ? 'true' : 'false'

  const queryAppearance = parseAppearance(search.get('appearance'))
  const savedAppearance = (() => {
    try {
      return parseAppearance(window.localStorage.getItem(THEME_STORAGE_KEY))
    } catch {
      return null
    }
  })()
  const initialAppearance: Appearance =
    queryAppearance ?? savedAppearance ?? (isDesktop ? 'system' : 'dark')

  apply(initialAppearance)
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
  light: { background: '#f3f2ee', grid: '#e1dfd9', gridSection: '#cbc8c0', slab: '#eae8e2' },
  dark: { background: '#0c0e13', grid: '#222733', gridSection: '#2f3646', slab: '#14171f' },
} as const

declare global {
  interface Window {
    phoneStudioSetAppearance: (appearance: Appearance) => void
    phoneStudioSetWorkspace?: (workspace: 'marble' | 'tracking' | 'mirroring') => void
    webkit?: { messageHandlers?: { studio?: { postMessage: (message: string) => void } } }
  }
}
