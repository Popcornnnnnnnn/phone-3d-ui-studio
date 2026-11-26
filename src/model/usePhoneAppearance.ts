import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PHONE_FINISH_ID,
  PHONE_FINISHES,
  PHONE_PROFILES,
  createAdaptiveAndroidProfile,
  phoneFinish,
  phoneProfile,
  type PhoneFinish,
  type PhoneFinishId,
  type PhoneProfile,
  type PhoneProfileId,
} from '../../shared/phoneGeometry.mjs'
import type { WebDeviceMessage } from '../../shared/webPlayProtocol.mjs'
import {
  detectedInfoFromMessage,
  inferPhoneFromDeviceInfo,
  type DetectedDeviceInfo,
} from '../webplay/deviceDetect'

const STORAGE_KEY = 'phone3d.appearance.v1'

export interface PhoneAppearancePrefs {
  profileId: PhoneProfileId
  finishId: PhoneFinishId
  autoMatch: boolean
}

const DEFAULT_PREFS: PhoneAppearancePrefs = {
  profileId: 'iphone-17-pro',
  finishId: DEFAULT_PHONE_FINISH_ID,
  autoMatch: true,
}

function isValidProfileId(id: unknown): id is PhoneProfileId {
  return typeof id === 'string' && Object.hasOwn(PHONE_PROFILES, id)
}

function isValidFinishId(id: unknown): id is PhoneFinishId {
  return typeof id === 'string' && PHONE_FINISHES.some((f) => f.id === id)
}

function loadSavedPrefs(): PhoneAppearancePrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<PhoneAppearancePrefs>
    return {
      profileId: isValidProfileId(parsed.profileId) ? parsed.profileId : DEFAULT_PREFS.profileId,
      finishId: isValidFinishId(parsed.finishId) ? parsed.finishId : DEFAULT_PREFS.finishId,
      autoMatch: typeof parsed.autoMatch === 'boolean' ? parsed.autoMatch : DEFAULT_PREFS.autoMatch,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

// Lightweight cross-tab/component listeners so Play Online and 3D UI Showcase stay synchronized.
const appearanceListeners = new Set<(prefs: PhoneAppearancePrefs) => void>()

function persistAndBroadcast(next: PhoneAppearancePrefs) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore storage restrictions
    }
  }
  appearanceListeners.forEach((fn) => fn(next))
}

export interface PhoneAppearanceState {
  profileId: PhoneProfileId
  finishId: PhoneFinishId
  autoMatch: boolean
  profile: PhoneProfile
  finish: PhoneFinish
  detectedLabel: string | null
  detectedDevice: DetectedDeviceInfo | null
  setProfileId: (id: PhoneProfileId) => void
  setFinishId: (id: PhoneFinishId) => void
  setAutoMatch: (enabled: boolean) => void
  applyDetectedDevice: (info: DetectedDeviceInfo, overrides?: { profileId?: PhoneProfileId; finishId?: PhoneFinishId }) => void
  applyRemoteDevice: (msg: WebDeviceMessage | null) => void
  resetToDetected: () => void
}

export function usePhoneAppearance(): PhoneAppearanceState {
  const [prefs, setPrefs] = useState<PhoneAppearancePrefs>(loadSavedPrefs)
  const [detectedDevice, setDetectedDevice] = useState<DetectedDeviceInfo | null>(null)
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null)

  useEffect(() => {
    const listener = (next: PhoneAppearancePrefs) => setPrefs(next)
    appearanceListeners.add(listener)
    return () => {
      appearanceListeners.delete(listener)
    }
  }, [])

  const setProfileId = useCallback((profileId: PhoneProfileId) => {
    setPrefs((prev) => {
      const next: PhoneAppearancePrefs = { ...prev, profileId, autoMatch: false }
      persistAndBroadcast(next)
      return next
    })
  }, [])

  const setFinishId = useCallback((finishId: PhoneFinishId) => {
    setPrefs((prev) => {
      const next: PhoneAppearancePrefs = { ...prev, finishId }
      persistAndBroadcast(next)
      return next
    })
  }, [])

  const applyDetectedDevice = useCallback(
    (info: DetectedDeviceInfo, overrides?: { profileId?: PhoneProfileId; finishId?: PhoneFinishId }) => {
      setDetectedDevice(info)
      const match = inferPhoneFromDeviceInfo(info)
      setDetectedLabel(match.label)

      setPrefs((prev) => {
        const nextProfile = overrides?.profileId ?? (prev.autoMatch ? match.profileId : prev.profileId)
        const nextFinish = overrides?.finishId ?? prev.finishId
        if (nextProfile === prev.profileId && nextFinish === prev.finishId) return prev
        const next: PhoneAppearancePrefs = {
          ...prev,
          profileId: nextProfile,
          finishId: nextFinish,
        }
        persistAndBroadcast(next)
        return next
      })
    },
    [],
  )

  const applyRemoteDevice = useCallback(
    (msg: WebDeviceMessage | null) => {
      if (!msg) {
        setDetectedDevice(null)
        setDetectedLabel(null)
        return
      }
      applyDetectedDevice(detectedInfoFromMessage(msg), {
        profileId: msg.preferredProfileId,
        finishId: msg.preferredFinishId,
      })
    },
    [applyDetectedDevice],
  )

  const resetToDetected = useCallback(() => {
    setPrefs((prev) => {
      const nextProfile = detectedDevice ? inferPhoneFromDeviceInfo(detectedDevice).profileId : prev.profileId
      const next: PhoneAppearancePrefs = { ...prev, profileId: nextProfile, autoMatch: true }
      persistAndBroadcast(next)
      return next
    })
  }, [detectedDevice])

  const setAutoMatch = useCallback(
    (enabled: boolean) => {
      setPrefs((prev) => {
        const nextProfile =
          enabled && detectedDevice ? inferPhoneFromDeviceInfo(detectedDevice).profileId : prev.profileId
        const next: PhoneAppearancePrefs = { ...prev, profileId: nextProfile, autoMatch: enabled }
        persistAndBroadcast(next)
        return next
      })
    },
    [detectedDevice],
  )

  const profile = useMemo(() => {
    if (prefs.profileId === 'android-adaptive' && detectedDevice?.platform === 'android') {
      return createAdaptiveAndroidProfile({
        screenWidth: detectedDevice.screenWidth,
        screenHeight: detectedDevice.screenHeight,
        dpr: detectedDevice.dpr,
        modelLabel: detectedDevice.modelHint,
      })
    }
    return phoneProfile(prefs.profileId)
  }, [detectedDevice, prefs.profileId])

  const finish = useMemo(() => phoneFinish(prefs.finishId), [prefs.finishId])

  return {
    profileId: prefs.profileId,
    finishId: prefs.finishId,
    autoMatch: prefs.autoMatch,
    profile,
    finish,
    detectedLabel,
    detectedDevice,
    setProfileId,
    setFinishId,
    setAutoMatch,
    applyDetectedDevice,
    applyRemoteDevice,
    resetToDetected,
  }
}
