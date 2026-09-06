import type { Transform } from './spatialMath.mjs'
import type { Vec3 } from './spatialProtocol.mjs'
import type { WorldSnapshot } from './worldProtocol.mjs'
export interface MarbleGeometry { width: number; height: number; screenZ: number; cornerRadius: number; radius: number; exitHalfWidth: number; wallHeight: number; interpolationMs: number; gravity: number }
export const MARBLE_GEOMETRY: Readonly<MarbleGeometry>
export function insideScreen(x: number, y: number, g?: MarbleGeometry): boolean
export function localToWorld(point: Vec3, phone: Transform): Vec3
export function worldToLocal(point: Vec3, phone: Transform): Vec3
export function projectMarble(ball: Transform & {radius?: number}, phone: Transform, g?: MarbleGeometry): {local: Vec3; depth: number; radius: number; marker: Vec3; u: number; v: number}
export function interpolateTransform(a: Transform, b: Transform, t: number): Transform
export function interpolateSnapshot(a: WorldSnapshot | undefined, b: WorldSnapshot, time: number): WorldSnapshot
