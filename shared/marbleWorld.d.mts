import type { Transform } from './spatialMath.mjs'
import type { MarbleGeometry } from './marbleMath.mjs'
import type { MarbleSettings } from './marbleSettings.mjs'
import type { PhoneProfile } from './phoneGeometry.mjs'
import type { WorldBall } from './worldProtocol.mjs'

export const PHYSICS_DT: number
export function initMarblePhysics(): Promise<void>
export function isTrayUp(phone: Transform): boolean

export interface MarbleWorldImpact {
  sequence: number
  ballId: string
  atMs: number
}

export interface MarbleWorldSnapshot {
  phone: Transform
  balls: WorldBall[]
  activeBallId: string | null
  hitCount: number
  lastImpact: MarbleWorldImpact | null
  region: 'tray' | 'air' | 'needs-ball'
  canAddBall: boolean
}

export class MarbleWorld {
  settings: MarbleSettings
  geometry: MarbleGeometry
  phone: Transform
  target: Transform
  activeBallId: string | null
  hitCount: number
  lastImpact: MarbleWorldImpact | null
  steps: number
  region: 'tray' | 'air' | 'needs-ball'
  lastOutcome: string
  readonly canAddBall: boolean
  constructor(phone: Transform, settings?: MarbleSettings, profile?: PhoneProfile)
  setPhoneTarget(phone: Transform): void
  addBall(): boolean
  step(atMs?: number): void
  snapshot(): MarbleWorldSnapshot
  free(): void
}
