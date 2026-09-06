export interface MarbleSettings { movementScale: number; ballDiameterMm: number; restitution: number }
export const DEFAULT_MARBLE_SETTINGS: Readonly<MarbleSettings>
export const MARBLE_SETTING_LIMITS: Readonly<Record<keyof MarbleSettings, {min: number; max: number; step: number}>>
export function parseMarbleSettings(value: unknown): MarbleSettings | null
