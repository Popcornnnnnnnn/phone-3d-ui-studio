import {
  createAdaptiveAndroidProfile,
  phoneProfile,
  type PhoneProfile,
  type PhoneProfileId,
} from '../../shared/phoneGeometry.mjs'
import type { WebDeviceMessage } from '../../shared/webPlayProtocol.mjs'

export interface DetectedDeviceInfo {
  platform: 'ios' | 'android' | 'other'
  screenWidth: number
  screenHeight: number
  dpr: number
  modelHint?: string
}

export interface InferredPhoneMatch {
  profileId: PhoneProfileId
  profile: PhoneProfile
  label: string
  confidence: 'exact-screen' | 'cohort' | 'adaptive' | 'fallback'
}

interface NavigatorUAData {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }>
}

export function inferPhoneFromDeviceInfo(info: DetectedDeviceInfo): InferredPhoneMatch {
  const shortSide = Math.round(Math.min(info.screenWidth, info.screenHeight))
  const longSide = Math.round(Math.max(info.screenWidth, info.screenHeight))
  const dpr = info.dpr || 2

  if (info.platform === 'ios') {
    // Match exact CSS point cohorts used by Apple's Modern iPhone displays.
    if (Math.abs(shortSide - 402) <= 2 && Math.abs(longSide - 874) <= 3 && dpr >= 2.5) {
      return {
        profileId: 'iphone-17-pro',
        profile: phoneProfile('iphone-17-pro'),
        label: 'Matched 6.3″ iPhone (17 / 17 Pro)',
        confidence: 'exact-screen',
      }
    }
    if (Math.abs(shortSide - 440) <= 2 && Math.abs(longSide - 956) <= 3 && dpr >= 2.5) {
      return {
        profileId: 'iphone-17-pro-max',
        profile: phoneProfile('iphone-17-pro-max'),
        label: 'Matched 6.9″ iPhone Pro Max',
        confidence: 'exact-screen',
      }
    }
    if (Math.abs(shortSide - 430) <= 2 && Math.abs(longSide - 932) <= 3 && dpr >= 2.5) {
      return {
        profileId: 'iphone-16-plus',
        profile: phoneProfile('iphone-16-plus'),
        label: 'Matched 6.7″ iPhone Plus / Max',
        confidence: 'exact-screen',
      }
    }
    if (Math.abs(shortSide - 393) <= 2 && Math.abs(longSide - 852) <= 3 && dpr >= 2.5) {
      return {
        profileId: 'iphone-16',
        profile: phoneProfile('iphone-16'),
        label: 'Matched 6.1″ iPhone',
        confidence: 'exact-screen',
      }
    }
    if (longSide >= 910) {
      return {
        profileId: 'iphone-16-plus',
        profile: phoneProfile('iphone-16-plus'),
        label: 'Matched large iPhone',
        confidence: 'cohort',
      }
    }
    return {
      profileId: 'iphone-16',
      profile: phoneProfile('iphone-16'),
      label: 'Matched compact iPhone',
      confidence: 'cohort',
    }
  }

  if (info.platform === 'android') {
    const label = info.modelHint?.trim() || 'Android Phone'
    const profile = createAdaptiveAndroidProfile({
      screenWidth: shortSide,
      screenHeight: longSide,
      dpr,
      modelLabel: label,
    })
    return {
      profileId: 'android-adaptive',
      profile,
      label: info.modelHint?.trim() ? `Adaptive · ${info.modelHint.trim()}` : 'Adaptive Android',
      confidence: 'adaptive',
    }
  }

  return {
    profileId: 'iphone-17',
    profile: phoneProfile('iphone-17'),
    label: 'Default reference (iPhone 17)',
    confidence: 'fallback',
  }
}

export async function detectLocalDeviceInfo(): Promise<DetectedDeviceInfo> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { platform: 'other', screenWidth: 402, screenHeight: 874, dpr: 3 }
  }

  const screenWidth = Math.max(100, Math.round(window.screen?.width ?? window.innerWidth ?? 402))
  const screenHeight = Math.max(100, Math.round(window.screen?.height ?? window.innerHeight ?? 874))
  const dpr = Math.max(0.5, Math.min(6, window.devicePixelRatio || 1))
  const ua = navigator.userAgent || ''

  let platform: DetectedDeviceInfo['platform'] = 'other'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    platform = 'ios'
  } else if (/Android/i.test(ua)) {
    platform = 'android'
  }

  let modelHint: string | undefined
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
  if (uaData?.platform?.toLowerCase() === 'android') {
    platform = 'android'
  }
  if (platform === 'android' && uaData?.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues(['model', 'platform'])
      if (typeof high.model === 'string' && high.model.trim()) {
        modelHint = high.model.trim().slice(0, 64)
      }
    } catch {
      // Ignore blocked User-Agent Client Hints
    }
  }

  return {
    platform,
    screenWidth,
    screenHeight,
    dpr,
    ...(modelHint ? { modelHint } : {}),
  }
}

export function detectedInfoFromMessage(msg: WebDeviceMessage): DetectedDeviceInfo {
  return {
    platform: msg.platform,
    screenWidth: msg.screenWidth,
    screenHeight: msg.screenHeight,
    dpr: msg.dpr,
    ...(msg.modelHint ? { modelHint: msg.modelHint } : {}),
  }
}
