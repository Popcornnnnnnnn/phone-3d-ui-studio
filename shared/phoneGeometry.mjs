export const IPHONE_17_MM = {
  width: 71.45,
  height: 149.61,
  depth: 7.95,
  glassWidth: 69.45,
  glassHeight: 147.61,
  displayWidth: 66.57,
  displayHeight: 144.79,
  rearLensDiameter: 16,
}

export const IPHONE_17_DISPLAY = {
  pixels: { width: 1206, height: 2622 },
  points: { width: 402, height: 874 },
  scale: 3,
}

export const MODEL_HEIGHT = 3

export function millimetersToScene(value) {
  return (value / IPHONE_17_MM.height) * MODEL_HEIGHT
}

export const IPHONE_17_SCENE = {
  width: millimetersToScene(IPHONE_17_MM.width),
  height: MODEL_HEIGHT,
  depth: millimetersToScene(IPHONE_17_MM.depth),
  glassWidth: millimetersToScene(IPHONE_17_MM.glassWidth),
  glassHeight: millimetersToScene(IPHONE_17_MM.glassHeight),
  displayWidth: millimetersToScene(IPHONE_17_MM.displayWidth),
  displayHeight: millimetersToScene(IPHONE_17_MM.displayHeight),
  rearLensDiameter: millimetersToScene(IPHONE_17_MM.rearLensDiameter),
}

// Hardware identifiers verified with Apple's installed CoreSimulator device types
// (`xcrun simctl list devicetypes -j`). Dimensions: Apple Support 121029 / 121030 & 2025 specs.
export const PHONE_PROFILES = Object.freeze({
  'iphone-17': Object.freeze({
    id: 'iphone-17',
    name: 'iPhone 17',
    deviceModel: 'iPhone18,3',
    bodyMm: { width: IPHONE_17_MM.width, height: IPHONE_17_MM.height, depth: IPHONE_17_MM.depth },
    displayMm: { width: IPHONE_17_MM.displayWidth, height: IPHONE_17_MM.displayHeight },
    displayPixels: { ...IPHONE_17_DISPLAY.pixels },
    specification: 'https://developer.apple.com/download/files/accessories/dimensional-drawings/iphone-17.pdf',
  }),
  'iphone-17-pro': Object.freeze({
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    deviceModel: 'iPhone18,1',
    bodyMm: { width: 71.9, height: 150.0, depth: 8.75 },
    displayMm: { width: 66.57, height: 144.79 },
    displayPixels: { width: 1206, height: 2622 },
    specification: 'https://support.apple.com/en-us/121031',
  }),
  'iphone-17-pro-max': Object.freeze({
    id: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    deviceModel: 'iPhone18,2',
    bodyMm: { width: 78.0, height: 163.4, depth: 8.75 },
    displayMm: { width: 73.1, height: 158.8 },
    displayPixels: { width: 1320, height: 2868 },
    specification: 'https://support.apple.com/en-us/121032',
  }),
  'iphone-16': Object.freeze({
    id: 'iphone-16',
    name: 'iPhone 16',
    deviceModel: 'iPhone17,3',
    bodyMm: { width: 71.6, height: 147.6, depth: 7.8 },
    displayMm: { width: 1179 / 460 * 25.4, height: 2556 / 460 * 25.4 },
    displayPixels: { width: 1179, height: 2556 },
    specification: 'https://support.apple.com/en-us/121029',
  }),
  'iphone-16-plus': Object.freeze({
    id: 'iphone-16-plus',
    name: 'iPhone 16 Plus',
    deviceModel: 'iPhone17,4',
    bodyMm: { width: 77.8, height: 160.9, depth: 7.8 },
    displayMm: { width: 1290 / 460 * 25.4, height: 2796 / 460 * 25.4 },
    displayPixels: { width: 1290, height: 2796 },
    specification: 'https://support.apple.com/en-us/121030',
  }),
  'iphone-16-pro': Object.freeze({
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    deviceModel: 'iPhone17,1',
    bodyMm: { width: 71.5, height: 149.6, depth: 8.25 },
    displayMm: { width: 66.57, height: 144.79 },
    displayPixels: { width: 1206, height: 2622 },
    specification: 'https://support.apple.com/en-us/121031',
  }),
  'iphone-16-pro-max': Object.freeze({
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    deviceModel: 'iPhone17,2',
    bodyMm: { width: 77.6, height: 163.0, depth: 8.25 },
    displayMm: { width: 72.9, height: 158.4 },
    displayPixels: { width: 1320, height: 2868 },
    specification: 'https://support.apple.com/en-us/121032',
  }),
  'android-adaptive': Object.freeze({
    id: 'android-adaptive',
    name: 'Android (Adaptive)',
    deviceModel: 'Android',
    bodyMm: { width: 73.5, height: 158.0, depth: 8.2 },
    displayMm: { width: 69.5, height: 153.5 },
    displayPixels: { width: 1080, height: 2400 },
    specification: 'https://phone3d.popcornnn.xyz/',
  }),
})

