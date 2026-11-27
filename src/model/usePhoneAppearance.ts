import { useCallback, useMemo, useSyncExternalStore } from 'react'
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
  type PhoneProfileSelection,
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

export interface SharedDeviceState {
  detectedDevice: DetectedDeviceInfo | null
  detectedLabel: string | null
  bridgeDeviceProfile: PhoneProfileSelection | null
  activeConnectionKey: string | null
}

const DEFAULT_PREFS: PhoneAppearancePrefs = {
  profileId: 'iphone-17-pro',
  finishId: DEFAULT_PHONE_FINISH_ID,
  autoMatch: true,
}

const EMPTY_DEVICE_STATE: SharedDeviceState = Object.freeze({
  detectedDevice: null,
  detectedLabel: null,
  bridgeDeviceProfile: null,
  activeConnectionKey: null,
})

function emptyDeviceState(): SharedDeviceState {
  return EMPTY_DEVICE_STATE
}

export function isValidProfileId(id: unknown): id is PhoneProfileId {
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

// Lightweight cross-tab/component store so 3D Studio and Elastic Tray stay synchronized.
let sharedPrefs: PhoneAppearancePrefs = loadSavedPrefs()
const appearanceListeners = new Set<() => void>()
let sharedDeviceState: SharedDeviceState = EMPTY_DEVICE_STATE
const deviceListeners = new Set<() => void>()

function subscribeAppearance(listener: () => void) {
  appearanceListeners.add(listener)
  return () => {
    appearanceListeners.delete(listener)
  }
}

function getPrefsSnapshot() {
  return sharedPrefs
}

function getDefaultPrefsSnapshot() {
  return DEFAULT_PREFS
}

function subscribeDeviceState(listener: () => void) {
  deviceListeners.add(listener)
  return () => {
    deviceListeners.delete(listener)
  }
}

function getDeviceSnapshot() {
  return sharedDeviceState
}

function getEmptyDeviceSnapshot() {
  return EMPTY_DEVICE_STATE
}

function deviceStateEqual(a: SharedDeviceState, b: SharedDeviceState): boolean {
  return (
    a.activeConnectionKey === b.activeConnectionKey &&
    a.detectedLabel === b.detectedLabel &&
    a.bridgeDeviceProfile?.profileId === b.bridgeDeviceProfile?.profileId &&
    a.bridgeDeviceProfile?.deviceModel === b.bridgeDeviceProfile?.deviceModel &&
    a.bridgeDeviceProfile?.status === b.bridgeDeviceProfile?.status &&
    a.detectedDevice?.platform === b.detectedDevice?.platform &&
    a.detectedDevice?.screenWidth === b.detectedDevice?.screenWidth &&
    a.detectedDevice?.screenHeight === b.detectedDevice?.screenHeight &&
    a.detectedDevice?.dpr === b.detectedDevice?.dpr &&
    a.detectedDevice?.modelHint === b.detectedDevice?.modelHint
  )
}

function persistAndBroadcastPrefs(next: PhoneAppearancePrefs) {
  if (prefsEqual(sharedPrefs, next)) return
  sharedPrefs = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore storage restrictions
    }
  }
  appearanceListeners.forEach((fn) => fn())
}

function publishDeviceState(next: SharedDeviceState) {
  if (deviceStateEqual(sharedDeviceState, next)) return
  sharedDeviceState = next
  deviceListeners.forEach((fn) => fn())
}

function prefsEqual(a: PhoneAppearancePrefs, b: PhoneAppearancePrefs): boolean {
  return a.profileId === b.profileId && a.finishId === b.finishId && a.autoMatch === b.autoMatch
}

export function detectedDeviceFingerprint(prefix: 'web' | 'local', info: DetectedDeviceInfo): string {
  return `${prefix}:${info.platform}:${info.screenWidth}x${info.screenHeight}@${info.dpr}:${info.modelHint ?? ''}`
}

