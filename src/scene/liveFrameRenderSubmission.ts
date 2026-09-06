export interface LiveFrameRenderSubmission {
  frameId: number
  schedulerGeneration: number
  renderRequestedAtMs: number
  r3fFrameObservedAtMs: number
}

export interface LiveFrameRenderIdentity {
  frameId: number
  schedulerGeneration: number
  renderRequestedAtMs: number
  texture: unknown
}

export interface LiveFrameRenderSubmissionTracker {
  observe: (
    signal: LiveFrameRenderIdentity,
    r3fFrameObservedAtMs: number,
  ) => boolean
  consumeAfterRender: () => LiveFrameRenderSubmission | null
}

export function liveFrameSignalMatchesCommittedTexture(
  signal: LiveFrameRenderIdentity,
  media: { kind: string; texture?: unknown } | null,
  schedulerGeneration: number,
) {
  return (
    signal.schedulerGeneration === schedulerGeneration &&
    media?.kind === 'texture' &&
    media.texture === signal.texture
  )
}

/**
 * Latches the newest decoded frame observed during R3F's update phase until
 * the same render loop reaches its after-render phase.
 */
export function createLiveFrameRenderSubmissionTracker(): LiveFrameRenderSubmissionTracker {
  let observedIdentity: string | null = null
  let pendingSubmission: LiveFrameRenderSubmission | null = null

  return {
    observe(signal, r3fFrameObservedAtMs) {
      const identity = `${signal.schedulerGeneration}:${signal.frameId}:${signal.renderRequestedAtMs}`
      if (identity === observedIdentity) return false
      observedIdentity = identity
      pendingSubmission = {
        frameId: signal.frameId,
        schedulerGeneration: signal.schedulerGeneration,
        renderRequestedAtMs: signal.renderRequestedAtMs,
        r3fFrameObservedAtMs,
      }
      return true
    },
    consumeAfterRender() {
      const submission = pendingSubmission
      pendingSubmission = null
      return submission
    },
  }
}
