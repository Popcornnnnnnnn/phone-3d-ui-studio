export interface StudioPreset {
  id: string
  name: string
  daylight: boolean
  backgroundTop: string
  backgroundBottom: string
  backgroundAccent: string
  shadow: string
  keyColor: string
  fillColor: string
  rimColor: string
  keyLight: number
  fillLight: number
}

export const studioPresets: readonly StudioPreset[] = [
  {
    id: 'studio', name: 'Studio', daylight: true,
    backgroundTop: '#f2f3f5', backgroundBottom: '#e9ecf0', backgroundAccent: '#ffffff',
    shadow: '#303747', keyColor: '#ffffff', fillColor: '#dbe3ee', rimColor: '#ffffff',
    keyLight: 3, fillLight: 1.4,
  },
  {
    id: 'pearl',
    name: 'Daylight',
    daylight: true,
    backgroundTop: '#9fc8e2',
    backgroundBottom: '#d9e8ec',
    backgroundAccent: '#7fa9c3',
    shadow: '#516779',
    keyColor: '#fff3dc',
    fillColor: '#a9d8f5',
    rimColor: '#e8f6ff',
    keyLight: 3.35,
    fillLight: 1.35,
  },
  {
    id: 'warm',
    name: 'Night',
    daylight: false,
    backgroundTop: '#344a62',
    backgroundBottom: '#101a27',
    backgroundAccent: '#5e6372',
    shadow: '#07101a',
    keyColor: '#fff7ed',
    fillColor: '#b7d7f1',
    rimColor: '#9bcaf0',
    keyLight: 3.45,
    fillLight: 1.55,
  },
] as const

export function findStudioPreset(id: string): StudioPreset {
  return studioPresets.find((preset) => preset.id === id) ?? studioPresets[0]
}