export function resolveDetectedDeviceUpdate(
  prevPrefs: PhoneAppearancePrefs,
  prevDevice: SharedDeviceState,
  info: DetectedDeviceInfo,
  options?: {
    sourcePrefix?: 'web' | 'local'
    profileId?: PhoneProfileId
    finishId?: PhoneFinishId
  },
): { nextPrefs: PhoneAppearancePrefs; nextDevice: SharedDeviceState } {
  const sourcePrefix = options?.sourcePrefix ?? 'local'
  const key = detectedDeviceFingerprint(sourcePrefix, info)
  const isNewConnection = prevDevice.activeConnectionKey !== key
  const match = inferPhoneFromDeviceInfo(info)

  const nextDevice: SharedDeviceState = {
    detectedDevice: info,
    detectedLabel: match.label,
    bridgeDeviceProfile: null,
    activeConnectionKey: key,
  }

  let nextProfile = prevPrefs.profileId
  let nextAutoMatch = prevPrefs.autoMatch

  if (options?.profileId && isValidProfileId(options.profileId)) {
    nextProfile = options.profileId
    nextAutoMatch = options.profileId === match.profileId
  } else if (isNewConnection || prevPrefs.autoMatch) {
    // Auto-match every new or changed connection even if an earlier manual choice set autoMatch=false.
    nextProfile = match.profileId
    nextAutoMatch = true
  }

  const nextFinish = options?.finishId && isValidFinishId(options.finishId)
    ? options.finishId
    : prevPrefs.finishId

  const nextPrefs: PhoneAppearancePrefs = {
    profileId: nextProfile,
    finishId: nextFinish,
    autoMatch: nextAutoMatch,
  }

  return { nextPrefs, nextDevice }
}

export function resolveBridgeProfileUpdate(
  prevPrefs: PhoneAppearancePrefs,
  prevDevice: SharedDeviceState,
  selection: PhoneProfileSelection | null,
): { nextPrefs: PhoneAppearancePrefs; nextDevice: SharedDeviceState } {
  if (!selection) {
    if (!prevDevice.activeConnectionKey?.startsWith('bridge:')) {
      return { nextPrefs: prevPrefs, nextDevice: prevDevice }
    }
    return {
      nextPrefs: prevPrefs,
      nextDevice: emptyDeviceState(),
    }
  }

  const key = `bridge:${selection.deviceModel ?? selection.profileId}`
  const isNewConnection = prevDevice.activeConnectionKey !== key
  const label =
    selection.status === 'recognized'
      ? `Connected · ${selection.name}`
      : selection.deviceModel
        ? `Connected · ${selection.deviceModel}`
        : 'Connected iPhone'

  const nextDevice: SharedDeviceState = {
    detectedDevice: null,
    detectedLabel: label,
    bridgeDeviceProfile: selection,
    activeConnectionKey: key,
  }

  let nextProfile = prevPrefs.profileId
  let nextAutoMatch = prevPrefs.autoMatch

  if (isValidProfileId(selection.profileId)) {
    const shouldSwitch =
      selection.status === 'recognized'
        ? isNewConnection || prevPrefs.autoMatch
        : prevPrefs.autoMatch
    if (shouldSwitch) {
      nextProfile = selection.profileId
      nextAutoMatch = true
    }
  }

  const nextPrefs: PhoneAppearancePrefs = {
    ...prevPrefs,
    profileId: nextProfile,
    autoMatch: nextAutoMatch,
  }

  return { nextPrefs, nextDevice }
}

export function resolveMatchedProfileId(deviceState: SharedDeviceState): PhoneProfileId | null {
  if (deviceState.detectedDevice) {
    return inferPhoneFromDeviceInfo(deviceState.detectedDevice).profileId
  }
  if (deviceState.bridgeDeviceProfile && isValidProfileId(deviceState.bridgeDeviceProfile.profileId)) {
    return deviceState.bridgeDeviceProfile.profileId
  }
  return null
}

export interface PhoneAppearanceState {
  profileId: PhoneProfileId
  finishId: PhoneFinishId
  autoMatch: boolean
  profile: PhoneProfile
  finish: PhoneFinish
  detectedLabel: string | null
  detectedDevice: DetectedDeviceInfo | null
  bridgeDeviceProfile: PhoneProfileSelection | null
  setProfileId: (id: PhoneProfileId) => void
  setFinishId: (id: PhoneFinishId) => void
  setAutoMatch: (enabled: boolean) => void
  applyDetectedDevice: (
    info: DetectedDeviceInfo,
    overrides?: { profileId?: PhoneProfileId; finishId?: PhoneFinishId },
  ) => void
  applyRemoteDevice: (msg: WebDeviceMessage | null) => void
  applyBridgeDeviceProfile: (selection: PhoneProfileSelection | null) => void
  resetToDetected: () => void
}

