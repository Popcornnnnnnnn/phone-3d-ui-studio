import type { Transform } from './spatialMath.mjs'
import type { Vec3 } from './spatialProtocol.mjs'
import type { MarbleGeometry } from './marbleMath.mjs'
export const WORLD_VERSION: 1
export type WorldPhase = 'waiting' | 'ready' | 'running' | 'paused' | 'lost' | 'unsupported'
export type WorldAction = 'start' | 'reset' | 'return' | 'pause' | 'stop'
export interface WorldCommand {type:'world-command';protocolVersion:1;commandId:string;worldId:string;epoch:number;action:WorldAction}
export interface WorldSnapshot {
 type:'world-snapshot';protocolVersion:1;worldId:string;epoch:number;sequence:number;serverTimeMs:number;
 phase:WorldPhase;reason:string;ownerId:string|null;phoneSessionId:string|null;phoneConnectionId:string|null;
 source:'arkit'|'fixture'|null;canStart:boolean;canReturn:boolean;active:boolean;catchCount:number;
 region:'phone'|'world'|'returning';catchTarget:Vec3;geometry:MarbleGeometry;
 phone:Transform|null;ball:(Transform & {id:'marble-1';radius:number;velocity:Vec3;angularVelocity:Vec3})|null;
}
export const WORLD_PHASES: Set<WorldPhase>
export function parseWorldCommand(value:unknown): WorldCommand|null
export function parseWorldSnapshot(value:unknown): WorldSnapshot|null
