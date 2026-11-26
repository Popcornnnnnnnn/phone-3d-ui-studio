import type { Transform } from './spatialMath.mjs'
import type { Quat } from './spatialProtocol.mjs'
import type { MarbleGeometry } from './marbleMath.mjs'
import type { PhoneFinishId, PhoneProfileId } from './phoneGeometry.mjs'
import type { WorldBall } from './worldProtocol.mjs'

export type WebPlayRole = 'desktop' | 'phone'
export type WebPlayMode = 'marble' | 'showcase'

export interface WebPoseMessage {
  type: 'web-pose'
  seq: number
  sentAtMs: number
  quaternion: Quat
  flickStrength?: number
}

export interface WebActionMessage {
  type: 'web-action'
  action: 'toss' | 'add-ball' | 'recenter'
  strength?: number
}

export interface WebUiEventMessage {
  type: 'web-ui-event'
  screenId: string
  control: string
  value?: string | number | boolean
}

export interface WebDeviceMessage {
  type: 'web-device'
  platform: 'ios' | 'android' | 'other'
  screenWidth: number
  screenHeight: number
  dpr: number
  modelHint?: string
  preferredProfileId?: PhoneProfileId
  preferredFinishId?: PhoneFinishId
}

export interface WebWorldSnapshot {
  type: 'web-world'
  seq: number
  phone: Transform
  balls: WorldBall[]
  activeBallId: string | null
  hitCount: number
  lastImpact: { sequence: number; ballId: string; atMs: number } | null
  canAddBall: boolean
  region: 'tray' | 'air' | 'needs-ball'
  geometry: MarbleGeometry
  mode: WebPlayMode
  activeScreenId: string
}

export type WebPlayGameMessage =
  | WebPoseMessage
  | WebActionMessage
  | WebUiEventMessage
  | WebDeviceMessage
  | WebWorldSnapshot

export type WebPlaySignalMessage =
  | { type: 'room-joined'; roomCode: string; role: WebPlayRole; peerConnected: boolean }
  | { type: 'peer-joined'; role: WebPlayRole }
  | { type: 'peer-left'; role: WebPlayRole }
  | { type: 'rtc-offer'; sdp: string }
  | { type: 'rtc-answer'; sdp: string }
  | { type: 'rtc-ice'; candidate: RTCIceCandidateInit }
  | { type: 'ping'; atMs: number }
  | { type: 'pong'; atMs: number }
  | { type: 'room-error'; code: string; message: string }

export const ROOM_CODE_ALPHABET: string
export function generateRoomCode(): string
export function normalizeRoomCode(raw: string): string | null
export function formatRoomCode(code: string): string
export function parseWebPlayMessage(value: unknown): WebPlayGameMessage | WebPlaySignalMessage | null