export function usePhoneAppearance(): PhoneAppearanceState {
  const prefs = useSyncExternalStore(
    subscribeAppearance,
    getPrefsSnapshot,
    getDefaultPrefsSnapshot,
  )
  const deviceState = useSyncExternalStore(
    subscribeDeviceState,
    getDeviceSnapshot,
    getEmptyDeviceSnapshot,
  )

  const setProfileId = useCallback((profileId: PhoneProfileId) => {
    persistAndBroadcastPrefs({ ...sharedPrefs, profileId, autoMatch: false })
  }, [])

  const setFinishId = useCallback((finishId: PhoneFinishId) => {
    persistAndBroadcastPrefs({ ...sharedPrefs, finishId })
  }, [])

  const applyDetectedDevice = useCallback(
    (info: DetectedDeviceInfo, overrides?: { profileId?: PhoneProfileId; finishId?: PhoneFinishId }) => {
      const { nextPrefs, nextDevice } = resolveDetectedDeviceUpdate(sharedPrefs, sharedDeviceState, info, {
        sourcePrefix: 'local',
        profileId: overrides?.profileId,
        finishId: overrides?.finishId,
      })
      publishDeviceState(nextDevice)
      persistAndBroadcastPrefs(nextPrefs)
    },
    [],
  )

  const applyRemoteDevice = useCallback((msg: WebDeviceMessage | null) => {
    if (!msg) {
      if (!sharedDeviceState.activeConnectionKey?.startsWith('web:')) return
      publishDeviceState(emptyDeviceState())
      return
    }
    const info = detectedInfoFromMessage(msg)
    const { nextPrefs, nextDevice } = resolveDetectedDeviceUpdate(sharedPrefs, sharedDeviceState, info, {
      sourcePrefix: 'web',
      profileId: msg.preferredProfileId,
      finishId: msg.preferredFinishId,
    })
    publishDeviceState(nextDevice)
    persistAndBroadcastPrefs(nextPrefs)
  }, [])

  const applyBridgeDeviceProfile = useCallback((selection: PhoneProfileSelection | null) => {
    const { nextPrefs, nextDevice } = resolveBridgeProfileUpdate(
      sharedPrefs,
      sharedDeviceState,
      selection,
    )
    publishDeviceState(nextDevice)
    persistAndBroadcastPrefs(nextPrefs)
  }, [])

  const resetToDetected = useCallback(() => {
    const matched = resolveMatchedProfileId(sharedDeviceState)
    persistAndBroadcastPrefs({
      ...sharedPrefs,
      profileId: matched ?? sharedPrefs.profileId,
      autoMatch: true,
    })
  }, [])

  const setAutoMatch = useCallback((enabled: boolean) => {
    const matched = enabled ? resolveMatchedProfileId(sharedDeviceState) : null
    persistAndBroadcastPrefs({
      ...sharedPrefs,
      profileId: matched ?? sharedPrefs.profileId,
      autoMatch: enabled,
    })
  }, [])

  const profile = useMemo(() => {
    if (prefs.profileId === 'android-adaptive' && deviceState.detectedDevice?.platform === 'android') {
      return createAdaptiveAndroidProfile({
        screenWidth: deviceState.detectedDevice.screenWidth,
        screenHeight: deviceState.detectedDevice.screenHeight,
        dpr: deviceState.detectedDevice.dpr,
        modelLabel: deviceState.detectedDevice.modelHint,
      })
    }
    return phoneProfile(prefs.profileId)
  }, [deviceState.detectedDevice, prefs.profileId])

  const finish = useMemo(() => phoneFinish(prefs.finishId), [prefs.finishId])

  return {
    profileId: prefs.profileId,
    finishId: prefs.finishId,
    autoMatch: prefs.autoMatch,
    profile,
    finish,
    detectedLabel: deviceState.detectedLabel,
    detectedDevice: deviceState.detectedDevice,
    bridgeDeviceProfile: deviceState.bridgeDeviceProfile,
    setProfileId,
    setFinishId,
    setAutoMatch,
    applyDetectedDevice,
    applyRemoteDevice,
    applyBridgeDeviceProfile,
    resetToDetected,
  }
}
