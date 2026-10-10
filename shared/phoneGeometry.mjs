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
// (`xcrun simctl list devicetypes -j`). Dimensions: Apple Support 121029 / 121030.
// Display millimeters for the 16 family are derived from Apple's pixels / 460 ppi;
// they describe the bounding rectangle, not a measured visible rounded contour.
export const PHONE_PROFILES = Object.freeze({
  'iphone-17': Object.freeze({ id: 'iphone-17', name: 'iPhone 17', deviceModel: 'iPhone18,3',
    bodyMm: { width: IPHONE_17_MM.width, height: IPHONE_17_MM.height, depth: IPHONE_17_MM.depth },
    displayMm: { width: IPHONE_17_MM.displayWidth, height: IPHONE_17_MM.displayHeight },
    displayPixels: { ...IPHONE_17_DISPLAY.pixels },
    specification: 'https://developer.apple.com/download/files/accessories/dimensional-drawings/iphone-17.pdf' }),
  'iphone-16': Object.freeze({ id: 'iphone-16', name: 'iPhone 16', deviceModel: 'iPhone17,3',
    bodyMm: { width: 71.6, height: 147.6, depth: 7.8 },
    displayMm: { width: 1179 / 460 * 25.4, height: 2556 / 460 * 25.4 },
    displayPixels: { width: 1179, height: 2556 }, specification: 'https://support.apple.com/en-us/121029' }),
  'iphone-16-plus': Object.freeze({ id: 'iphone-16-plus', name: 'iPhone 16 Plus', deviceModel: 'iPhone17,4',
    bodyMm: { width: 77.8, height: 160.9, depth: 7.8 },
    displayMm: { width: 1290 / 460 * 25.4, height: 2796 / 460 * 25.4 },
    displayPixels: { width: 1290, height: 2796 }, specification: 'https://support.apple.com/en-us/121030' }),
})
export const DEFAULT_PHONE_PROFILE = PHONE_PROFILES['iphone-17']
export function phoneProfile(profileId) {
  return Object.hasOwn(PHONE_PROFILES, profileId) ? PHONE_PROFILES[profileId] : DEFAULT_PHONE_PROFILE
}
export function selectPhoneProfile(deviceModel) {
  const reported = typeof deviceModel === 'string' && deviceModel.length > 0 ? deviceModel.slice(0, 128) : null
  const known = Object.values(PHONE_PROFILES).find((profile) => profile.deviceModel === reported)
  const profile = known ?? DEFAULT_PHONE_PROFILE
  return { profileId: profile.id, name: profile.name, deviceModel: reported,
    status: known ? 'recognized' : reported ? 'unrecognized' : 'legacy-default',
    cameraCalibration: 'approximate', physicalValidation: 'pending' }
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
