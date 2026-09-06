import {
  LinearFilter, Mesh, NoToneMapping, OrthographicCamera, PlaneGeometry,
  Scene, ShaderMaterial, SRGBColorSpace, VideoFrameTexture, WebGLRenderer,
} from 'three'
import { screenFragmentShader, screenVertexShader } from '../scene/screenSurfaceShader'
import { buildH264DecoderConfig, h264DecoderSelectionFromSearch } from '../studio/useLivePhoneSource'
import { annexBCodec, comparePixels, qualityRegionsForDimensions } from './browserQualityMetrics'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const summary = document.querySelector<HTMLPreElement>('#summary')!
const readout = document.querySelector<HTMLPreElement>('#readout')!
const images = document.querySelector<HTMLElement>('#images')!
const downloads = document.querySelector<HTMLDivElement>('#downloads')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const scaleButton = document.querySelector<HTMLButtonElement>('#scale')!
const sampleSelect = document.querySelector<HTMLSelectElement>('#sample')!
const objectUrls: string[] = []

function canvasFrom(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D unavailable')
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

function pixels(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
}

function comparison(a: HTMLCanvasElement, b: HTMLCanvasElement) {
  const pa = pixels(a), pb = pixels(b)
  const regions = qualityRegionsForDimensions(a.width, a.height)
  return { full: comparePixels(pa, pb), regions: Object.fromEntries(
    Object.entries(regions).map(([name, region]) => [name, comparePixels(pa, pb, region)]),
  ) }
}

async function hash(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchBytes(path: string) {
  const response = await fetch(path, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Fixture exceeds 16 MiB')
  return bytes
}

async function imageFrom(bytes: ArrayBuffer, width: number, height: number) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    colorSpaceConversion: 'default',
  })
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new Error('Fixture dimension mismatch')
    return canvasFrom(bitmap, width, height)
  } finally { bitmap.close() }
}

async function decode(bytes: ArrayBuffer, config: VideoDecoderConfig, frameId: number) {
  let frame: VideoFrame | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let fail: (error: Error) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    fail = reject
    timer = setTimeout(() => reject(new Error('Decoder timeout after 10 seconds')), 10_000)
  })
  const decoder = new VideoDecoder({
    output: (next) => {
      if (frame) { next.close(); fail(new Error('Expected exactly one output frame')); return }
      frame = next
    }, error: (error) => fail(error),
  })
  try {
    decoder.configure(config)
    decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: frameId, data: bytes }))
    await Promise.race([decoder.flush(), failed])
    if (!frame) throw new Error('Decoder produced no frame')
    const result: VideoFrame = frame
    frame = null
    return result
  } finally {
    clearTimeout(timer)
    if (decoder.state !== 'closed') decoder.close()
    const leftover = frame as VideoFrame | null
    leftover?.close()
  }
}

function renderScreen(frame: VideoFrame) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  let shaderFailed = false
  renderer.debug.onShaderError = () => { shaderFailed = true }
  const texture = new VideoFrameTexture()
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.setFrame(frame)
  const material = new ShaderMaterial({
    vertexShader: screenVertexShader, fragmentShader: screenFragmentShader,
    toneMapped: false,
    uniforms: {
      contentScale: { value: [1, 1] }, decodeVideoTexture: { value: 1 },
      landscape: { value: 0 }, screenTexture: { value: texture },
    },
  })
  const geometry = new PlaneGeometry(2, 2)
  try {
    renderer.setPixelRatio(1)
    renderer.setSize(frame.displayWidth, frame.displayHeight, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NoToneMapping
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000)
    // Huge camera distance makes production view-angle brightness unity at
    // byte precision. This diagnostic intentionally excludes perspective.
    camera.position.z = 1000
    const scene = new Scene()
    scene.add(new Mesh(geometry, material))
    renderer.render(scene, camera)
    if (shaderFailed) {
      throw new Error('Production screen shader failed to compile')
    }
    return canvasFrom(renderer.domElement, frame.displayWidth, frame.displayHeight)
  } finally {
    geometry.dispose(); material.dispose(); texture.dispose(); renderer.dispose()
    renderer.forceContextLoss()
  }
}

function addDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  objectUrls.push(url)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.textContent = `Download ${filename}`
  downloads.append(anchor)
}

async function addCanvas(canvas: HTMLCanvasElement, label: string, filename: string) {
  const figure = document.createElement('figure'), title = document.createElement('h2')
  title.textContent = label; figure.append(title, canvas); images.append(figure)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png',
  ))
  addDownload(blob, filename)
}

