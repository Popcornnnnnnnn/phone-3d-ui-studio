import { describe, expect, it } from 'vitest'
import { annexBCodec, comparePixels, qualityRegionsForDimensions } from './browserQualityMetrics'

describe('browser quality evidence', () => {
  it('uses reviewed top-left PNG regions, never implicit vertical inversion', () => {
    expect(qualityRegionsForDimensions(640, 384)).toEqual({
      colorBars: { x: 0, y: 0, width: 640, height: 256 },
      grayGradient: { x: 8, y: 256, width: 624, height: 64 },
      chromaGradient: { x: 8, y: 320, width: 624, height: 64 },
    })
    expect(qualityRegionsForDimensions(960, 2088).appIcon.width).toBe(145)
    expect(() => qualityRegionsForDimensions(640, 400)).toThrow()
  })
  it('reads SPS profile/compatibility/level with either Annex-B delimiter', () => {
    expect(annexBCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x33]))).toBe('avc1.640033')
    expect(annexBCodec(new Uint8Array([0, 0, 1, 9, 0, 0, 1, 0x67, 0x42, 0xe0, 0x28]))).toBe('avc1.42e028')
  })
  it('rejects missing, truncated, oversized samples', () => {
    for (const bytes of [[], [0, 0, 1, 0x67, 0x42], [0, 0, 1, 0x65]]) {
      expect(() => annexBCodec(new Uint8Array(bytes))).toThrow()
    }
    expect(() => annexBCodec(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow()
  })
  it('reports exact pixels and finite JSON-compatible zero-error PSNR', () => {
    const a = { width: 1, height: 1, data: new Uint8ClampedArray([120, 120, 120, 255]) }
    expect(comparePixels(a, a)).toMatchObject({ exact: true, rgbRmse: 0, psnrDb: null, ssim8x8: 1 })
    const b = { ...a, data: new Uint8ClampedArray([130, 130, 130, 255]) }
    expect(comparePixels(a, b).rgbRmse).toBe(10)
    expect(comparePixels(a, b).psnrDb).toBeCloseTo(28.1308, 3)
  })
  it('validates dimensions and regions, and isolates selected pixels', () => {
    const a = { width: 2, height: 1, data: new Uint8ClampedArray(8) }
    const b = { ...a, data: new Uint8ClampedArray([10, 10, 10, 0, 0, 0, 0, 0]) }
    expect(comparePixels(a, b, { x: 1, y: 0, width: 1, height: 1 }).exact).toBe(true)
    expect(() => comparePixels(a, { ...b, width: 1 })).toThrow()
    expect(() => comparePixels(a, b, { x: -1, y: 0, width: 1, height: 1 })).toThrow()
    expect(() => comparePixels(a, b, { x: 0, y: 0, width: 3, height: 1 })).toThrow()
  })
})
