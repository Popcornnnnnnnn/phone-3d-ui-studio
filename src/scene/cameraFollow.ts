export interface PhoneCenterFollowStep {
  followedCenterY: number
  shiftY: number
}

export function phoneCenterFollowStep(
  followedCenterY: number,
  targetCenterY: number,
  deltaSeconds: number,
  responseRate = 12,
): PhoneCenterFollowStep {
  const safeDeltaSeconds = Math.max(0, deltaSeconds)
  const safeResponseRate = Math.max(0, responseRate)
  const amount = 1 - Math.exp(-safeDeltaSeconds * safeResponseRate)
  const nextCenterY =
    followedCenterY + (targetCenterY - followedCenterY) * amount

  return {
    followedCenterY: nextCenterY,
    shiftY: nextCenterY - followedCenterY,
  }
}
