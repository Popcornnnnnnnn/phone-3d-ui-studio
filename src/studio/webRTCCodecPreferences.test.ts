import { describe, expect, it } from 'vitest'

import { vp8OnlyCodecPreferences } from './webRTCCodecPreferences'

describe('vp8OnlyCodecPreferences', () => {
  it('keeps VP8 and removes the broken forced-H.264 path', () => {
    const capabilities = {
      codecs: [
        { mimeType: 'video/VP8', clockRate: 90_000 },
        {
          mimeType: 'video/H264',
          clockRate: 90_000,
          sdpFmtpLine: 'profile-level-id=42e01f',
        },
        {
          mimeType: 'video/h264',
          clockRate: 90_000,
          sdpFmtpLine: 'profile-level-id=640c1f',
        },
        { mimeType: 'video/AV1', clockRate: 90_000 },
      ],
      headerExtensions: [],
    } satisfies RTCRtpCapabilities

    expect(vp8OnlyCodecPreferences(capabilities)).toEqual([
      capabilities.codecs[0],
    ])
  })

  it('leaves the browser defaults untouched when VP8 is unavailable', () => {
    const capabilities = {
      codecs: [{ mimeType: 'video/H264', clockRate: 90_000 }],
      headerExtensions: [],
    } satisfies RTCRtpCapabilities

    expect(vp8OnlyCodecPreferences(capabilities)).toBeNull()
    expect(vp8OnlyCodecPreferences(null)).toBeNull()
  })
})
