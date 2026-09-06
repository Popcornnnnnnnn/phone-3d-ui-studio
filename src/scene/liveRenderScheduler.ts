import type { LiveRenderSchedulerRunSummary } from '../studio/liveMeasurement'

export type LiveRenderScheduleMode = 'vsync' | 'phase'

export type LiveRenderCause = 'video' | 'pose' | 'controls' | 'animation'

export const PHASE_RENDER_CAP_HZ = 120
export const PHASE_RENDER_CREDIT_FRAMES = 1

const PHASE_RENDER_BUCKET_CAPACITY = 1 + PHASE_RENDER_CREDIT_FRAMES
const MINIMUM_PHASE_SHIFT_SEPARATION_MS = 1

export interface LiveRenderRequest {
  cause: Exclude<LiveRenderCause, 'animation'>
  generation: number
  frameId?: number
  poseSequence?: number
}

export interface LiveRenderDispatch {
  sequence: number
  generation: number
  causes: readonly LiveRenderCause[]
  latestVideoFrameId: number | null
  latestPoseSequence: number | null
  requestedAtMs: number
  advanceStartedAtMs: number
  source: 'event' | 'cadence' | 'wakeup'
}

export interface LiveRenderSchedulerSnapshot {
  mode: LiveRenderScheduleMode
  generation: number
  capHz: number | null
  phaseCreditFrames: number
  attached: boolean
  visible: boolean
  advances: number
  eventAdvances: number
  cadenceAdvances: number
  wakeupAdvances: number
  cadenceSkipsForPhaseShift: number
  visibilityInterruptions: number
  rateLimitedAttempts: number
  coalescedVideoFrames: number
  maximumAdvanceDepth: number
  lastDispatch: LiveRenderDispatch | null
}

export interface LiveRenderSchedulerRoot {
  setFrameloop: (mode: 'always' | 'never') => void
  advance: (
    elapsedSeconds: number,
    frameTimestampMs: number,
    dispatch: LiveRenderDispatch,
  ) => void
}

export interface LiveRenderSchedulerEnvironment {
  nowMs: () => number
  requestAnimationFrame: (callback: (timestampMs: number) => void) => number
  cancelAnimationFrame: (handle: number) => void
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}

interface PendingRender {
  causes: Set<LiveRenderCause>
  latestVideoFrameId: number | null
  latestPoseSequence: number | null
  requestedAtMs: number
}

function createPendingRender(
  cause: LiveRenderCause,
  requestedAtMs: number,
): PendingRender {
  return {
    causes: new Set([cause]),
    latestVideoFrameId: null,
    latestPoseSequence: null,
    requestedAtMs,
  }
}

/**
 * The low-latency render scheduler. `phase` replaces R3F's root rAF loop with
 * one root-scoped loop and permits one bounded phase-shift credit. The token
 * bucket therefore remains at 120 Hz over sustained runs without growing into
 * an independent 120 Hz + source-frame-rate render loop.
 */
export class LiveRenderScheduler {
  private modeValue: LiveRenderScheduleMode
  private generationValue = 1
  private root: LiveRenderSchedulerRoot | null = null
  private visibleValue = true
  private pending: PendingRender | null = null
  private schedulingEpoch = 0
  private rafHandle: number | null = null
  private wakeupHandle: number | null = null
  private wakeupAtMs: number | null = null
  private tokens = PHASE_RENDER_BUCKET_CAPACITY
  private tokenRefilledAtMs: number | null = null
  private lastAdvanceAtMs: number | null = null
  private elapsedSeconds = 0
  private elapsedUpdatedAtMs: number | null = null
  private advancing = false
  private advanceDepth = 0
  private sequence = 0
  private advances = 0
  private eventAdvances = 0
  private cadenceAdvances = 0
  private wakeupAdvances = 0
  private cadenceSkipsForPhaseShift = 0
  private visibilityInterruptions = 0
  private skipNextCadence = false
  private rateLimitedAttempts = 0
  private coalescedVideoFrames = 0
  private maximumAdvanceDepth = 0
  private lastDispatch: LiveRenderDispatch | null = null

