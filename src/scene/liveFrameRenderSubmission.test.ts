import { describe, expect, it } from 'vitest'
import {
  createLiveFrameRenderSubmissionTracker,
  liveFrameSignalMatchesCommittedTexture,
} from './liveFrameRenderSubmission'

const texture = { name: 'live-texture' }

function signal(
  frameId: number,
  schedulerGeneration = 1,
  renderRequestedAtMs = 999,
) {
  return {
    frameId,
    schedulerGeneration,
    renderRequestedAtMs,
    texture,
  }
}

describe('live frame render submission tracker', () => {
  it('reports a newly observed frame once after render', () => {
    const tracker = createLiveFrameRenderSubmissionTracker()

    expect(tracker.observe(signal(41), 1_000.25)).toBe(true)

    expect(tracker.consumeAfterRender()).toEqual({
      frameId: 41,
      schedulerGeneration: 1,
      renderRequestedAtMs: 999,
      r3fFrameObservedAtMs: 1_000.25,
    })
    expect(tracker.consumeAfterRender()).toBeNull()
  })

  it('does not report an unchanged frame again', () => {
    const tracker = createLiveFrameRenderSubmissionTracker()

    tracker.observe(signal(41), 1_000)
    expect(tracker.consumeAfterRender()).toEqual({
      frameId: 41,
      schedulerGeneration: 1,
      renderRequestedAtMs: 999,
      r3fFrameObservedAtMs: 1_000,
    })

    expect(tracker.observe(signal(41), 1_001)).toBe(false)
    expect(tracker.consumeAfterRender()).toBeNull()
  })

  it('keeps only the freshest frame before render submission', () => {
    const tracker = createLiveFrameRenderSubmissionTracker()

    tracker.observe(signal(41), 1_000)
    tracker.observe(signal(42), 1_001)

    expect(tracker.consumeAfterRender()).toEqual({
      frameId: 42,
      schedulerGeneration: 1,
      renderRequestedAtMs: 999,
      r3fFrameObservedAtMs: 1_001,
    })
  })

  it('treats a scheduler generation change as a distinct render identity', () => {
    const tracker = createLiveFrameRenderSubmissionTracker()

    expect(tracker.observe(signal(41, 1), 1_000)).toBe(true)
    tracker.consumeAfterRender()
    expect(tracker.observe(signal(41, 2), 1_001)).toBe(true)
  })

  it('accepts a reused source frame id after a newer decode request', () => {
    const tracker = createLiveFrameRenderSubmissionTracker()

    expect(tracker.observe(signal(1, 1, 999), 1_000)).toBe(true)
    tracker.consumeAfterRender()
    expect(tracker.observe(signal(1, 1, 1_999), 2_000)).toBe(true)
  })

  it('rejects stale generations and frames whose texture is not committed yet', () => {
    const current = signal(41, 2)

    expect(liveFrameSignalMatchesCommittedTexture(current, null, 2)).toBe(false)
    expect(
      liveFrameSignalMatchesCommittedTexture(
        current,
        { kind: 'texture', texture: { name: 'not-live' } },
        2,
      ),
    ).toBe(false)
    expect(
      liveFrameSignalMatchesCommittedTexture(
        current,
        { kind: 'texture', texture },
        1,
      ),
    ).toBe(false)
    expect(
      liveFrameSignalMatchesCommittedTexture(
        current,
        { kind: 'texture', texture },
        2,
      ),
    ).toBe(true)
  })
})
