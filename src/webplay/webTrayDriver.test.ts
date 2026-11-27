import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initMarblePhysics } from '../../shared/marbleWorld.mjs'
import { WebTrayDriver } from './webTrayDriver'

let drivers: WebTrayDriver[] = []

function makeDriver(callbacks = {}, options = {}) {
  const driver = new WebTrayDriver({}, callbacks, undefined, options)
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

  it('starts without a marble when startWithBall is false until startGame is called', () => {
    const onSpawn = vi.fn()
    const driver = makeDriver({ onSpawn }, { startWithBall: false })
    expect(driver.isStarted()).toBe(false)
    expect(driver.snapshot().balls).toHaveLength(0)

    // Stepping idle or restarting settings before start keeps the marble hidden
    for (let i = 0; i < 20; i++) driver.stepFrame(1 / 60)
    driver.restart({ ballDiameterMm: 12 })
    expect(driver.isStarted()).toBe(false)
    expect(driver.snapshot().balls).toHaveLength(0)

    // Starting even under a steep tilt spawns an active marble centered on the tray
    driver.setTiltInput(1, 1)
    for (let i = 0; i < 30; i++) driver.stepFrame(1 / 60)
    expect(driver.startGame()).toBe(true)
    expect(driver.isStarted()).toBe(true)
    expect(driver.snapshot().balls).toHaveLength(1)
    expect(driver.snapshot().activeBallId).not.toBeNull()
    expect(onSpawn).toHaveBeenCalledTimes(1)
  })
})
