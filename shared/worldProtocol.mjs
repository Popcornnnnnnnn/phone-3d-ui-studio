export const WORLD_VERSION = 2
export const WORLD_PHASES = new Set(['waiting', 'ready', 'running', 'paused', 'unsupported'])
const tuple = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const pose = (p) => p && tuple(p.position, 3) && tuple(p.quaternion, 4) && Math.abs(Math.hypot(...p.quaternion) - 1) < 0.01
const id = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128
export function parseWorldCommand(v) {
  if (!v || v.type !== 'world-command' || v.protocolVersion !== WORLD_VERSION || !id(v.commandId) || !id(v.worldId) ||
    !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !['start', 'add-ball', 'pause', 'stop'].includes(v.action)) return null
  return { type: v.type, protocolVersion: WORLD_VERSION, commandId: v.commandId, worldId: v.worldId, epoch: v.epoch, action: v.action }
}
export function parseWorldSnapshot(v) {
  if (!v || v.type !== 'world-snapshot' || v.protocolVersion !== WORLD_VERSION || !id(v.worldId) ||
    !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !Number.isSafeInteger(v.sequence) || v.sequence < 0 ||
    !Number.isFinite(v.serverTimeMs) || !WORLD_PHASES.has(v.phase) || typeof v.reason !== 'string' || v.reason.length > 512 ||
    ![null, 'arkit', 'fixture'].includes(v.source) || !(v.ownerId === null || id(v.ownerId)) ||
    !(v.phoneSessionId === null || id(v.phoneSessionId)) || !(v.phoneConnectionId === null || id(v.phoneConnectionId)) ||
    typeof v.canStart !== 'boolean' || typeof v.canAddBall !== 'boolean' || typeof v.active !== 'boolean' ||
    !Number.isSafeInteger(v.hitCount) || v.hitCount < 0 || !['tray', 'air', 'needs-ball'].includes(v.region)) return null
  const g = v.geometry
  if (!g || !['width', 'height', 'screenZ', 'cornerRadius', 'radius', 'exitHalfWidth', 'wallHeight', 'interpolationMs', 'gravity'].every((key) => Number.isFinite(g[key])) ||
    g.width <= 0 || g.height <= 0 || g.radius <= 0 || g.radius >= 0.1 || g.width >= 1 || g.height >= 1 || g.interpolationMs !== 50 ||
    g.cornerRadius <= 0 || g.cornerRadius > Math.min(g.width, g.height) / 2 || g.exitHalfWidth <= 0 || g.exitHalfWidth >= g.height / 2 || g.wallHeight <= 0 || g.gravity <= 0) return null
  if (v.phone !== null && !pose(v.phone)) return null
  if (!Array.isArray(v.balls) || v.balls.length > 5 || v.balls.some((b) => !pose(b) || !id(b.id) || b.radius !== g.radius ||
    !['active', 'settling', 'rested'].includes(b.state) || !tuple(b.velocity, 3) || !tuple(b.angularVelocity, 3))) return null
  if (new Set(v.balls.map((b) => b.id)).size !== v.balls.length) return null
  const activeBalls = v.balls.filter((b) => b.state === 'active')
  if (v.activeBallId === null ? activeBalls.length !== 0 : !id(v.activeBallId) || activeBalls.length !== 1 || activeBalls[0].id !== v.activeBallId) return null
  if ((v.region === 'needs-ball') !== (v.activeBallId === null) || (v.canAddBall && v.activeBallId !== null)) return null
  const impact = v.lastImpact
  if (impact !== null && (!impact || !id(impact.ballId) || !Number.isSafeInteger(impact.sequence) || impact.sequence < 1 || impact.sequence !== v.hitCount || !Number.isFinite(impact.atMs))) return null
  if (v.hitCount > 0 && impact === null) return null
  if (v.phase === 'running' && (!v.phone || !v.active)) return null
  return v
}
