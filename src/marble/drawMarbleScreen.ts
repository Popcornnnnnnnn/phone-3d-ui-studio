import { MARBLE_GEOMETRY as G, projectMarble } from '../../shared/marbleMath.mjs'
import type { WorldSnapshot } from '../../shared/worldProtocol.mjs'

export interface DrawMarbleScreenOptions {
  /** 'surface' draws a 3D-aligned contact shadow/glow under the WebGL sphere; '2d' renders a standalone 2D marble. */
  mode?: 'surface' | '2d'
  /** Rendered OLED screen width in world meters (for exact 3D overlay alignment). */
  displayWidthMeters?: number
  /** Rendered OLED screen height in world meters (for exact 3D overlay alignment). */
  displayHeightMeters?: number
}

export function drawMarbleScreen(
  c: CanvasRenderingContext2D,
  width: number,
  height: number,
  s: WorldSnapshot | null,
  options: DrawMarbleScreenOptions = {},
) {
  const mode = options.mode ?? '2d'
  const g = s?.geometry ?? G
  const surfaceW = options.displayWidthMeters ?? g.width
  const surfaceH = options.displayHeightMeters ?? g.height
  const scaleX = width / surfaceW
  const scaleY = height / surfaceH
  const scale = (scaleX + scaleY) * 0.5
  const cornerRatio = Math.min(0.22, Math.max(0.08, g.cornerRadius / Math.min(g.width, g.height)))
  const outerRadius = Math.max(12, Math.min(width, height) * cornerRatio)

  c.clearRect(0, 0, width, height)
  c.save()
  c.beginPath()
  c.roundRect(0, 0, width, height, outerRadius)
  c.clip()

  // Deep OLED studio gradient backdrop with subtle edge separation against black bezel
  const bg = c.createLinearGradient(0, 0, width * 0.35, height)
  bg.addColorStop(0, '#0d131d')
  bg.addColorStop(0.55, '#080c13')
  bg.addColorStop(1, '#05070c')
  c.fillStyle = bg
  c.fillRect(0, 0, width, height)

  // Subtle ambient center glow
  const glow = c.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height * 0.48)
  glow.addColorStop(0, 'rgba(75, 232, 157, 0.12)')
  glow.addColorStop(0.5, 'rgba(56, 132, 184, 0.05)')
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  c.fillStyle = glow
  c.fillRect(0, 0, width, height)

  // Hairline outer OLED perimeter reflection so the active screen separates cleanly from the 1.1mm bezel
  c.strokeStyle = 'rgba(165, 198, 240, 0.09)'
  c.lineWidth = 1
  c.beginPath()
  c.roundRect(0.5, 0.5, width - 1, height - 1, Math.max(1, outerRadius - 0.5))
  c.stroke()

  // Precision concentric reticle & fine crosshairs
  const cx = width / 2
  const cy = height / 2
  const inset = Math.max(3, width * 0.008)
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
  c.lineTo(width - inset - 18, cy)
  c.stroke()
  c.setLineDash([])

  // Rounded inner tray rail hugging the OLED perimeter with open right exit gate
  const innerRadius = Math.max(8, outerRadius - inset)
  const gap = (g.exitHalfWidth / surfaceH) * height

  c.save()
  c.beginPath()
  c.rect(0, 0, width, cy - gap)
  c.rect(0, cy + gap, width, height - (cy + gap))
  c.rect(0, cy - gap, width - inset * 2, gap * 2)
  c.clip()

  c.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  c.lineWidth = 1.4
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
  const hudY = Math.round(height * 0.122)
  c.textAlign = 'center'
  c.fillStyle = 'rgba(244, 245, 248, 0.92)'
  c.font = `600 ${Math.round(width * 0.082)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
  c.fillText(String(hits).padStart(2, '0'), cx, hudY)

  c.fillStyle = s?.canAddBall ? '#7df2b8' : 'rgba(154, 161, 176, 0.85)'
  c.font = `600 ${Math.round(width * 0.028)}px ui-monospace, SFMono-Regular, Menlo, monospace`
  c.fillText(statusLabel, cx, hudY + Math.round(width * 0.048))

  const ball = s?.balls.find((b) => b.id === s.activeBallId)
  if (ball && s?.phone) {
    const p = projectMarble(ball, s.phone, g)
    const x = (0.5 + p.local[0] / surfaceW) * width
    const y = (0.5 - p.local[1] / surfaceH) * height
    const fullRadius = (ball.radius ?? g.radius) * scale
    const r = p.radius * scale

    if (mode === 'surface') {
      const aboveTray =
        p.depth > -g.radius * 1.05 &&
        p.depth < 0.16 &&
        Math.abs(p.local[0]) <= surfaceW * 0.65 &&
        Math.abs(p.local[1]) <= surfaceH * 0.65

      if (aboveTray && fullRadius > 0) {
        const airHeight = Math.max(0, p.depth)
        const proximity = Math.max(0, 1 - airHeight / 0.14)

        // Centered ambient-occlusion contact shadow beneath the 3D sphere
        const shadowRadius = fullRadius * (1.42 + airHeight * 12)
        const peakAo = 0.74 * proximity * proximity
        const ao = c.createRadialGradient(x, y, fullRadius * 0.15, x, y, shadowRadius)
        ao.addColorStop(0, `rgba(0, 0, 0, ${peakAo.toFixed(3)})`)
        ao.addColorStop(0.58, `rgba(0, 0, 0, ${(peakAo * 0.56).toFixed(3)})`)
        ao.addColorStop(0.82, `rgba(0, 0, 0, ${(peakAo * 0.18).toFixed(3)})`)
        ao.addColorStop(1, 'rgba(0, 0, 0, 0)')
        c.fillStyle = ao
        c.beginPath()
        c.arc(x, y, shadowRadius, 0, Math.PI * 2)
        c.fill()

        // Subtle emerald caustic glow on dark OLED glass when close to the screen
        if (proximity > 0.2) {
          const causticRadius = fullRadius * 1.68
          const causticAlpha = 0.15 * Math.pow(proximity, 3)
          const caustic = c.createRadialGradient(x, y, fullRadius * 0.62, x, y, causticRadius)
          caustic.addColorStop(0, `rgba(40, 212, 148, ${causticAlpha.toFixed(3)})`)
          caustic.addColorStop(0.55, `rgba(26, 168, 114, ${(causticAlpha * 0.45).toFixed(3)})`)
          caustic.addColorStop(1, 'rgba(26, 168, 114, 0)')
          c.fillStyle = caustic
          c.beginPath()
          c.arc(x, y, causticRadius, 0, Math.PI * 2)
          c.fill()
        }

        // Recessed slot interior strictly inside the 3D sphere equator (never extends past the 3D edge)
        if (r > 1 && p.depth <= 0.0005) {
          const insetRadius = r * 0.96
          const well = c.createRadialGradient(
            x - insetRadius * 0.2,
            y - insetRadius * 0.2,
            insetRadius * 0.08,
            x,
            y,
            insetRadius,
          )
          well.addColorStop(0, '#0d543a')
          well.addColorStop(0.65, '#072e20')
          well.addColorStop(1, '#03170f')
          c.fillStyle = well
          c.beginPath()
          c.arc(x, y, insetRadius, 0, Math.PI * 2)
          c.fill()
        }
      }
    } else if (r > 0) {
      // Paired 2D mobile controller marble
      const shadowRadius = r * 1.32
      const ao = c.createRadialGradient(x, y + r * 0.08, r * 0.2, x, y + r * 0.08, shadowRadius)
      ao.addColorStop(0, 'rgba(0, 0, 0, 0.52)')
      ao.addColorStop(0.7, 'rgba(0, 0, 0, 0.22)')
      ao.addColorStop(1, 'rgba(0, 0, 0, 0)')
      c.fillStyle = ao
      c.beginPath()
      c.arc(x, y + r * 0.08, shadowRadius, 0, Math.PI * 2)
      c.fill()

      c.save()
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.clip()

      const body = c.createRadialGradient(
        x - fullRadius * 0.26,
        y - fullRadius * 0.28,
        fullRadius * 0.08,
        x,
        y,
        fullRadius,
      )
      body.addColorStop(0, '#2ab882')
      body.addColorStop(0.42, '#137e55')
      body.addColorStop(0.78, '#08422c')
      body.addColorStop(1, '#041f14')
      c.fillStyle = body
      c.fillRect(x - fullRadius, y - fullRadius, fullRadius * 2, fullRadius * 2)

      // Soft internal seafoam cat's-eye ribbon reflecting spin without an opaque dot
      if (p.marker[2] > -0.25) {
        const mx = x + p.marker[0] * fullRadius * 0.62
        const my = y - p.marker[1] * fullRadius * 0.62
        const swirlR = fullRadius * 0.56
        const swirlAlpha = 0.55 * Math.max(0.15, (p.marker[2] + 0.25) / 1.25)
        const swirl = c.createRadialGradient(mx, my, swirlR * 0.08, mx, my, swirlR)
        swirl.addColorStop(0, `rgba(167, 243, 208, ${swirlAlpha.toFixed(3)})`)
        swirl.addColorStop(0.45, `rgba(74, 218, 162, ${(swirlAlpha * 0.55).toFixed(3)})`)
        swirl.addColorStop(1, 'rgba(20, 130, 88, 0)')
        c.fillStyle = swirl
        c.beginPath()
        c.arc(mx, my, swirlR, 0, Math.PI * 2)
        c.fill()
      }

      // Clean specular glass highlight
      const specX = x - fullRadius * 0.34
      const specY = y - fullRadius * 0.36
      const spec = c.createRadialGradient(specX, specY, 0, specX, specY, fullRadius * 0.42)
      spec.addColorStop(0, 'rgba(236, 253, 245, 0.72)')
      spec.addColorStop(0.4, 'rgba(209, 250, 229, 0.24)')
      spec.addColorStop(1, 'rgba(209, 250, 229, 0)')
      c.fillStyle = spec
      c.beginPath()
      c.arc(specX, specY, fullRadius * 0.42, 0, Math.PI * 2)
      c.fill()
      c.restore()
    }
  }
  c.restore()
}
