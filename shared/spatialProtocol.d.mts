export const SPATIAL_STALE_MS: number
export type SpatialTrackingState = 'initializing' | 'normal' | 'limited' | 'unavailable' | 'paused' | 'denied' | 'unsupported' | 'error'
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export interface SpatialStatus {
  source: 'arkit' | 'fixture'
  type: 'spatial-status'
  sessionId: string
  sequence: number
  sampledAtMs: number
  trackingState: SpatialTrackingState
  reason: string
  clockOffsetMs: number | null
  clockRttMs: number | null
}
export interface SpatialPose extends Omit<SpatialStatus, 'type'> {
  type: 'spatial-pose'
  positionMeters: Vec3
  quaternion: Quat
}
export type SpatialMessage = SpatialPose | SpatialStatus
export const SPATIAL_STATES: Set<SpatialTrackingState>
export function parseSpatialMessage(value: unknown): SpatialMessage | null
