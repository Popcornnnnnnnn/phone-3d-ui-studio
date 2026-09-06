export const DEFAULT_MARBLE_SETTINGS = Object.freeze({ movementScale: 0.5, ballDiameterMm: 15, restitution: 0.35 })
export const MARBLE_SETTING_LIMITS = Object.freeze({
  movementScale: { min: 0.25, max: 1, step: 0.05 },
  ballDiameterMm: { min: 10, max: 20, step: 1 },
  restitution: { min: 0, max: 0.8, step: 0.05 },
})
export function parseMarbleSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const settings = {}
  for (const [key, limit] of Object.entries(MARBLE_SETTING_LIMITS)) {
    if (!Number.isFinite(value[key]) || value[key] < limit.min || value[key] > limit.max) return null
    settings[key] = value[key]
  }
  return settings
}
