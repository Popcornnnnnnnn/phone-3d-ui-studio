import { describe, expect, it } from 'vitest'
import {
  LiveRenderScheduler,
  summarizeLiveRenderSchedulerRun,
  type LiveRenderDispatch,
  type LiveRenderSchedulerEnvironment,
  type LiveRenderSchedulerRoot,
} from './liveRenderScheduler'

class FakeEnvironment implements LiveRenderSchedulerEnvironment {
  now = 0
  private nextHandle = 1
  readonly animationFrames = new Map<number, (timestampMs: number) => void>()
  readonly timers = new Map<
    number,
    { callback: () => void; dueAtMs: number; cancelled: boolean }
  >()

  nowMs = () => this.now
  requestAnimationFrame = (callback: (timestampMs: number) => void) => {
    const handle = this.nextHandle++
    this.animationFrames.set(handle, callback)
    return handle
  }

  cancelAnimationFrame = (handle: number) => {
    this.animationFrames.delete(handle)
  }

  setTimeout = (callback: () => void, delayMs: number) => {
    const handle = this.nextHandle++
    this.timers.set(handle, {
      callback,
      dueAtMs: this.now + delayMs,
      cancelled: false,
    })
    return handle
  }

  clearTimeout = (handle: number) => {
    const timer = this.timers.get(handle)
    if (timer) timer.cancelled = true
  }

  fireNextAnimationFrame() {
    const entry = this.animationFrames.entries().next().value as
      | [number, (timestampMs: number) => void]
      | undefined
    if (!entry) throw new Error('no animation frame is pending')
    this.animationFrames.delete(entry[0])
    entry[1](this.now)
  }

  fireDueTimers() {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => !timer.cancelled && timer.dueAtMs <= this.now)
      .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)
    for (const [handle, timer] of due) {
      this.timers.delete(handle)
      timer.callback()
    }
  }
}

function createRoot(
  onAdvance?: (dispatch: LiveRenderDispatch) => void,
) {
  const frameloops: Array<'always' | 'never'> = []
  const advances: Array<{
    elapsedSeconds: number
    frameTimestampMs: number
    dispatch: LiveRenderDispatch
  }> = []
  const root: LiveRenderSchedulerRoot = {
    setFrameloop: (mode) => frameloops.push(mode),
    advance: (elapsedSeconds, frameTimestampMs, dispatch) => {
      advances.push({ elapsedSeconds, frameTimestampMs, dispatch })
      onAdvance?.(dispatch)
    },
  }
  return { advances, frameloops, root }
}

