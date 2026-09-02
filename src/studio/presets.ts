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
    background: '#0b0c10',
    floor: '#11131a',
    accent: '#b8ff3d',
    keyLight: 4.2,
    fillLight: 1.4,
  },
  {
    id: 'paper',
    name: 'Soft Paper',
    background: '#e8e6df',
    floor: '#d5d1c8',
    accent: '#1f54ff',
    keyLight: 3.1,
    fillLight: 2.1,
  },
  {
    id: 'signal',
    name: 'Signal Blue',
    background: '#071429',
    floor: '#0b1b35',
    accent: '#51b8ff',
    keyLight: 4.8,
    fillLight: 1.1,
  },
] as const

export function findStudioPreset(id: string): StudioPreset {
  return studioPresets.find((preset) => preset.id === id) ?? studioPresets[0]
}