async function run() {
  runButton.disabled = true; sampleSelect.disabled = true
  images.replaceChildren(); downloads.replaceChildren(); summary.textContent = ''
  readout.textContent = ''
  objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url))
  try {
    if (!import.meta.env.DEV) throw new Error('Replay is available only in the local development server')
    if (!['5', '10', '15', 'color-control', 'color-explicit', 'device-color-after'].includes(sampleSelect.value)) throw new Error('Unknown fixture')
    const mbps = sampleSelect.value
    const isColorFixture = mbps.startsWith('color-')
    const isDeviceColorAfter = mbps === 'device-color-after'
    const source = isDeviceColorAfter ? '/captures/color-metadata-device-after-20260906-a'
      : isColorFixture ? `/captures/color-metadata-${mbps.slice(6)}-20260906-a`
      : `/captures/device-quality-ab-${mbps}mbps-20260905-a`
    const nativeSource = isColorFixture || isDeviceColorAfter ? `${source}/native-decoded`
      : `/captures/device-quality-ab-${mbps}mbps-decoded-20260905-a`
    status.textContent = 'Loading the exact saved frame; no device commands are sent…'
    const [manifestBytes, encoded, inputBytes, nativeBytes] = await Promise.all([
      fetchBytes(`${source}/manifest.json`), fetchBytes(`${source}/encoded.bin`),
      fetchBytes(`${source}/pre-encode.png`), fetchBytes(`${nativeSource}/decoded.png`),
    ])
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
    const expected = isColorFixture ? { width: 640, height: 384 } : { width: 960, height: 2088 }
    if (manifest.width !== expected.width || manifest.height !== expected.height || !manifest.isKeyframe ||
      manifest.bitstreamFormat !== 'annex-b' || manifest.encodedBytes !== encoded.byteLength ||
      !Number.isSafeInteger(manifest.frameId)) throw new Error('Unexpected physical sample manifest')
    const codec = annexBCodec(new Uint8Array(encoded))
    const selection = h264DecoderSelectionFromSearch('')
    const configuration = buildH264DecoderConfig(codec, selection, 'annex-b', null)!
    if (!(await VideoDecoder.isConfigSupported(configuration)).supported) throw new Error('Production decoder config unsupported')
    status.textContent = 'Decoding one IDR and reading the production shader framebuffer…'
    const frame = await decode(encoded, configuration, manifest.frameId)
    let browserDecoded: HTMLCanvasElement, browserRendered: HTMLCanvasElement, colorSpace: VideoColorSpaceInit
    try {
      if (frame.displayWidth !== manifest.width || frame.displayHeight !== manifest.height || frame.timestamp !== manifest.frameId) {
        throw new Error('Decoded frame identity/dimensions mismatch')
      }
      colorSpace = frame.colorSpace.toJSON()
      browserDecoded = canvasFrom(frame, frame.displayWidth, frame.displayHeight)
      browserRendered = renderScreen(frame)
    } finally { frame.close() }
    const [input, native] = await Promise.all([
      imageFrom(inputBytes, manifest.width, manifest.height), imageFrom(nativeBytes, manifest.width, manifest.height),
    ])
    const results = {
      schemaVersion: 2, createdAt: new Date().toISOString(), source, nativeSource, manifest,
      encodedSha256: await hash(encoded), inputSha256: await hash(inputBytes), nativePngSha256: await hash(nativeBytes),
      userAgent: navigator.userAgent, configuration, decodedColorSpace: colorSpace,
      render: { width: manifest.width, height: manifest.height, dpr: 1, contentScale: [1, 1], facing: 'front', texture: 'VideoFrameTexture', productionShader: true },
      metric: 'sRGB RGB-byte RMSE/MAE/PSNR; nonoverlapping 8x8 Rec709-luma SSIM, population variance',
      scope: `${isColorFixture ? 'Mac generated color fixture' : 'Saved physical iPhone IDR'} replay. Not moving-frame, wireless-latency, live viewport or display-photon acceptance.`,
      comparisons: {
        inputToNative: comparison(input, native), inputToBrowserDecoded: comparison(input, browserDecoded),
        nativeToBrowserDecoded: comparison(native, browserDecoded),
        browserDecodedToRendered: comparison(browserDecoded, browserRendered), inputToRendered: comparison(input, browserRendered),
      },
    }
    summary.textContent = JSON.stringify(results, null, 2)
    readout.textContent = Object.entries(results.comparisons).map(([name, result]) =>
      `${name}: RMSE ${result.full.rgbRmse.toFixed(4)}, SSIM ${result.full.ssim8x8.toFixed(6)}, max ${result.full.rgbMaxError}`,
    ).join('\n')
    const prefix = isColorFixture || isDeviceColorAfter ? `phone3d-browser-quality-${mbps}` : `phone3d-browser-quality-${mbps}mbps`
    addDownload(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }), `${prefix}.json`)
    await addCanvas(input, 'Exact pre-encode input', `${prefix}-input.png`)
    await addCanvas(native, 'Native VideoToolbox decode', `${prefix}-native.png`)
    await addCanvas(browserDecoded, 'Chrome WebCodecs decode', `${prefix}-decoded.png`)
    await addCanvas(browserRendered, 'Production screen shader · 1:1', `${prefix}-rendered.png`)
    status.textContent = `Complete: frame ${manifest.frameId}, ${manifest.width} × ${manifest.height}. Metrics and same-frame PNGs ready.`
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}. No automatic retry.`
  } finally { runButton.disabled = false; sampleSelect.disabled = false }
}

runButton.addEventListener('click', () => { void run() })
scaleButton.addEventListener('click', () => {
  images.classList.toggle('preview')
  scaleButton.textContent = images.classList.contains('preview') ? 'Show 1:1 pixels' : 'Show compact preview'
})
window.addEventListener('pagehide', () => objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url)))
