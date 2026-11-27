import { millimetersToScene, type PhoneProfile, type PhoneProfileId } from '../../shared/phoneGeometry.mjs'

export type PublicPhoneGlbId = 'iphone-17-pro' | 'iphone-16' | 'iphone-16-pro'

export interface PublicPhoneAssetAttribution {
  id: PublicPhoneGlbId
  title: string
  creator: string
  creatorUrl: string
  modelUrl: string
  licenseName: string
  licenseUrl: string
  modifications: string
}

export interface PublicPhoneFrontFaceSpec {
  /** Glass bezel width / total normalized body width */
  bezelWidthRatio: number
  /** Glass bezel height / total normalized body height */
  bezelHeightRatio: number
  /** Glass bezel corner radius / min(bezelWidth, bezelHeight) */
  bezelCornerRatio: number
  /** Active OLED display width / total normalized body width */
  displayWidthRatio: number
  /** Active OLED display height / total normalized body height */
  displayHeightRatio: number
  /** Active OLED corner radius / min(displayWidth, displayHeight) */
  displayCornerRatio: number
  /** Distance from the active screen top edge to the Dynamic Island center */
  islandOffsetFromTopMm: number
}

export interface PublicPhoneAssetSpec {
  id: PublicPhoneGlbId
  file: string
  /** Normalized dimensions measured in Blender where bodyHeight == 1.0 */
  normalized: {
    bodyWidth: number
    bodyHeight: number
    bodyDepth: number
    frontGlassZ: number
  }
  frontFace: PublicPhoneFrontFaceSpec
  frameMaterials: readonly string[]
  backMaterials: readonly string[]
  accentMaterials: readonly string[]
  attribution: PublicPhoneAssetAttribution
}

export const PUBLIC_PHONE_ASSETS: Readonly<Record<PublicPhoneGlbId, PublicPhoneAssetSpec>> = {
  'iphone-17-pro': {
    id: 'iphone-17-pro',
    file: 'iphone-17-pro.glb',
    normalized: {
      bodyWidth: 0.487376,
      bodyHeight: 1.0,
      bodyDepth: 0.057222,
      frontGlassZ: 0.028611,
    },
    frontFace: {
      bezelWidthRatio: 0.966,
      bezelHeightRatio: 0.991,
      bezelCornerRatio: 0.176,
      displayWidthRatio: 0.936,
      displayHeightRatio: 0.976,
      displayCornerRatio: 0.165,
      islandOffsetFromTopMm: 5.4,
    },
    frameMaterials: ['Anodized_aluminum', 'Plastic_antena'],
    backMaterials: ['Frosted_glass', 'Glass_tint'],
    accentMaterials: ['Display_Frame'],
    attribution: {
      id: 'iphone-17-pro',
      title: 'iPhone 17 Pro',
      creator: 'Ranguel',
      creatorUrl: 'https://sketchfab.com/Ranguel',
      modelUrl: 'https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec',
      licenseName: 'CC-BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      modifications:
        'Oriented screen-forward (+Z, +Y up), centered at origin, wallpaper replaced with matte screen backing, textures downscaled, Draco-compressed to GLB.',
    },
  },
  'iphone-16': {
    id: 'iphone-16',
    file: 'iphone-16.glb',
    normalized: {
      bodyWidth: 0.484174,
      bodyHeight: 1.0,
      bodyDepth: 0.051813,
      frontGlassZ: 0.025906,
    },
    frontFace: {
      bezelWidthRatio: 0.974,
      bezelHeightRatio: 0.989,
      bezelCornerRatio: 0.164,
      displayWidthRatio: 0.938,
      displayHeightRatio: 0.972,
      displayCornerRatio: 0.153,
      islandOffsetFromTopMm: 5.6,
    },
    frameMaterials: ['SNEsafZygRmlhRr'],
    backMaterials: ['imSnhDbpTQibpde', 'FpuaJVrjAsixZjs'],
    accentMaterials: ['DGqhsECDVpTtHfY'],
    attribution: {
      id: 'iphone-16',
      title: 'iPhone 16 Black',
      creator: 'Zvoni10',
      creatorUrl: 'https://sketchfab.com/Zvoni10',
      modelUrl: 'https://sketchfab.com/3d-models/iphone-16-black-91f29764b9df48759fa2195388e04468',
      licenseName: 'CC-BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      modifications:
        'Oriented screen-forward (+Z, +Y up), centered at origin, front decals/wallpaper replaced with matte backing, textures downscaled, Draco-compressed to GLB.',
    },
  },
  'iphone-16-pro': {
    id: 'iphone-16-pro',
    file: 'iphone-16-pro.glb',
    normalized: {
      bodyWidth: 0.480101,
      bodyHeight: 1.0,
      bodyDepth: 0.05268,
      frontGlassZ: 0.02634,
    },
    frontFace: {
      bezelWidthRatio: 0.964,
      bezelHeightRatio: 0.990,
      bezelCornerRatio: 0.158,
      displayWidthRatio: 0.936,
      displayHeightRatio: 0.975,
      displayCornerRatio: 0.148,
      islandOffsetFromTopMm: 5.4,
    },
    frameMaterials: ['metalframe.002'],
    backMaterials: ['basecolor.001'],
    accentMaterials: ['apple_logo.001'],
    attribution: {
      id: 'iphone-16-pro',
      title: 'iPhone 16 Pro Max',
      creator: 'MajdyModels',
      creatorUrl: 'https://sketchfab.com/MG990',
      modelUrl: 'https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3',
      licenseName: 'CC-BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      modifications:
        'Oriented screen-forward (+Z, +Y up), centered at origin, speaker grille decimated, wallpaper removed, titanium finish normalized, Draco-compressed to GLB.',
    },
  },
}

