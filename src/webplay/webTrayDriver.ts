import { Euler, Quaternion } from 'three'
import { MarbleWorld, PHYSICS_DT, type MarbleWorldSnapshot } from '../../shared/marbleWorld.mjs'
import { DEFAULT_MARBLE_SETTINGS, type MarbleSettings } from '../../shared/marbleSettings.mjs'
import { DEFAULT_PHONE_PROFILE, type PhoneProfile } from '../../shared/phoneGeometry.mjs'
import { SPATIAL_START } from '../../shared/spatialMath.mjs'
import type { Quat } from '../../shared/spatialProtocol.mjs'

export interface WebPlaySettings extends MarbleSettings {
  flickPower: number
}

export const DEFAULT_WEB_PLAY_SETTINGS: WebPlaySettings = {
  ...DEFAULT_MARBLE_SETTINGS,
  flickPower: 1,
}

export const FLAT_PHONE_QUAT: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const MAX_TILT_RAD = (28 * Math.PI) / 180
const TOSS_UP_MS = 68
const TOSS_DOWN_MS = 120
const TOSS_BASE_AMPLITUDE_M = 0.021

interface TossEnvelope {
  startedAtMs: number
  amplitude: number
}

export interface WebTrayCallbacks {
  onCatch?: (hitCount: number) => void
  onDrop?: () => void
  onSpawn?: () => void
}

export class WebTrayDriver {
  private world: MarbleWorld
  private settings: WebPlaySettings
  private profile: PhoneProfile
  private currentQuat = new Quaternion(...FLAT_PHONE_QUAT)
  private targetQuat = new Quaternion(...FLAT_PHONE_QUAT)
  private accumulatorSec = 0
  private simTimeMs = 0
  private toss: TossEnvelope | null = null
  private lastImpactSeq = 0
  private hadActiveBall = true
  private callbacks: WebTrayCallbacks

  constructor(
    settings: Partial<WebPlaySettings> = {},
    callbacks: WebTrayCallbacks = {},
    profile: PhoneProfile = DEFAULT_PHONE_PROFILE,
  ) {
    this.settings = { ...DEFAULT_WEB_PLAY_SETTINGS, ...settings }
    this.callbacks = callbacks
    this.profile = profile
    this.world = new MarbleWorld(
      { position: [...SPATIAL_START], quaternion: [...FLAT_PHONE_QUAT] },
      {
        movementScale: this.settings.movementScale,
        ballDiameterMm: this.settings.ballDiameterMm,
        restitution: this.settings.restitution,
      },
      this.profile,
    )
    this.hadActiveBall = this.world.activeBallId !== null
  }

  getGeometry() {
    return this.world.geometry
  }

  getProfile(): PhoneProfile {
    return this.profile
  }

  getSettings(): WebPlaySettings {
    return { ...this.settings }
  }

  setProfile(nextProfile: PhoneProfile) {
    const prev = this.profile
    if (
      prev.id === nextProfile.id &&
      prev.bodyMm.width === nextProfile.bodyMm.width &&
      prev.bodyMm.height === nextProfile.bodyMm.height &&
      prev.bodyMm.depth === nextProfile.bodyMm.depth &&
      prev.displayMm.width === nextProfile.displayMm.width &&
      prev.displayMm.height === nextProfile.displayMm.height
    ) {
      return
    }
    this.profile = nextProfile
    this.restart()
  }

  setTargetQuaternion(q: Quat) {
    this.targetQuat.set(q[0], q[1], q[2], q[3]).normalize()
  }

  setTiltInput(tiltX: number, tiltY: number) {
    const cx = Math.max(-1, Math.min(1, tiltX))
    const cy = Math.max(-1, Math.min(1, tiltY))
    const flat = new Quaternion(...FLAT_PHONE_QUAT)
    const offset = new Quaternion().setFromEuler(
      new Euler(cy * MAX_TILT_RAD, cx * MAX_TILT_RAD, 0, 'YXZ'),
    )
    this.targetQuat.copy(flat).multiply(offset).normalize()
  }

  triggerToss(strength = 1) {
    const clamped = Math.max(0.4, Math.min(1.8, strength))
    this.toss = {
      startedAtMs: this.simTimeMs,
      amplitude: TOSS_BASE_AMPLITUDE_M * clamped * this.settings.flickPower,
    }
  }

  addBall(): boolean {
    const added = this.world.addBall()
    if (added) {
      this.hadActiveBall = true
      this.callbacks.onSpawn?.()
    }
    return added
  }

  restart(nextSettings?: Partial<WebPlaySettings>) {
    if (nextSettings) {
      this.settings = { ...this.settings, ...nextSettings }
    }
    this.world.free()
    this.currentQuat.set(...FLAT_PHONE_QUAT)
    this.targetQuat.set(...FLAT_PHONE_QUAT)
    this.accumulatorSec = 0
    this.simTimeMs = 0
    this.toss = null
    this.lastImpactSeq = 0
    this.world = new MarbleWorld(
      { position: [...SPATIAL_START], quaternion: [...FLAT_PHONE_QUAT] },
      {
        movementScale: this.settings.movementScale,
        ballDiameterMm: this.settings.ballDiameterMm,
        restitution: this.settings.restitution,
      },
      this.profile,
    )
    this.hadActiveBall = this.world.activeBallId !== null
  }

  private sampleTossOffsetY(atMs: number): number {
    if (!this.toss) return 0
    const elapsed = atMs - this.toss.startedAtMs
    if (elapsed < 0) return 0
    if (elapsed < TOSS_UP_MS) {
      return this.toss.amplitude * Math.sin((elapsed / TOSS_UP_MS) * (Math.PI / 2))
    }
    const downElapsed = elapsed - TOSS_UP_MS
    if (downElapsed < TOSS_DOWN_MS) {
      return this.toss.amplitude * ((1 + Math.cos((downElapsed / TOSS_DOWN_MS) * Math.PI)) / 2)
    }
    this.toss = null
    return 0
  }

  stepFrame(deltaSeconds: number): MarbleWorldSnapshot {
    const clamped = Math.max(0, Math.min(0.05, deltaSeconds))
    this.accumulatorSec += clamped
    const slerpAlpha = 1 - Math.exp(-PHYSICS_DT / 0.018)

    while (this.accumulatorSec >= PHYSICS_DT) {
      this.accumulatorSec -= PHYSICS_DT
      this.simTimeMs += PHYSICS_DT * 1000
      this.currentQuat.slerp(this.targetQuat, slerpAlpha).normalize()
      const dy = this.sampleTossOffsetY(this.simTimeMs)
      this.world.setPhoneTarget({
        position: [SPATIAL_START[0], SPATIAL_START[1] + dy, SPATIAL_START[2]],
        quaternion: this.currentQuat.toArray() as Quat,
      })
      this.world.step(this.simTimeMs)

      if (this.world.hitCount > this.lastImpactSeq) {
        this.lastImpactSeq = this.world.hitCount
        this.callbacks.onCatch?.(this.world.hitCount)
      }
      const hasActive = this.world.activeBallId !== null
      if (this.hadActiveBall && !hasActive) {
        this.callbacks.onDrop?.()
      }
      this.hadActiveBall = hasActive
    }

    return this.world.snapshot()
  }

  snapshot(): MarbleWorldSnapshot {
    return this.world.snapshot()
  }

  free() {
    this.world.free()
  }
}
