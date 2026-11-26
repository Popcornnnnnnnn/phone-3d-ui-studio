import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initMarblePhysics } from '../../shared/marbleWorld.mjs'
import { WebTrayDriver } from './webTrayDriver'

let drivers: WebTrayDriver[] = []

function makeDriver(callbacks = {}) {
  const driver = new WebTrayDriver({}, callbacks)
  drivers.push(driver)
  return driver
}

beforeAll(initMarblePhysics)
afterEach(() => {
  drivers.forEach((d) => d.free())
  drivers = []
})

describe('WebTrayDriver', () => {
  it('triggerToss launches the active marble into the air and increments catch count on landing', () => {
    const onCatch = vi.fn()
    const driver = makeDriver({ onCatch })
    for (let i = 0; i < 20; i++) driver.stepFrame(1 / 60)

    driver.triggerToss(1.1)
    let sawAir = false
    for (let i = 0; i < 180; i++) {
      const snap = driver.stepFrame(1 / 60)
      if (snap.region === 'air') sawAir = true
    }

    expect(sawAir).toBe(true)
    expect(driver.snapshot().hitCount).toBeGreaterThanOrEqual(1)
    expect(onCatch).toHaveBeenCalled()
  })

  it('sustained right tilt rolls the ball through the right exit onto the ground and allows adding a new ball', () => {
    const onDrop = vi.fn()
    const driver = makeDriver({ onDrop })
    driver.setTiltInput(1, 0)

    let dropped = false
    for (let i = 0; i < 360; i++) {
      const snap = driver.stepFrame(1 / 60)
      if (snap.activeBallId === null && snap.canAddBall) {
        dropped = true
        break
      }
    }

    expect(dropped).toBe(true)
    expect(onDrop).toHaveBeenCalledTimes(1)

    driver.setTiltInput(0, 0)
    for (let i = 0; i < 30; i++) driver.stepFrame(1 / 60)

    expect(driver.addBall()).toBe(true)
    expect(driver.snapshot().activeBallId).not.toBeNull()
  })
})
