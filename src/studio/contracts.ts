import type { Group, Texture } from 'three'

export type SourceState = 'idle' | 'connecting' | 'ready' | 'stale' | 'error'

export interface TimestampedFrame {
  timestampMs: number
  texture: Texture
}

export interface PoseSample {
  timestampMs: number
  quaternion: readonly [x: number, y: number, z: number, w: number]
}

export interface ScreenSource {
  readonly id: string
  readonly state: SourceState
  connect(): Promise<void>
  disconnect(): Promise<void>
  latestFrame(): TimestampedFrame | null
}

export interface PoseSource {
  readonly id: string
  readonly state: SourceState
  connect(): Promise<void>
  disconnect(): Promise<void>
  latestPose(): PoseSample | null
}

export interface PhoneAsset {
  readonly root: Group
  readonly screen: Group
  readonly nativeAspectRatio: number
}

export interface Recorder {
  readonly state: 'idle' | 'recording' | 'finalizing' | 'error'
  start(): Promise<void>
  stop(): Promise<Blob>
}
