import { describe, expect, it } from 'vitest'
import { selectPhoneProfile } from '../../shared/phoneGeometry.mjs'
import {
  resolveBridgeProfileUpdate,
  resolveDetectedDeviceUpdate,
  resolveMatchedProfileId,
  type PhoneAppearancePrefs,
  type SharedDeviceState,
} from './usePhoneAppearance'

const emptyDevice = (): SharedDeviceState => ({
  detectedDevice: null,
  detectedLabel: null,
  bridgeDeviceProfile: null,
  activeConnectionKey: null,
})

describe('usePhoneAppearance matching helpers', () => {
  it('auto-matches a newly paired remote iOS or Android device even when stale prefs had autoMatch=false', () => {
    const staleManualPrefs: PhoneAppearancePrefs = {
      profileId: 'iphone-16',
      finishId: 'silver',
      autoMatch: false,
    }
    const iosMsg = {
      platform: 'ios' as const,
      screenWidth: 440,
      screenHeight: 956,
      dpr: 3,
    }

    const first = resolveDetectedDeviceUpdate(staleManualPrefs, emptyDevice(), iosMsg, {
      sourcePrefix: 'web',
    })
    expect(first.nextPrefs.profileId).toBe('iphone-17-pro-max')
    expect(first.nextPrefs.autoMatch).toBe(true)
    expect(first.nextPrefs.finishId).toBe('silver')

    // Manual override during the active connection stays preserved on repeat heartbeats
    const manualInSession: PhoneAppearancePrefs = {
      ...first.nextPrefs,
      profileId: 'iphone-16',
      autoMatch: false,
    }
    const repeat = resolveDetectedDeviceUpdate(manualInSession, first.nextDevice, iosMsg, {
      sourcePrefix: 'web',
    })
    expect(repeat.nextPrefs.profileId).toBe('iphone-16')
    expect(repeat.nextPrefs.autoMatch).toBe(false)

    // Connecting a different device (Android) re-engages automatic model switching
    const androidUpdate = resolveDetectedDeviceUpdate(
      repeat.nextPrefs,
      repeat.nextDevice,
      {
        platform: 'android',
        screenWidth: 412,
        screenHeight: 915,
        dpr: 3,
        modelHint: 'Pixel 9 Pro',
      },
      { sourcePrefix: 'web' },
    )
    expect(androidUpdate.nextPrefs.profileId).toBe('android-adaptive')
    expect(androidUpdate.nextPrefs.autoMatch).toBe(true)
    expect(androidUpdate.nextDevice.detectedLabel).toBe('Adaptive · Pixel 9 Pro')
  })

  it('disconnecting and reconnecting auto-matches again and honors explicit mobile finish changes', () => {
    const prefs: PhoneAppearancePrefs = {
      profileId: 'iphone-17-pro',
      finishId: 'obsidian',
      autoMatch: false,
    }
    const { nextPrefs, nextDevice } = resolveDetectedDeviceUpdate(
      prefs,
      emptyDevice(),
      {
        platform: 'ios',
        screenWidth: 393,
        screenHeight: 852,
        dpr: 3,
      },
      {
        sourcePrefix: 'web',
        finishId: 'cosmic-orange',
      },
    )
    expect(nextPrefs.profileId).toBe('iphone-16')
    expect(nextPrefs.finishId).toBe('cosmic-orange')
    expect(nextPrefs.autoMatch).toBe(true)
    expect(resolveMatchedProfileId(nextDevice)).toBe('iphone-16')
  })

  it('auto-matches recognized bridge iPhone hardware models and clears cleanly on bridge disconnect', () => {
    const stalePrefs: PhoneAppearancePrefs = {
      profileId: 'iphone-16',
      finishId: 'natural',
      autoMatch: false,
    }
    const selection = selectPhoneProfile('iPhone18,1')
    const connected = resolveBridgeProfileUpdate(stalePrefs, emptyDevice(), selection)
    expect(connected.nextPrefs.profileId).toBe('iphone-17-pro')
    expect(connected.nextPrefs.autoMatch).toBe(true)
    expect(connected.nextPrefs.finishId).toBe('natural')
    expect(connected.nextDevice.detectedLabel).toBe('Connected · iPhone 17 Pro')
    expect(resolveMatchedProfileId(connected.nextDevice)).toBe('iphone-17-pro')

    // Disconnecting the bridge clears the active bridge badge cleanly
    const disconnected = resolveBridgeProfileUpdate(connected.nextPrefs, connected.nextDevice, null)
    expect(disconnected.nextDevice.detectedLabel).toBeNull()
    expect(disconnected.nextDevice.activeConnectionKey).toBeNull()

    // Null bridge status does not clear an active Web QR device state
    const webActive = resolveDetectedDeviceUpdate(
      stalePrefs,
      emptyDevice(),
      { platform: 'ios', screenWidth: 440, screenHeight: 956, dpr: 3 },
      { sourcePrefix: 'web' },
    )
    const afterBridgeNull = resolveBridgeProfileUpdate(webActive.nextPrefs, webActive.nextDevice, null)
    expect(afterBridgeNull.nextDevice.activeConnectionKey).toBe(webActive.nextDevice.activeConnectionKey)
  })
})
