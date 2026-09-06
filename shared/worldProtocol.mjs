export const WORLD_VERSION = 1
export const WORLD_PHASES = new Set(['waiting', 'ready', 'running', 'paused', 'lost', 'unsupported'])
const tuple = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const pose = (p) => p && tuple(p.position, 3) && tuple(p.quaternion, 4) && Math.abs(Math.hypot(...p.quaternion) - 1) < 0.01
const id = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128
export function parseWorldCommand(v) {
  if (!v || v.type !== 'world-command' || v.protocolVersion !== WORLD_VERSION || !id(v.commandId) || !id(v.worldId) ||
    !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !['start', 'reset', 'return', 'pause', 'stop'].includes(v.action)) return null
  return { type: v.type, protocolVersion: WORLD_VERSION, commandId: v.commandId, worldId: v.worldId, epoch: v.epoch, action: v.action }
}
export function parseWorldSnapshot(v) {
  if (!v || v.type !== 'world-snapshot' || v.protocolVersion !== WORLD_VERSION || !id(v.worldId) ||
    !Number.isSafeInteger(v.epoch) || v.epoch < 0 || !Number.isSafeInteger(v.sequence) || v.sequence < 0 ||
    !Number.isFinite(v.serverTimeMs) || !WORLD_PHASES.has(v.phase) || typeof v.reason !== 'string' || v.reason.length > 512 ||
    ![null, 'arkit', 'fixture'].includes(v.source) || !(v.ownerId === null || id(v.ownerId)) ||
    !(v.phoneSessionId === null || id(v.phoneSessionId)) || !(v.phoneConnectionId === null || id(v.phoneConnectionId)) ||
    typeof v.canStart !== 'boolean' || typeof v.canReturn !== 'boolean' || typeof v.active !== 'boolean' ||
    !Number.isSafeInteger(v.catchCount) || v.catchCount < 0 || !tuple(v.catchTarget, 3) ||
    !['phone', 'world', 'returning'].includes(v.region)) return null
  const g = v.geometry
  if (!g || !['width', 'height', 'screenZ', 'cornerRadius', 'radius', 'exitHalfWidth', 'wallHeight', 'interpolationMs', 'gravity'].every((key) => Number.isFinite(g[key])) ||
    g.width <= 0 || g.height <= 0 || g.radius <= 0 || g.radius > 0.1 || g.width > 1 || g.height > 1 || g.interpolationMs !== 50) return null
  if (v.phone !== null && !pose(v.phone)) return null
  if (v.ball !== null && (!pose(v.ball) || v.ball.id !== 'marble-1' || v.ball.radius !== g.radius || !tuple(v.ball.velocity, 3) || !tuple(v.ball.angularVelocity, 3))) return null
  if (['running', 'lost'].includes(v.phase) && (!v.phone || !v.ball)) return null
  return v
}
