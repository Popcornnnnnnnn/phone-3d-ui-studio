import { MARBLE_GEOMETRY as G, projectMarble } from '../../shared/marbleMath.mjs'
import type { WorldSnapshot } from '../../shared/worldProtocol.mjs'

export function drawMarbleScreen(c: CanvasRenderingContext2D, width: number, height: number, s: WorldSnapshot | null) {
  const g = s?.geometry ?? G
  const scale = width / g.width
  const outerRadius = Math.min(width, height) * 0.168

  c.clearRect(0, 0, width, height)
  c.save()
  c.beginPath()
  c.roundRect(0, 0, width, height, outerRadius)
  c.clip()

  // Deep OLED studio gradient backdrop
  const bg = c.createLinearGradient(0, 0, width * 0.35, height)
  bg.addColorStop(0, '#090d14')
  bg.addColorStop(0.55, '#06080d')
  bg.addColorStop(1, '#040508')
  c.fillStyle = bg
  c.fillRect(0, 0, width, height)

  // Subtle ambient center glow
  const glow = c.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height * 0.48)
  glow.addColorStop(0, 'rgba(75, 232, 157, 0.12)')
  glow.addColorStop(0.5, 'rgba(56, 132, 184, 0.05)')
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  c.fillStyle = glow
  c.fillRect(0, 0, width, height)

  // Precision concentric reticle & fine crosshairs
  const cx = width / 2
  const cy = height / 2
  c.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  c.lineWidth = 1
  c.beginPath()
  c.arc(cx, cy, width * 0.32, 0, Math.PI * 2)
  c.stroke()
  c.beginPath()
  c.arc(cx, cy, width * 0.16, 0, Math.PI * 2)
  c.stroke()

  c.strokeStyle = 'rgba(255, 255, 255, 0.045)'
  c.setLineDash([3, 7])
  c.beginPath()
  c.moveTo(cx, cy - width * 0.38)
  c.lineTo(cx, cy + width * 0.38)
  c.moveTo(cx - width * 0.38, cy)
  c.lineTo(width - 10, cy)
  c.stroke()
  c.setLineDash([])

  // Rounded inner tray rail with open right exit gate
  const inset = Math.max(8, width * 0.025)
  const innerRadius = Math.max(12, outerRadius - inset * 0.9)
  const gap = (g.exitHalfWidth / g.height) * height

  c.save()
  c.beginPath()
  c.rect(0, 0, width, cy - gap)
  c.rect(0, cy + gap, width, height - (cy + gap))
  c.rect(0, cy - gap, width - inset * 2, gap * 2)
  c.clip()

  c.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  c.lineWidth = 1.75
  c.beginPath()
  c.roundRect(inset, inset, width - inset * 2, height - inset * 2, innerRadius)
  c.stroke()
  c.restore()

  // Glowing exit gate accent & crisp chevron indicator
  const portalGlow = c.createRadialGradient(width - inset, cy, 2, width - inset, cy, gap * 1.15)
  portalGlow.addColorStop(0, 'rgba(75, 232, 157, 0.38)')
  portalGlow.addColorStop(1, 'rgba(75, 232, 157, 0)')
  c.fillStyle = portalGlow
  c.fillRect(width - inset * 6, cy - gap * 1.2, inset * 6, gap * 2.4)

  c.strokeStyle = '#6cf0b0'
  c.lineWidth = 2.2
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(width - inset, cy - gap - 6)
  c.lineTo(width - inset, cy - gap)
  c.moveTo(width - inset, cy + gap)
  c.lineTo(width - inset, cy + gap + 6)
  c.stroke()

  // Exit arrow chevron inside gate
  c.beginPath()
  c.moveTo(width - inset - 16, cy - 5)
  c.lineTo(width - inset - 10, cy)
  c.lineTo(width - inset - 16, cy + 5)
  c.stroke()

  // Clean OLED top telemetry bar below Dynamic Island
  const hits = s?.hitCount ?? 0
  const statusLabel = s?.canAddBall
    ? 'ADD BALL'
    : s?.region === 'air'
      ? 'AIRBORNE'
      : 'READY'
  const hudY = Math.round(height * 0.115)
  c.textAlign = 'center'
  c.fillStyle = 'rgba(244, 245, 248, 0.92)'
  c.font = `600 ${Math.round(width * 0.082)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
  c.fillText(String(hits).padStart(2, '0'), cx, hudY)

  c.fillStyle = s?.canAddBall ? '#7df2b8' : 'rgba(154, 161, 176, 0.85)'
  c.font = `600 ${Math.round(width * 0.028)}px ui-monospace, SFMono-Regular, Menlo, monospace`
  c.fillText(statusLabel, cx, hudY + Math.round(width * 0.048))

  // Glossy projected marble when rendered inside 2D view
  const ball = s?.balls.find((b) => b.id === s.activeBallId)
  if (ball && s?.phone) {
    const p = projectMarble(ball, s.phone, g)
    const x = p.u * width
    const y = p.v * height
    const r = p.radius * scale
    if (r > 0) {
      // Soft ambient drop shadow
      c.save()
      c.fillStyle = 'rgba(0, 0, 0, 0.48)'
      c.beginPath()
      c.arc(x + 2, y + 3, r * 1.08, 0, Math.PI * 2)
      c.fill()
      c.restore()

      c.save()
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.clip()
      const fullRadius = ball.radius * scale
      const gradient = c.createRadialGradient(
        x - fullRadius * 0.34,
        y - fullRadius * 0.36,
        fullRadius * 0.04,
        x,
        y,
        fullRadius,
      )
      gradient.addColorStop(0, '#eefff6')
      gradient.addColorStop(0.28, '#7af0b3')
      gradient.addColorStop(0.7, '#27a368')
      gradient.addColorStop(1, '#0c3623')
      c.fillStyle = gradient
      c.fillRect(x - fullRadius, y - fullRadius, fullRadius * 2, fullRadius * 2)
      if (p.marker[2] > 0) {
        c.fillStyle = '#072215'
        c.beginPath()
        c.ellipse(
          x + p.marker[0] * fullRadius * 0.95,
          y - p.marker[1] * fullRadius * 0.95,
          fullRadius * 0.13,
          fullRadius * 0.13 * Math.max(0.12, p.marker[2]),
          0,
          0,
          Math.PI * 2,
        )
        c.fill()
      }
      c.restore()
    }
  }
  c.restore()
}
