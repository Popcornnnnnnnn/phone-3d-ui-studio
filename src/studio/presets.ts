export interface StudioPreset {
  id: string
  name: string
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
    id: 'pearl',
    name: 'Pearl',
    backgroundTop: '#fbfaf7',
    backgroundBottom: '#e7ebf0',
    backgroundAccent: '#dce8f0',
    shadow: '#6e747c',
    keyColor: '#fffdf9',
    fillColor: '#e7f0f8',
    rimColor: '#f8e9dc',
    keyLight: 3.1,
    fillLight: 1.35,
  },
  {
    id: 'warm',
    name: 'Warm',
    backgroundTop: '#fffaf2',
    backgroundBottom: '#eadfd4',
    backgroundAccent: '#f3e1cc',
    shadow: '#7f7369',
    keyColor: '#fff8ee',
    fillColor: '#f5e6d7',
    rimColor: '#e5edf5',
    keyLight: 3,
    fillLight: 1.25,
  },
  {
    id: 'cool',
    name: 'Cool',
    backgroundTop: '#f7fafc',
    backgroundBottom: '#dce6ee',
    backgroundAccent: '#d5e6f2',
    shadow: '#677581',
    keyColor: '#f8fbff',
    fillColor: '#dcecf8',
    rimColor: '#f5e8df',
    keyLight: 3.15,
    fillLight: 1.4,
  },
] as const

export function findStudioPreset(id: string): StudioPreset {
  return studioPresets.find((preset) => preset.id === id) ?? studioPresets[0]
}