const PROFILE_TO_PUBLIC_GLB: Record<PhoneProfileId, PublicPhoneGlbId | null> = {
  'iphone-17': 'iphone-16',
  'iphone-17-pro': 'iphone-17-pro',
  'iphone-17-pro-max': 'iphone-17-pro',
  'iphone-16': 'iphone-16',
  'iphone-16-plus': 'iphone-16',
  'iphone-16-pro': 'iphone-16-pro',
  'iphone-16-pro-max': 'iphone-16-pro',
  'android-adaptive': null,
}

export function publicPhoneAssetForProfile(profileId: string): PublicPhoneAssetSpec | null {
  const mapped = (PROFILE_TO_PUBLIC_GLB as Record<string, PublicPhoneGlbId | null>)[profileId]
  return mapped ? PUBLIC_PHONE_ASSETS[mapped] : null
}

export interface FittedPhoneDisplayMetrics {
  bodyWidth: number
  bodyHeight: number
  bodyDepth: number
  bezelWidth: number
  bezelHeight: number
  bezelCornerRadius: number
  displayWidth: number
  displayHeight: number
  displayCornerRadius: number
  islandOffsetFromTop: number
}

/**
 * Computes bezel and active OLED screen dimensions fitted cleanly to each
 * model's physical silhouette and metal rim opening.
 */
export function fittedPhoneDisplayMetrics(profile: PhoneProfile): FittedPhoneDisplayMetrics {
  const bodyWidth = millimetersToScene(profile.bodyMm.width)
  const bodyHeight = millimetersToScene(profile.bodyMm.height)
  const bodyDepth = millimetersToScene(profile.bodyMm.depth)
  const asset = publicPhoneAssetForProfile(profile.id)

  if (asset) {
    const { frontFace } = asset
    const bezelWidth = bodyWidth * frontFace.bezelWidthRatio
    const bezelHeight = bodyHeight * frontFace.bezelHeightRatio
    const bezelCornerRadius = Math.min(bezelWidth, bezelHeight) * frontFace.bezelCornerRatio
    const displayWidth = bodyWidth * frontFace.displayWidthRatio
    const displayHeight = bodyHeight * frontFace.displayHeightRatio
    const displayCornerRadius = Math.min(displayWidth, displayHeight) * frontFace.displayCornerRatio
    return {
      bodyWidth,
      bodyHeight,
      bodyDepth,
      bezelWidth,
      bezelHeight,
      bezelCornerRadius,
      displayWidth,
      displayHeight,
      displayCornerRadius,
      islandOffsetFromTop: millimetersToScene(frontFace.islandOffsetFromTopMm),
    }
  }

  if (profile.id === 'android-adaptive') {
    const bezelWidth = bodyWidth * 0.976
    const bezelHeight = bodyHeight * 0.986
    const bezelCornerRadius = Math.min(bodyWidth, bodyHeight) * 0.108
    const displayWidth = Math.min(millimetersToScene(profile.displayMm.width), bezelWidth * 0.974)
    const displayHeight = Math.min(millimetersToScene(profile.displayMm.height), bezelHeight * 0.986)
    const displayCornerRadius = Math.min(bodyWidth, bodyHeight) * 0.100
    return {
      bodyWidth,
      bodyHeight,
      bodyDepth,
      bezelWidth,
      bezelHeight,
      bezelCornerRadius,
      displayWidth,
      displayHeight,
      displayCornerRadius,
      islandOffsetFromTop: millimetersToScene(5.2),
    }
  }

  const displayWidth = millimetersToScene(profile.displayMm.width)
  const displayHeight = millimetersToScene(profile.displayMm.height)
  return {
    bodyWidth,
    bodyHeight,
    bodyDepth,
    bezelWidth: bodyWidth * 0.968,
    bezelHeight: bodyHeight * 0.986,
    bezelCornerRadius: Math.min(bodyWidth, bodyHeight) * 0.165,
    displayWidth,
    displayHeight,
    displayCornerRadius: Math.min(displayWidth, displayHeight) * 0.155,
    islandOffsetFromTop: millimetersToScene(5.4),
  }
}

export function publicPhoneGlbUrl(asset: PublicPhoneAssetSpec): string {
  return `${import.meta.env.BASE_URL}models/${asset.file}`
}

export const PUBLIC_DRACO_DECODER_PATH = `${import.meta.env.BASE_URL}draco/`

export const ALL_PUBLIC_ATTRIBUTIONS: readonly PublicPhoneAssetAttribution[] = Object.values(
  PUBLIC_PHONE_ASSETS,
).map((asset) => asset.attribution)