  constructor(
    mode: LiveRenderScheduleMode,
    private readonly environment: LiveRenderSchedulerEnvironment,
    private readonly phaseRenderCapHz = PHASE_RENDER_CAP_HZ,
  ) {
    this.modeValue = mode
  }

  get mode() {
    return this.modeValue
  }

  get generation() {
    return this.generationValue
  }

  attach(root: LiveRenderSchedulerRoot) {
    if (this.root === root) return () => this.detach(root)
    this.cancelScheduledWork()
    this.root = root
    this.resetCadence(this.environment.nowMs())
    root.setFrameloop(this.modeValue === 'phase' ? 'never' : 'always')
    if (this.modeValue === 'phase' && this.visibleValue) this.ensureCadence()
    return () => this.detach(root)
  }

  reconfigure(mode: LiveRenderScheduleMode) {
    this.generationValue += 1
    this.modeValue = mode
    this.pending = null
    this.cancelScheduledWork()
    this.resetCadence(this.environment.nowMs())
    this.root?.setFrameloop(mode === 'phase' ? 'never' : 'always')
    if (mode === 'phase' && this.visibleValue) this.ensureCadence()
  }

  setVisible(visible: boolean) {
    if (visible === this.visibleValue) return
    this.visibleValue = visible
    if (!visible) {
      this.visibilityInterruptions += 1
      this.cancelScheduledWork()
      this.elapsedUpdatedAtMs = null
      return
    }
    this.resetBudget(this.environment.nowMs())
    if (this.modeValue === 'phase' && this.root) {
      if (this.pending) this.tryAdvance('event')
      this.ensureCadence()
    }
  }

  request(request: LiveRenderRequest) {
    if (request.generation !== this.generationValue) return false
    if (this.modeValue !== 'phase') return false

    const nowMs = this.environment.nowMs()
    this.mergeRequest(request.cause, nowMs, request.frameId, request.poseSequence)
    if (!this.root || !this.visibleValue) return true
    this.tryAdvance('event')
    return true
  }

  snapshot(): LiveRenderSchedulerSnapshot {
    return {
      mode: this.modeValue,
      generation: this.generationValue,
      capHz: this.modeValue === 'phase' ? this.phaseRenderCapHz : null,
      phaseCreditFrames:
        this.modeValue === 'phase' ? PHASE_RENDER_CREDIT_FRAMES : 0,
      attached: this.root !== null,
      visible: this.visibleValue,
      advances: this.advances,
      eventAdvances: this.eventAdvances,
      cadenceAdvances: this.cadenceAdvances,
      wakeupAdvances: this.wakeupAdvances,
      cadenceSkipsForPhaseShift: this.cadenceSkipsForPhaseShift,
      visibilityInterruptions: this.visibilityInterruptions,
      rateLimitedAttempts: this.rateLimitedAttempts,
      coalescedVideoFrames: this.coalescedVideoFrames,
      maximumAdvanceDepth: this.maximumAdvanceDepth,
      lastDispatch: this.lastDispatch,
    }
  }

  private detach(root: LiveRenderSchedulerRoot) {
    if (this.root !== root) return
    this.cancelScheduledWork()
    this.root = null
    this.pending = null
  }

  private resetBudget(nowMs: number) {
    this.tokens = PHASE_RENDER_BUCKET_CAPACITY
    this.tokenRefilledAtMs = nowMs
    this.lastAdvanceAtMs = null
    this.skipNextCadence = false
  }

  private resetCadence(nowMs: number) {
    this.resetBudget(nowMs)
    this.elapsedSeconds = 0
    this.elapsedUpdatedAtMs = null
  }

