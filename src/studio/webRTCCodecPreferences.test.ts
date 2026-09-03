import { describe, expect, it } from 'vitest'

import { h264OnlyCodecPreferences } from './webRTCCodecPreferences'

describe('h264OnlyCodecPreferences', () => {
  it('keeps every H.264 profile and removes software-codec fallbacks', () => {
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

    expect(h264OnlyCodecPreferences(capabilities)).toEqual([
      capabilities.codecs[1],
      capabilities.codecs[2],
    ])
  })

  it('leaves the browser defaults untouched when H.264 is unavailable', () => {
    const capabilities = {
      codecs: [{ mimeType: 'video/VP8', clockRate: 90_000 }],
      headerExtensions: [],
    } satisfies RTCRtpCapabilities

    expect(h264OnlyCodecPreferences(capabilities)).toBeNull()
    expect(h264OnlyCodecPreferences(null)).toBeNull()
  })
})
