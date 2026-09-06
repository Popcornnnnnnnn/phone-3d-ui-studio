export function annexBCodec(bytes: Uint8Array): string {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Sample exceeds 2 MiB')
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue
    const start = bytes[i + 2] === 1 ? i + 3
      : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? i + 4 : -1
    if (start < 0 || (bytes[start] & 31) !== 7) continue
    if (start + 3 >= bytes.length) throw new Error('Truncated SPS')
    return `avc1.${[...bytes.slice(start + 1, start + 4)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  throw new Error('Annex-B sample has no SPS')
}

export interface PixelImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PixelRegion { x: number; y: number; width: number; height: number }

export function qualityRegionsForDimensions(width: number, height: number): Record<string, PixelRegion> {
  if (width === 640 && height === 384) return {
    colorBars: { x: 0, y: 0, width: 640, height: 256 },
    grayGradient: { x: 8, y: 256, width: 624, height: 64 },
    chromaGradient: { x: 8, y: 320, width: 624, height: 64 },
  }
  if (width === 960 && height === 2088) return {
    titleAndBodyText: { x: 264, y: 348, width: 585, height: 166 },
    appIcon: { x: 94, y: 348, width: 145, height: 145 },
    paleGradient: { x: 725, y: 520, width: 165, height: 44 },
    captureText: { x: 88, y: 840, width: 704, height: 220 },
  }
  throw new Error('No reviewed regions for these fixture dimensions')
}

// RGB error in sRGB byte space; non-overlapping 8x8 luminance SSIM with
// population variance and standard C1/C2. This is not perceptual acceptance.
export function comparePixels(a: PixelImage, b: PixelImage, region?: PixelRegion) {
  if (!Number.isInteger(a.width) || !Number.isInteger(a.height) ||
    a.width <= 0 || a.height <= 0 || a.width * a.height > 16_000_000 ||
    a.width !== b.width || a.height !== b.height ||
    a.data.length !== a.width * a.height * 4 || a.data.length !== b.data.length) {
    throw new Error('Expected equal, bounded RGBA images')
  }
  const r = region ?? { x: 0, y: 0, width: a.width, height: a.height }
  if (![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
    r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 ||
    r.x + r.width > a.width || r.y + r.height > a.height) {
    throw new Error('Invalid pixel region')
  }
  let squared = 0, absolute = 0, maxError = 0, ssim = 0, blocks = 0
  const c1 = (0.01 * 255) ** 2, c2 = (0.03 * 255) ** 2
  for (let by = r.y; by < r.y + r.height; by += 8) {
    for (let bx = r.x; bx < r.x + r.width; bx += 8) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0
      for (let y = by; y < Math.min(by + 8, r.y + r.height); y++) {
        for (let x = bx; x < Math.min(bx + 8, r.x + r.width); x++) {
          const i = (y * a.width + x) * 4
          for (let c = 0; c < 3; c++) {
            const error = Math.abs(a.data[i + c] - b.data[i + c])
            squared += error * error; absolute += error
            maxError = Math.max(maxError, error)
          }
          const ya = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2]
          const yb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2]
          sa += ya; sb += yb; saa += ya * ya; sbb += yb * yb; sab += ya * yb; n++
        }
      }
      const ma = sa / n, mb = sb / n
      ssim += ((2 * ma * mb + c1) * (2 * (sab / n - ma * mb) + c2)) /
        ((ma * ma + mb * mb + c1) * (Math.max(0, saa / n - ma * ma) +
          Math.max(0, sbb / n - mb * mb) + c2))
      blocks++
    }
  }
  const mse = squared / (r.width * r.height * 3)
  return {
    region: r, rgbRmse: Math.sqrt(mse), rgbMae: absolute / (r.width * r.height * 3),
    rgbMaxError: maxError, psnrDb: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse),
    exact: squared === 0, ssim8x8: ssim / blocks,
  }
}