  private cancelScheduledWork() {
    this.schedulingEpoch += 1
    if (this.rafHandle !== null) {
      this.environment.cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
    if (this.wakeupHandle !== null) {
      this.environment.clearTimeout(this.wakeupHandle)
      this.wakeupHandle = null
      this.wakeupAtMs = null
    }
  }

  private mergeRequest(
    cause: LiveRenderCause,
    nowMs: number,
    frameId?: number,
    poseSequence?: number,
  ) {
    this.pending ??= createPendingRender(cause, nowMs)
    this.pending.causes.add(cause)
    if (cause === 'video' && frameId !== undefined) {
      if (
        this.pending.latestVideoFrameId !== null &&
        this.pending.latestVideoFrameId !== frameId
      ) {
        this.coalescedVideoFrames += 1
      }
      this.pending.latestVideoFrameId = frameId
    }
    if (cause === 'pose' && poseSequence !== undefined) {
      this.pending.latestPoseSequence = poseSequence
    }
  }

  private ensureCadence() {
    if (
      this.rafHandle !== null ||
      this.modeValue !== 'phase' ||
      !this.root ||
      !this.visibleValue
    ) {
      return
    }
    const scheduledGeneration = this.generationValue
    const scheduledEpoch = this.schedulingEpoch
    this.rafHandle = this.environment.requestAnimationFrame(() => {
      this.rafHandle = null
      if (
        scheduledGeneration !== this.generationValue ||
        scheduledEpoch !== this.schedulingEpoch ||
        this.modeValue !== 'phase' ||
        !this.root ||
        !this.visibleValue
      ) {
        return
      }
      if (this.skipNextCadence) {
        // An event-driven advance already rendered the complete R3F root in
        // this display interval. Replace the next cadence tick instead of
        // rendering both: this repays the single phase credit while keeping
        // the sustained rate at the configured cap.
        this.skipNextCadence = false
        this.cadenceSkipsForPhaseShift += 1
        this.ensureCadence()
        return
      }
      this.mergeRequest('animation', this.environment.nowMs())
      this.tryAdvance('cadence')
      this.ensureCadence()
    })
  }

  private refillTokens(nowMs: number) {
    const previousMs = this.tokenRefilledAtMs
    this.tokenRefilledAtMs = nowMs
    if (previousMs === null || nowMs <= previousMs) return
    this.tokens = Math.min(
      PHASE_RENDER_BUCKET_CAPACITY,
      this.tokens + ((nowMs - previousMs) * this.phaseRenderCapHz) / 1_000,
    )
  }

  private nextEligibleAtMs(nowMs: number) {
    this.refillTokens(nowMs)
    const tokenReadyAtMs =
      this.tokens >= 1
        ? nowMs
        : nowMs + ((1 - this.tokens) * 1_000) / this.phaseRenderCapHz
    const separationReadyAtMs =
      this.lastAdvanceAtMs === null
        ? nowMs
        : this.lastAdvanceAtMs + MINIMUM_PHASE_SHIFT_SEPARATION_MS
    return Math.max(tokenReadyAtMs, separationReadyAtMs)
  }

  private armWakeup(nowMs: number) {
    if (!this.pending || !this.root || !this.visibleValue) return
    const eligibleAtMs = this.nextEligibleAtMs(nowMs)
    if (
      this.wakeupHandle !== null &&
      this.wakeupAtMs !== null &&
      this.wakeupAtMs <= eligibleAtMs + 0.01
    ) {
      return
    }
    if (this.wakeupHandle !== null) {
      this.environment.clearTimeout(this.wakeupHandle)
    }
    const scheduledGeneration = this.generationValue
    const scheduledEpoch = this.schedulingEpoch
    this.wakeupAtMs = eligibleAtMs
    this.wakeupHandle = this.environment.setTimeout(() => {
      this.wakeupHandle = null
      this.wakeupAtMs = null
      if (
        scheduledGeneration !== this.generationValue ||
        scheduledEpoch !== this.schedulingEpoch
      ) {
        return
      }
      this.tryAdvance('wakeup')
    }, Math.max(0, eligibleAtMs - nowMs))
  }

  private tryAdvance(source: LiveRenderDispatch['source']) {
    if (
      this.advancing ||
      !this.pending ||
      !this.root ||
      !this.visibleValue ||
      this.modeValue !== 'phase'
    ) {
      return
    }

    const nowMs = this.environment.nowMs()
    const eligibleAtMs = this.nextEligibleAtMs(nowMs)
    if (eligibleAtMs > nowMs + 0.01) {
      this.rateLimitedAttempts += 1
      this.armWakeup(nowMs)
      return
    }

    if (this.wakeupHandle !== null) {
      this.environment.clearTimeout(this.wakeupHandle)
      this.wakeupHandle = null
      this.wakeupAtMs = null
    }

    this.tokens = Math.max(0, this.tokens - 1)
    const pending = this.pending
    this.pending = null
    const dispatch: LiveRenderDispatch = {
      sequence: ++this.sequence,
      generation: this.generationValue,
      causes: [...pending.causes].sort(),
      latestVideoFrameId: pending.latestVideoFrameId,
      latestPoseSequence: pending.latestPoseSequence,
      requestedAtMs: pending.requestedAtMs,
      advanceStartedAtMs: nowMs,
      source,
    }

    if (this.elapsedUpdatedAtMs !== null) {
      this.elapsedSeconds += Math.max(0, nowMs - this.elapsedUpdatedAtMs) / 1_000
    }
    this.elapsedUpdatedAtMs = nowMs
    this.lastAdvanceAtMs = nowMs
    this.advancing = true
    this.advanceDepth += 1
    this.maximumAdvanceDepth = Math.max(
      this.maximumAdvanceDepth,
      this.advanceDepth,
    )

    try {
      this.root.advance(
        this.elapsedSeconds,
        nowMs,
        dispatch,
      )
      this.advances += 1
      if (source === 'event') this.eventAdvances += 1
      else if (source === 'cadence') this.cadenceAdvances += 1
      else this.wakeupAdvances += 1
      if (
        source !== 'cadence' &&
        pending.causes.size > 0 &&
        [...pending.causes].some((cause) => cause !== 'animation')
      ) {
        this.skipNextCadence = true
      }
      this.lastDispatch = dispatch
    } finally {
      this.advanceDepth -= 1
      this.advancing = false
    }

    if (this.pending) this.armWakeup(this.environment.nowMs())
  }
}

function stableCounterDelta(
  stable: boolean,
  started: number,
  ended: number,
) {
  return stable && ended >= started ? ended - started : null
}

export function summarizeLiveRenderSchedulerRun(
  started: LiveRenderSchedulerSnapshot,
  ended: LiveRenderSchedulerSnapshot,
): LiveRenderSchedulerRunSummary {
  const generationStable =
    started.mode === ended.mode && started.generation === ended.generation
  return {
    mode: ended.mode,
    generationStart: started.generation,
    generationEnd: ended.generation,
    generationStable,
    capHz: ended.capHz,
    phaseCreditFrames: ended.phaseCreditFrames,
    visibleAtStart: started.visible,
    visibleAtEnd: ended.visible,
    advancesDelta: stableCounterDelta(
      generationStable,
      started.advances,
      ended.advances,
    ),
    eventAdvancesDelta: stableCounterDelta(
      generationStable,
      started.eventAdvances,
      ended.eventAdvances,
    ),
    cadenceAdvancesDelta: stableCounterDelta(
      generationStable,
      started.cadenceAdvances,
      ended.cadenceAdvances,
    ),
    wakeupAdvancesDelta: stableCounterDelta(
      generationStable,
      started.wakeupAdvances,
      ended.wakeupAdvances,
    ),
    cadenceSkipsForPhaseShiftDelta: stableCounterDelta(
      generationStable,
      started.cadenceSkipsForPhaseShift,
      ended.cadenceSkipsForPhaseShift,
    ),
    rateLimitedAttemptsDelta: stableCounterDelta(
      generationStable,
      started.rateLimitedAttempts,
      ended.rateLimitedAttempts,
    ),
    coalescedVideoFramesDelta: stableCounterDelta(
      generationStable,
      started.coalescedVideoFrames,
      ended.coalescedVideoFrames,
    ),
    visibilityInterruptionsDelta: stableCounterDelta(
      generationStable,
      started.visibilityInterruptions,
      ended.visibilityInterruptions,
    ),
    maximumAdvanceDepth: ended.maximumAdvanceDepth,
  }
}

export function createBrowserLiveRenderScheduler(
  mode: LiveRenderScheduleMode,
  phaseRenderCapHz = PHASE_RENDER_CAP_HZ,
) {
  const scheduler = new LiveRenderScheduler(mode, {
    nowMs: () => performance.now(),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  }, phaseRenderCapHz)
  scheduler.setVisible(document.visibilityState === 'visible')
  return scheduler
}
