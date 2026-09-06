import type { Transform } from './spatialMath.mjs'
import type { Vec3 } from './spatialProtocol.mjs'
import type { MarbleGeometry } from './marbleMath.mjs'
export const WORLD_VERSION: 2
export type WorldPhase = 'waiting' | 'ready' | 'running' | 'paused' | 'unsupported'
export type WorldAction = 'start' | 'add-ball' | 'pause' | 'stop'
export interface WorldCommand {type:'world-command';protocolVersion:2;commandId:string;worldId:string;epoch:number;action:WorldAction}
export interface WorldBall extends Transform {id:string;radius:number;state:'active'|'settling'|'rested';velocity:Vec3;angularVelocity:Vec3}
export interface WorldSnapshot {
 type:'world-snapshot';protocolVersion:2;worldId:string;epoch:number;sequence:number;serverTimeMs:number;
 phase:WorldPhase;reason:string;ownerId:string|null;phoneSessionId:string|null;phoneConnectionId:string|null;
 source:'arkit'|'fixture'|null;canStart:boolean;canAddBall:boolean;active:boolean;hitCount:number;
 region:'tray'|'air'|'needs-ball';geometry:MarbleGeometry;phone:Transform|null;
 balls:WorldBall[];activeBallId:string|null;lastImpact:{sequence:number;ballId:string;atMs:number}|null;
}
export const WORLD_PHASES: Set<WorldPhase>
export function parseWorldCommand(value:unknown): WorldCommand|null
export function parseWorldSnapshot(value:unknown): WorldSnapshot|null
