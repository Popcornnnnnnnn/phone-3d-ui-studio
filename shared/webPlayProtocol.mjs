import { PHONE_FINISHES, PHONE_PROFILES } from './phoneGeometry.mjs'

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_REPLACED_CLOSE_CODE = 4001

export function generateRoomCode() {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]
  }
  return out
}

export function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length !== 6) return null
  for (const ch of cleaned) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

export function formatRoomCode(code) {
  const normalized = normalizeRoomCode(code)
  return normalized ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : code
}

const isTuple = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const isQuat = (q) => isTuple(q, 4) && Math.abs(Math.hypot(...q) - 1) < 0.05
const isTransform = (t) => !!t && typeof t === 'object' && isTuple(t.position, 3) && isQuat(t.quaternion)

export function parseWebPlayMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value
  switch (v.type) {
    case 'web-pose':
      if (!Number.isSafeInteger(v.seq) || v.seq < 0 || !Number.isFinite(v.sentAtMs) || !isQuat(v.quaternion)) return null
      if (v.flickStrength !== undefined && (!Number.isFinite(v.flickStrength) || v.flickStrength <= 0 || v.flickStrength > 3)) return null
      return {
        type: 'web-pose',
        seq: v.seq,
        sentAtMs: v.sentAtMs,
        quaternion: v.quaternion,
        ...(v.flickStrength !== undefined ? { flickStrength: v.flickStrength } : {}),
      }
    case 'web-action':
      if (!['toss', 'add-ball', 'recenter'].includes(v.action)) return null
      if (v.strength !== undefined && (!Number.isFinite(v.strength) || v.strength <= 0 || v.strength > 3)) return null
      return {
        type: 'web-action',
        action: v.action,
        ...(v.strength !== undefined ? { strength: v.strength } : {}),
      }
    case 'web-ui-event':
      if (typeof v.screenId !== 'string' || !v.screenId || v.screenId.length > 64) return null
      if (typeof v.control !== 'string' || !v.control || v.control.length > 64) return null
      if (v.value !== undefined && !['string', 'number', 'boolean'].includes(typeof v.value)) return null
      return {
        type: 'web-ui-event',
        screenId: v.screenId,
        control: v.control,
        ...(v.value !== undefined ? { value: v.value } : {}),
      }
    case 'web-device': {
      if (!['ios', 'android', 'other'].includes(v.platform)) return null
      if (!Number.isFinite(v.screenWidth) || v.screenWidth < 100 || v.screenWidth > 4000) return null
      if (!Number.isFinite(v.screenHeight) || v.screenHeight < 100 || v.screenHeight > 4000) return null
      if (!Number.isFinite(v.dpr) || v.dpr < 0.5 || v.dpr > 6) return null
      const out = {
        type: 'web-device',
        platform: v.platform,
        screenWidth: Math.round(v.screenWidth),
        screenHeight: Math.round(v.screenHeight),
        dpr: Math.round(v.dpr * 1000) / 1000,
      }
      if (typeof v.modelHint === 'string' && v.modelHint.trim()) {
        out.modelHint = v.modelHint.trim().slice(0, 64)
      }
      if (typeof v.preferredProfileId === 'string' && Object.hasOwn(PHONE_PROFILES, v.preferredProfileId)) {
        out.preferredProfileId = v.preferredProfileId
      }
      if (typeof v.preferredFinishId === 'string' && PHONE_FINISHES.some((f) => f.id === v.preferredFinishId)) {
        out.preferredFinishId = v.preferredFinishId
      }
      return out
    }
    case 'web-world':
      if (!Number.isSafeInteger(v.seq) || v.seq < 0 || !isTransform(v.phone) || !Array.isArray(v.balls) || v.balls.length > 5) return null
      if (typeof v.canAddBall !== 'boolean' || !Number.isSafeInteger(v.hitCount) || v.hitCount < 0) return null
      if (!['tray', 'air', 'needs-ball'].includes(v.region) || !['marble', 'showcase'].includes(v.mode)) return null
      if (typeof v.activeScreenId !== 'string' || !v.geometry || typeof v.geometry !== 'object') return null
      return v
    case 'room-joined':
      if (!normalizeRoomCode(v.roomCode) || !['desktop', 'phone'].includes(v.role) || typeof v.peerConnected !== 'boolean') return null
      return v
    case 'peer-joined':
    case 'peer-left':
      if (!['desktop', 'phone'].includes(v.role)) return null
      return v
    case 'rtc-offer':
    case 'rtc-answer':
      if (typeof v.sdp !== 'string' || v.sdp.length === 0 || v.sdp.length > 65536) return null
      return v
    case 'rtc-ice':
      if (!v.candidate || typeof v.candidate !== 'object') return null
      return v
    case 'ping':
    case 'pong':
      if (!Number.isFinite(v.atMs)) return null
      return v
    case 'room-error':
      if (typeof v.code !== 'string' || typeof v.message !== 'string') return null
      return v
    default:
      return null
  }
}
