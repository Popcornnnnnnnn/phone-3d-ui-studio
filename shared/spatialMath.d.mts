import { Quaternion, Vector3 } from 'three'
import type { SpatialPose, Vec3, Quat } from './spatialProtocol.mjs'
export interface Transform { position: Vec3; quaternion: Quat }
export interface Calibration { origin: Vector3; yaw: Quaternion }
export const SPATIAL_MODEL_SCALE: number
export const SPATIAL_START: Vec3
export const CAMERA_IN_BODY: Vec3
export const CAMERA_FROM_BODY: Quaternion
export function cameraToBody(sample: Pick<SpatialPose, 'positionMeters' | 'quaternion'>): Transform
export function makeCalibration(body: Transform): Calibration | null
export function applyCalibration(body: Transform, calibration: Calibration): Transform
