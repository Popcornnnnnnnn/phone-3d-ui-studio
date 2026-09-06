import { MARBLE_GEOMETRY as G, projectMarble } from '../../shared/marbleMath.mjs'
import type { WorldSnapshot } from '../../shared/worldProtocol.mjs'

export function drawMarbleScreen(c: CanvasRenderingContext2D, width: number, height: number, s: WorldSnapshot | null) {
  const g = s?.geometry ?? G, scale = width / g.width
  c.clearRect(0, 0, width, height); c.fillStyle = '#112c2b'; c.fillRect(0, 0, width, height)
  c.save(); c.beginPath(); c.roundRect(0, 0, width, height, g.cornerRadius * scale); c.clip()
  c.strokeStyle = '#4c7e69'; c.lineWidth = 2
  const edge = 5, gap = g.exitHalfWidth / g.height * height
  c.beginPath(); c.moveTo(width - edge, height / 2 - gap); c.lineTo(width - edge, edge)
  c.lineTo(edge, edge); c.lineTo(edge, height - edge); c.lineTo(width - edge, height - edge)
  c.lineTo(width - edge, height / 2 + gap); c.stroke()
  c.fillStyle = '#9ae4c1'; c.font = '600 13px system-ui'; c.textAlign = 'right'; c.fillText('→', width - 13, height / 2 + 5)
  if (s?.ball && s.phone) {
    const p = projectMarble(s.ball, s.phone, g), x = p.u * width, y = p.v * height, r = p.radius * scale
    if (r > 0) {
      c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip()
      const fullRadius = s.ball.radius * scale
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
