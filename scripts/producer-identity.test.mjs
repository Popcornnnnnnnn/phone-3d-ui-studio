import { describe, expect, it } from 'vitest'
import {
  normalizeProducerIdentity,
  sameProducerIdentity,
  selectUniqueProducerPair,
} from './producer-identity.mjs'

const identity = {
  producerSessionId: 'session-a',
  captureSource: 'screencapturekit-host',
}

describe('producer identity', () => {
  it('requires a complete known identity and compares both fields', () => {
    expect(normalizeProducerIdentity('session-a', 'screencapturekit-host')).toEqual(
      identity,
    )
    expect(normalizeProducerIdentity('', 'screencapturekit-host')).toBeNull()
    expect(normalizeProducerIdentity('session-a', 'unknown')).toBeNull()
    expect(sameProducerIdentity(identity, { ...identity })).toBe(true)
    expect(
      sameProducerIdentity(identity, {
        ...identity,
        captureSource: 'replaykit-broadcast-upload',
      }),
    ).toBe(false)
  })

  it('selects one exact pose/frame session and rejects mixed producers', () => {
    expect(
      selectUniqueProducerPair(
        [{ ...identity, freshnessAtMs: 20 }],
        [{ ...identity, freshnessAtMs: 10 }],
      ),
    ).toMatchObject({
      reason: null,
      distinctProducerSessions: 1,
      pair: { key: 'screencapturekit-host:session-a' },
    })

    expect(
      selectUniqueProducerPair(
        [
          { ...identity, freshnessAtMs: 20 },
          {
            producerSessionId: 'session-b',
            captureSource: 'replaykit-broadcast-upload',
            freshnessAtMs: 19,
          },
        ],
        [
          { ...identity, freshnessAtMs: 10 },
          {
            producerSessionId: 'session-b',
            captureSource: 'replaykit-broadcast-upload',
            freshnessAtMs: 9,
          },
        ],
      ),
    ).toMatchObject({
      pair: null,
      reason: 'multiple-producer-sessions',
      distinctProducerSessions: 2,
    })
  })

  it('does not use address-only or identity-conflicted candidates', () => {
    expect(selectUniqueProducerPair([{}], [{}])).toMatchObject({
      pair: null,
      reason: 'producer-identity-incomplete',
    })
    expect(
      selectUniqueProducerPair(
        [{ ...identity }],
        [{ ...identity, producerIdentityValid: false }],
      ),
    ).toMatchObject({ pair: null })
  })
})
