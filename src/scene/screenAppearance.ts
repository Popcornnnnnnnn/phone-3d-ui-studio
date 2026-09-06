export const MIN_SCREEN_VIEW_BRIGHTNESS = 0.58

export function screenViewBrightness(facingRatio: number) {
  const facing = Math.min(1, Math.max(0, facingRatio))
  const easedFacing = facing * facing * (3 - 2 * facing)
  return MIN_SCREEN_VIEW_BRIGHTNESS +
    (1 - MIN_SCREEN_VIEW_BRIGHTNESS) * easedFacing
}