export const DEFAULT_PHONE_PROFILE = PHONE_PROFILES['iphone-17']

export function phoneProfile(profileId) {
  return Object.hasOwn(PHONE_PROFILES, profileId) ? PHONE_PROFILES[profileId] : DEFAULT_PHONE_PROFILE
}

export function createAdaptiveAndroidProfile({
  screenWidth = 412,
  screenHeight = 915,
  dpr = 3,
  modelLabel = null,
} = {}) {
  const shortSide = Math.max(100, Math.min(screenWidth, screenHeight))
  const longSide = Math.max(shortSide, Math.max(screenWidth, screenHeight))
  const aspect = Math.max(1.75, Math.min(2.35, longSide / shortSide))
  const heightMm = shortSide <= 370 ? 150.0 : 158.0
  const widthMm = Math.round(Math.max(68.0, Math.min(79.0, heightMm / aspect)) * 10) / 10
  const depthMm = 8.2
  const displayWidthMm = Math.round((widthMm - 4.0) * 10) / 10
  const displayHeightMm = Math.round((heightMm - 4.5) * 10) / 10
  const safeDpr = Math.max(1, Math.min(4, Number.isFinite(dpr) ? dpr : 3))
  const label = typeof modelLabel === 'string' && modelLabel.trim() ? modelLabel.trim().slice(0, 64) : 'Android Phone'

  return Object.freeze({
    id: 'android-adaptive',
    name: label,
    deviceModel: label,
    bodyMm: Object.freeze({ width: widthMm, height: heightMm, depth: depthMm }),
    displayMm: Object.freeze({ width: displayWidthMm, height: displayHeightMm }),
    displayPixels: Object.freeze({
      width: Math.round(shortSide * safeDpr),
      height: Math.round(longSide * safeDpr),
    }),
    specification: 'https://phone3d.popcornnn.xyz/',
  })
}

export const PHONE_FINISHES = Object.freeze([
  Object.freeze({
    id: 'obsidian',
    label: 'Obsidian',
    swatch: '#272a30',
    frameHex: '#3c4048',
    backHex: '#1f2228',
    buttonHex: '#4b505a',
  }),
  Object.freeze({
    id: 'silver',
    label: 'Silver',
    swatch: '#dde1e7',
    frameHex: '#cfd4dc',
    backHex: '#e6e9ef',
    buttonHex: '#bfc5cf',
  }),
  Object.freeze({
    id: 'natural',
    label: 'Natural',
    swatch: '#b8b1a6',
    frameHex: '#b2aba0',
    backHex: '#c6bfb5',
    buttonHex: '#9e978c',
  }),
  Object.freeze({
    id: 'deep-blue',
    label: 'Deep Blue',
    swatch: '#2d466b',
    frameHex: '#35517a',
    backHex: '#253a59',
    buttonHex: '#42618f',
  }),
  Object.freeze({
    id: 'sage',
    label: 'Sage',
    swatch: '#7f9982',
    frameHex: '#718a74',
    backHex: '#8aa48d',
    buttonHex: '#637b66',
  }),
  Object.freeze({
    id: 'cosmic-orange',
    label: 'Cosmic Orange',
    swatch: '#d9713b',
    frameHex: '#d46a34',
    backHex: '#c45b28',
    buttonHex: '#df7b46',
  }),
])

export const DEFAULT_PHONE_FINISH_ID = 'obsidian'

export function phoneFinish(finishId) {
  return PHONE_FINISHES.find((item) => item.id === finishId) ?? PHONE_FINISHES[0]
}

export function selectPhoneProfile(deviceModel) {
  const reported = typeof deviceModel === 'string' && deviceModel.length > 0 ? deviceModel.slice(0, 128) : null
  const known = Object.values(PHONE_PROFILES).find((profile) => profile.deviceModel === reported)
  const profile = known ?? DEFAULT_PHONE_PROFILE
  return {
    profileId: profile.id,
    name: profile.name,
    deviceModel: reported,
    status: known ? 'recognized' : reported ? 'unrecognized' : 'legacy-default',
    cameraCalibration: 'approximate',
    physicalValidation: 'pending',
  }
}

export function parsePhoneProfileSelection(value) {
  if (!value || typeof value !== 'object' || !(value.deviceModel === null ||
      typeof value.deviceModel === 'string' && value.deviceModel.length > 0 && value.deviceModel.length <= 128)) return null
  const selected = selectPhoneProfile(value.deviceModel)
  return Object.keys(selected).every((key) => value[key] === selected[key]) ? selected : null
}

export function phoneProfileNotice(selection) {
  if (selection.status === 'unrecognized') return `${selection.deviceModel}: unverified model · using iPhone 17 fallback dimensions.`
  if (selection.status === 'legacy-default') return 'Model not reported · using iPhone 17 reference dimensions.'
  return `${selection.name} · geometry profile loaded · device validation pending.`
}
