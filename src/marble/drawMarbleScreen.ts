import { MARBLE_GEOMETRY as G, projectMarble } from '../../shared/marbleMath.mjs'
import type { WorldSnapshot } from '../../shared/worldProtocol.mjs'

export function drawMarbleScreen(c: CanvasRenderingContext2D, width: number, height: number, s: WorldSnapshot | null) {
  const g = s?.geometry ?? G, scale = width / g.width
  c.clearRect(0, 0, width, height)
  c.save(); c.beginPath(); c.roundRect(0, 0, width, height, g.cornerRadius * scale); c.clip()
  const background = c.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#293741'); background.addColorStop(0.55, '#1b2933'); background.addColorStop(1, '#111923')
  c.fillStyle = background; c.fillRect(0, 0, width, height)
  const glow = c.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height * 0.55)
  glow.addColorStop(0, 'rgba(96, 130, 137, 0.24)'); glow.addColorStop(1, 'rgba(96, 130, 137, 0)')
  c.fillStyle = glow; c.fillRect(0, 0, width, height)
  c.strokeStyle = 'rgba(182, 211, 209, 0.32)'; c.lineWidth = 1.5; c.setLineDash([4, 8])
  c.beginPath(); c.arc(width / 2, height / 2, width * 0.33, 0, Math.PI * 2); c.stroke()
  c.beginPath(); c.moveTo(width * 0.6, height / 2); c.lineTo(width - 5, height / 2); c.stroke()
  c.setLineDash([])
  c.strokeStyle = 'rgba(171, 209, 208, 0.62)'; c.lineWidth = 2
  const edge = 5, gap = g.exitHalfWidth / g.height * height
  c.beginPath(); c.moveTo(width - edge, height / 2 - gap); c.lineTo(width - edge, edge)
  c.lineTo(edge, edge); c.lineTo(edge, height - edge); c.lineTo(width - edge, height - edge)
  c.lineTo(width - edge, height / 2 + gap); c.stroke()
  c.fillStyle = '#a9d5d2'; c.font = '600 13px system-ui'; c.textAlign = 'right'; c.fillText('→', width - 13, height / 2 + 5)
  const ball = s?.balls.find((b) => b.id === s.activeBallId)
  if (ball && s?.phone) {
    const p = projectMarble(ball, s.phone, g), x = p.u * width, y = p.v * height, r = p.radius * scale
    if (r > 0) {
      c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip()
      const fullRadius = ball.radius * scale
      const gradient = c.createRadialGradient(x - fullRadius * 0.3, y - fullRadius * 0.35, fullRadius * 0.05, x, y, fullRadius)
      gradient.addColorStop(0, '#d5ffc0'); gradient.addColorStop(0.45, '#a4df83'); gradient.addColorStop(1, '#438c62')
      c.fillStyle = gradient; c.fillRect(x - fullRadius, y - fullRadius, fullRadius * 2, fullRadius * 2)
      if (p.marker[2] > 0) {
        c.fillStyle = '#264b39'; c.beginPath()
        c.ellipse(x + p.marker[0] * fullRadius * 0.95, y - p.marker[1] * fullRadius * 0.95,
          fullRadius * 0.13, fullRadius * 0.13 * Math.max(0.12, p.marker[2]), 0, 0, Math.PI * 2); c.fill()
      }
      c.restore()
    }
  }
  c.restore()
}
