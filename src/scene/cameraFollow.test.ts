import { describe, expect, it } from 'vitest'
import { phoneCenterFollowStep } from './cameraFollow'

describe('phoneCenterFollowStep', () => {
  it('moves the camera pivot toward the grounded phone center', () => {
    const step = phoneCenterFollowStep(0.2, 0.8, 1 / 60)

    expect(step.shiftY).toBeGreaterThan(0)
    expect(step.followedCenterY).toBeCloseTo(0.2 + step.shiftY)
    expect(step.followedCenterY).toBeLessThan(0.8)
  })

  it('preserves the user camera-to-target offset when the shift is shared', () => {
    const cameraY = 2.4
    const targetY = 0.65
    const originalOffset = cameraY - targetY
    const { shiftY } = phoneCenterFollowStep(0.5, 0.9, 1 / 60)

    expect(cameraY + shiftY - (targetY + shiftY)).toBeCloseTo(
      originalOffset,
    )
  })

  it('does not move on a paused or invalid negative frame delta', () => {
    expect(phoneCenterFollowStep(0.4, 0.9, 0).shiftY).toBe(0)
    expect(phoneCenterFollowStep(0.4, 0.9, -1).shiftY).toBe(0)
  })
})
