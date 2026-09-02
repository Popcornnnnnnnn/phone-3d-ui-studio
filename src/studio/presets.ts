export interface StudioPreset {
  id: string
  name: string
  background: string
  floor: string
  accent: string
  keyLight: number
  fillLight: number
}

export const studioPresets: readonly StudioPreset[] = [
  {
    id: 'graphite',
    name: 'Graphite',
    background: '#15171a',
    floor: '#202228',
    accent: '#d1ff5a',
    keyLight: 3.5,
    fillLight: 1.1,
  },
  {
    id: 'paper',
    name: 'Soft Paper',
    background: '#e5e2da',
    floor: '#d0ccc2',
    accent: '#1f54ff',
    keyLight: 2.9,
    fillLight: 1.7,
  },
  {
    id: 'signal',
    name: 'Signal Blue',
    background: '#0b1930',
    floor: '#13233c',
    accent: '#51b8ff',
    keyLight: 3.9,
    fillLight: 0.9,
  },
] as const

export function findStudioPreset(id: string): StudioPreset {
  return studioPresets.find((preset) => preset.id === id) ?? studioPresets[0]
}