describe('live render scheduler', () => {
  it('leaves the default vsync path on R3F always mode', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('vsync', environment)
    const { advances, frameloops, root } = createRoot()

    scheduler.attach(root)
    expect(frameloops).toEqual(['always'])
    expect(
      scheduler.request({ cause: 'video', generation: 1, frameId: 1 }),
    ).toBe(false)
    expect(advances).toHaveLength(0)
    expect(environment.animationFrames.size).toBe(0)
    expect(scheduler.snapshot()).toMatchObject({
      mode: 'vsync',
      generation: 1,
      capHz: null,
      phaseCreditFrames: 0,
    })
  })

  it('reports an explicit diagnostic phase cap', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment, 90)

    expect(scheduler.snapshot()).toMatchObject({
      mode: 'phase',
      capHz: 90,
      phaseCreditFrames: 1,
    })
  })

  it('passes elapsed seconds rather than millisecond timestamps to R3F advance', () => {
    const environment = new FakeEnvironment()
    environment.now = 100
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, frameloops, root } = createRoot()
    scheduler.attach(root)

    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })
    environment.now = 108.333
    scheduler.request({ cause: 'pose', generation: 1, poseSequence: 20 })

    expect(frameloops).toEqual(['never'])
    expect(advances).toHaveLength(2)
    expect(advances[0]).toMatchObject({
      elapsedSeconds: 0,
      frameTimestampMs: 100,
    })
    expect(advances[1].elapsedSeconds).toBeCloseTo(0.008333, 6)
  })

  it('keeps only the latest video frame while rate limited', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)

    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })
    environment.now = 1
    scheduler.request({ cause: 'video', generation: 1, frameId: 2 })
    environment.now = 2
    scheduler.request({ cause: 'video', generation: 1, frameId: 3 })
    environment.now = 3
    scheduler.request({ cause: 'video', generation: 1, frameId: 4 })

    expect(advances.map(({ dispatch }) => dispatch.latestVideoFrameId)).toEqual([
      1, 2,
    ])
    expect(scheduler.snapshot().coalescedVideoFrames).toBe(1)

    environment.now = 8.34
    environment.fireDueTimers()
    expect(advances.at(-1)?.dispatch.latestVideoFrameId).toBe(4)
    expect(advances.at(-1)?.dispatch.source).toBe('wakeup')
  })

  it('bounds a sustained event storm to 120 Hz plus one phase credit', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)

    for (let millisecond = 0; millisecond < 1_000; millisecond += 1) {
      environment.now = millisecond
      scheduler.request({
        cause: 'pose',
        generation: 1,
        poseSequence: millisecond,
      })
    }

    expect(advances.length).toBeGreaterThanOrEqual(120)
    expect(advances.length).toBeLessThanOrEqual(121)
    expect(scheduler.snapshot().rateLimitedAttempts).toBeGreaterThan(0)
  })

  it('repays an event phase advance by replacing the next cadence tick', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)

    environment.now = 0
    environment.fireNextAnimationFrame()
    environment.now = 4
    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })

    expect(advances.map(({ dispatch }) => dispatch.source)).toEqual([
      'cadence',
      'event',
    ])

    environment.now = 8.333
    environment.fireNextAnimationFrame()
    expect(advances).toHaveLength(2)
    expect(scheduler.snapshot().cadenceSkipsForPhaseShift).toBe(1)

    environment.now = 12.334
    scheduler.request({ cause: 'video', generation: 1, frameId: 2 })
    expect(advances.at(-1)?.dispatch).toMatchObject({
      source: 'event',
      latestVideoFrameId: 2,
    })

    environment.now = 16.666
    environment.fireNextAnimationFrame()
    expect(advances).toHaveLength(3)
    expect(scheduler.snapshot().cadenceSkipsForPhaseShift).toBe(2)
  })

  it('keeps cadence rendering when no event has already rendered the root', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)

    environment.now = 0
    environment.fireNextAnimationFrame()
    environment.now = 8.334
    environment.fireNextAnimationFrame()

    expect(advances.map(({ dispatch }) => dispatch.source)).toEqual([
      'cadence',
      'cadence',
    ])
    expect(scheduler.snapshot().cadenceSkipsForPhaseShift).toBe(0)
  })

  it('summarizes stable run-local scheduler evidence', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { root } = createRoot()
    scheduler.attach(root)
    const started = scheduler.snapshot()

    environment.now = 0
    environment.fireNextAnimationFrame()
    environment.now = 4
    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })
    environment.now = 8.333
    environment.fireNextAnimationFrame()

    expect(
      summarizeLiveRenderSchedulerRun(started, scheduler.snapshot()),
    ).toMatchObject({
      mode: 'phase',
      generationStable: true,
      advancesDelta: 2,
      eventAdvancesDelta: 1,
      cadenceAdvancesDelta: 1,
      cadenceSkipsForPhaseShiftDelta: 1,
      visibilityInterruptionsDelta: 0,
      maximumAdvanceDepth: 1,
    })
  })

  it('invalidates scheduler counter deltas across a generation change', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { root } = createRoot()
    scheduler.attach(root)
    const started = scheduler.snapshot()

    scheduler.reconfigure('vsync')
    const summary = summarizeLiveRenderSchedulerRun(
      started,
      scheduler.snapshot(),
    )

    expect(summary.generationStable).toBe(false)
    expect(summary.advancesDelta).toBeNull()
    expect(summary.eventAdvancesDelta).toBeNull()
  })

  it('coalesces requests made from inside advance without re-entering R3F', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot(() => {
      scheduler.request({ cause: 'controls', generation: scheduler.generation })
    })
    scheduler.attach(root)

    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })

    expect(advances).toHaveLength(1)
    expect(scheduler.snapshot().maximumAdvanceDepth).toBe(1)
    expect(environment.timers.size).toBeGreaterThan(0)
  })

  it('invalidates old timers and old source requests across generations', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)

    scheduler.request({ cause: 'video', generation: 1, frameId: 1 })
    environment.now = 1
    scheduler.request({ cause: 'video', generation: 1, frameId: 2 })
    environment.now = 2
    scheduler.request({ cause: 'video', generation: 1, frameId: 3 })
    const staleTimer = [...environment.timers.values()].find(
      (timer) => !timer.cancelled,
    )
    expect(staleTimer).toBeDefined()

    scheduler.reconfigure('phase')
    expect(scheduler.generation).toBe(2)
    expect(
      scheduler.request({ cause: 'video', generation: 1, frameId: 99 }),
    ).toBe(false)
    staleTimer?.callback()
    expect(advances.map(({ dispatch }) => dispatch.latestVideoFrameId)).toEqual([
      1, 2,
    ])

    scheduler.request({ cause: 'video', generation: 2, frameId: 4 })
    expect(advances.at(-1)?.dispatch).toMatchObject({
      generation: 2,
      latestVideoFrameId: 4,
    })
  })

  it('ignores an animation-frame callback retained from an older generation', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)
    const staleAnimationFrame = [...environment.animationFrames.values()][0]
    expect(staleAnimationFrame).toBeDefined()

    scheduler.reconfigure('phase')
    staleAnimationFrame?.(environment.now)

    expect(advances).toHaveLength(0)
    expect(environment.animationFrames.size).toBe(1)
  })

  it('ignores a callback retained across a hidden-to-visible scheduling epoch', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)
    const staleAnimationFrame = [...environment.animationFrames.values()][0]

    scheduler.setVisible(false)
    scheduler.setVisible(true)
    staleAnimationFrame?.(environment.now)

    expect(advances).toHaveLength(0)
    expect(environment.animationFrames.size).toBe(1)
  })

  it('stops all advances while hidden and presents only the latest state on resume', () => {
    const environment = new FakeEnvironment()
    const scheduler = new LiveRenderScheduler('phase', environment)
    const { advances, root } = createRoot()
    scheduler.attach(root)
    scheduler.setVisible(false)

    scheduler.request({ cause: 'video', generation: 1, frameId: 10 })
    scheduler.request({ cause: 'video', generation: 1, frameId: 11 })
    expect(advances).toHaveLength(0)
    expect(environment.animationFrames.size).toBe(0)

    scheduler.setVisible(true)
    expect(advances).toHaveLength(1)
    expect(advances[0].dispatch.latestVideoFrameId).toBe(11)
    expect(environment.animationFrames.size).toBe(1)
  })
})
