import { CanvasTexture, SRGBColorSpace } from 'three'
import type { TextureScreenMedia } from './screenMedia'

export type DemoScreenId = 'audio' | 'weather' | 'notifications'
export type WeatherCondition = 'sunny' | 'rain' | 'aurora'

export interface DemoScreenSpec {
  id: DemoScreenId
  label: string
  tagline: string
}

export const DEMO_SCREENS: readonly DemoScreenSpec[] = [
  { id: 'audio', label: 'Audio Deck', tagline: 'Tilting cover art & live frequency bars' },
  { id: 'weather', label: 'Weather Card', tagline: 'Parallax sky layers & live clock' },
  { id: 'notifications', label: 'Stack Cards', tagline: 'Interactive layered notifications' },
]

export const AUDIO_TRACKS = [
  { title: 'Midnight Glass', artist: 'Spatial Ensemble', accentA: '#22c55e', accentB: '#0ea5e9', bpm: 112 },
  { title: 'Tidal Drift', artist: 'Kuro & Echo', accentA: '#f59e0b', accentB: '#ef4444', bpm: 96 },
  { title: 'Neon Orbit', artist: 'Vector Nine', accentA: '#8b5cf6', accentB: '#ec4899', bpm: 124 },
] as const

export interface DemoScreenState {
  screenId: DemoScreenId
  playing: boolean
  trackIndex: number
  weather: WeatherCondition
  expandedCard: number
}

export const INITIAL_DEMO_STATE: DemoScreenState = {
  screenId: 'audio',
  playing: true,
  trackIndex: 0,
  weather: 'aurora',
  expandedCard: 0,
}

export function reduceDemoScreenState(
  state: DemoScreenState,
  control: string,
  value?: string | number | boolean,
): DemoScreenState {
  switch (control) {
    case 'select-screen':
      if (value === 'audio' || value === 'weather' || value === 'notifications') {
        return { ...state, screenId: value }
      }
      return state
    case 'toggle-play':
      return { ...state, playing: typeof value === 'boolean' ? value : !state.playing }
    case 'next-track':
      return { ...state, trackIndex: (state.trackIndex + 1) % AUDIO_TRACKS.length, playing: true }
    case 'prev-track':
      return { ...state, trackIndex: (state.trackIndex - 1 + AUDIO_TRACKS.length) % AUDIO_TRACKS.length, playing: true }
    case 'set-weather':
      if (value === 'sunny' || value === 'rain' || value === 'aurora') {
        return { ...state, weather: value }
      }
      return state
    case 'cycle-weather': {
      const order: WeatherCondition[] = ['aurora', 'sunny', 'rain']
      return { ...state, weather: order[(order.indexOf(state.weather) + 1) % order.length] }
    }
    case 'cycle-notification':
      return { ...state, expandedCard: (state.expandedCard + 1) % 3 }
    case 'select-notification':
      if (typeof value === 'number' && value >= 0 && value < 3) {
        return { ...state, expandedCard: Math.trunc(value) }
      }
      return state
    default:
      return state
  }
}

export class DemoScreenRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  readonly media: TextureScreenMedia
  private state: DemoScreenState = { ...INITIAL_DEMO_STATE }

  constructor(width = 585, height = 1266) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    const texture = new CanvasTexture(this.canvas)
    texture.colorSpace = SRGBColorSpace
    this.media = {
      kind: 'texture',
      name: 'Interactive 3D UI Demo',
      width,
      height,
      texture,
    }
    this.draw(0, { x: 0, y: 0 })
  }

  getState(): DemoScreenState {
    return { ...this.state }
  }

  handleControl(control: string, value?: string | number | boolean): DemoScreenState {
    this.state = reduceDemoScreenState(this.state, control, value)
    return this.getState()
  }

  draw(timeMs: number, tilt: { x: number; y: number }) {
    const c = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    c.save()
    c.clearRect(0, 0, w, h)

    if (this.state.screenId === 'audio') {
      this.drawAudioDeck(c, w, h, timeMs, tilt)
    } else if (this.state.screenId === 'weather') {
      this.drawWeatherCard(c, w, h, timeMs, tilt)
    } else {
      this.drawNotifications(c, w, h, timeMs, tilt)
    }

    this.drawStatusHeader(c, w)
    c.restore()
    this.media.texture.needsUpdate = true
  }

  private drawStatusHeader(c: CanvasRenderingContext2D, w: number) {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    c.fillStyle = 'rgba(255,255,255,0.88)'
    c.font = '600 22px -apple-system, BlinkMacSystemFont, sans-serif'
    c.textAlign = 'left'
    c.fillText(`${hh}:${mm}`, 44, 58)
    c.textAlign = 'right'
    c.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText('5G  100%', w - 44, 58)
  }

  private drawAudioDeck(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    tilt: { x: number; y: number },
  ) {
    const track = AUDIO_TRACKS[this.state.trackIndex]
    const bg = c.createLinearGradient(0, 0, w, h)
    bg.addColorStop(0, '#0f172a')
    bg.addColorStop(0.55, '#111827')
    bg.addColorStop(1, '#090d16')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)

    // Tilt-reactive ambient glow
    const gx = w * (0.5 + tilt.x * 0.25)
    const gy = h * (0.34 + tilt.y * 0.2)
    const glow = c.createRadialGradient(gx, gy, 10, gx, gy, w * 0.72)
    glow.addColorStop(0, `${track.accentA}55`)
    glow.addColorStop(0.5, `${track.accentB}22`)
    glow.addColorStop(1, 'transparent')
    c.fillStyle = glow
    c.fillRect(0, 0, w, h)

    // Floating album card
    const cardX = 52 + tilt.x * 16
    const cardY = 175 + tilt.y * 16
    const cardW = w - 104
    const cardH = cardW
    c.save()
    c.beginPath()
    c.roundRect(cardX, cardY, cardW, cardH, 36)
    c.clip()
    const art = c.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH)
    art.addColorStop(0, track.accentA)
    art.addColorStop(1, track.accentB)
    c.fillStyle = art
    c.fillRect(cardX, cardY, cardW, cardH)

    // Specular sheen driven by phone tilt
    const sheenX = cardX + cardW * (0.5 - tilt.x * 0.6)
    const sheenY = cardY + cardH * (0.35 - tilt.y * 0.6)
    const sheen = c.createRadialGradient(sheenX, sheenY, 10, sheenX, sheenY, cardW * 0.75)
    sheen.addColorStop(0, 'rgba(255,255,255,0.45)')
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.08)')
    sheen.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = sheen
    c.fillRect(cardX, cardY, cardW, cardH)

    // Vinyl center rings
    c.strokeStyle = 'rgba(255,255,255,0.28)'
    c.lineWidth = 3
    for (let r = 64; r <= 184; r += 40) {
      c.beginPath()
      c.arc(cardX + cardW / 2, cardY + cardH / 2, r, 0, Math.PI * 2)
      c.stroke()
    }
    c.restore()

    // Track metadata
    c.textAlign = 'left'
    c.fillStyle = '#f8fafc'
    c.font = '700 36px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText(track.title, 54, 735)
    c.fillStyle = 'rgba(248,250,252,0.68)'
    c.font = '500 24px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText(track.artist, 54, 775)

    // Animated frequency bars
    const barCount = 24
    const barsWidth = w - 108
    const barStep = barsWidth / barCount
    const phase = timeMs / 1000
    for (let i = 0; i < barCount; i++) {
      const wave = this.state.playing
        ? 0.25 + 0.75 * Math.abs(Math.sin(phase * (track.bpm / 24) + i * 0.45))
        : 0.14
      const barH = 12 + wave * 64
      c.fillStyle = i % 2 === 0 ? track.accentA : '#e2e8f0'
      c.beginPath()
      c.roundRect(54 + i * barStep, 895 - barH, barStep * 0.62, barH, 4)
      c.fill()
    }

    // Progress bar
    const progress = this.state.playing ? ((timeMs / 18000) % 1) : 0.38
    c.fillStyle = 'rgba(255,255,255,0.18)'
    c.beginPath()
    c.roundRect(54, 945, barsWidth, 8, 4)
    c.fill()
    c.fillStyle = '#ffffff'
    c.beginPath()
    c.roundRect(54, 945, Math.max(16, barsWidth * progress), 8, 4)
    c.fill()

    // Playback glyphs
    const cy = 1065
    c.fillStyle = 'rgba(255,255,255,0.88)'
    c.font = '600 34px -apple-system, BlinkMacSystemFont, sans-serif'
    c.textAlign = 'center'
    c.fillText('⏮', w * 0.26, cy + 12)
    c.fillText('⏭', w * 0.74, cy + 12)
    c.beginPath()
    c.arc(w / 2, cy, 48, 0, Math.PI * 2)
    c.fillStyle = '#ffffff'
    c.fill()
    c.fillStyle = '#0f172a'
    c.font = '700 32px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText(this.state.playing ? '❚❚' : '▶', w / 2 + (this.state.playing ? 0 : 3), cy + 11)
  }

  private drawWeatherCard(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    tilt: { x: number; y: number },
  ) {
    const cond = this.state.weather
    const palettes: Record<WeatherCondition, [string, string, string, string]> = {
      aurora: ['#071926', '#103b4a', '#26a67b', 'Aurora · 14°'],
      sunny: ['#1e5fa8', '#4fa3e3', '#fcd34d', 'Clear · 24°'],
      rain: ['#1f2937', '#334155', '#60a5fa', 'Light Rain · 17°'],
    }
    const [top, mid, accent, label] = palettes[cond]
    const bg = c.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, top)
    bg.addColorStop(0.62, mid)
    bg.addColorStop(1, '#0b1120')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)

    // Parallax atmospheric orb
    const ox = w * (0.62 + tilt.x * 0.18)
    const oy = h * (0.28 + tilt.y * 0.14)
    const orb = c.createRadialGradient(ox, oy, 12, ox, oy, 230)
    orb.addColorStop(0, accent)
    orb.addColorStop(1, 'transparent')
    c.fillStyle = orb
    c.fillRect(0, 0, w, h)

    // Animated rain / aurora streaks
    const t = timeMs / 1000
    c.strokeStyle = cond === 'rain' ? 'rgba(191,219,254,0.45)' : 'rgba(255,255,255,0.18)'
    c.lineWidth = cond === 'rain' ? 2.5 : 4
    for (let i = 0; i < 18; i++) {
      const rx = ((i * 73 + tilt.x * 35) % (w - 40)) + 20
      const ry = ((i * 117 + t * (cond === 'rain' ? 380 : 35)) % (h * 0.55)) + 90
      c.beginPath()
      c.moveTo(rx, ry)
      c.lineTo(rx - (cond === 'rain' ? 8 : -24), ry + (cond === 'rain' ? 28 : 10))
      c.stroke()
    }

    c.textAlign = 'center'
    c.fillStyle = '#ffffff'
    c.font = '300 108px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText(label.split('·')[1].trim(), w / 2 + tilt.x * 10, 295 + tilt.y * 10)
    c.font = '600 28px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillStyle = 'rgba(255,255,255,0.88)'
    c.fillText(`Shanghai · ${label.split('·')[0].trim()}`, w / 2, 355)

    // Forecast glass card
    const cx = 42 + tilt.x * 12
    const cy = 460 + tilt.y * 12
    c.fillStyle = 'rgba(255,255,255,0.14)'
    c.beginPath()
    c.roundRect(cx, cy, w - 84, 340, 30)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.22)'
    c.lineWidth = 1.5
    c.stroke()

    c.textAlign = 'left'
    c.fillStyle = 'rgba(255,255,255,0.75)'
    c.font = '600 18px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText('HOURLY OUTLOOK', cx + 30, cy + 48)

    const hours = ['Now', '14:00', '16:00', '18:00', '20:00']
    hours.forEach((hr, idx) => {
      const y = cy + 104 + idx * 52
      c.fillStyle = '#ffffff'
      c.font = '500 22px -apple-system, BlinkMacSystemFont, sans-serif'
      c.textAlign = 'left'
      c.fillText(hr, cx + 30, y)
      c.textAlign = 'right'
      c.fillText(`${15 + idx}°`, cx + w - 114, y)
    })

    // Bottom pill summary
    c.fillStyle = 'rgba(255,255,255,0.12)'
    c.beginPath()
    c.roundRect(42, 860, w - 84, 150, 28)
    c.fill()
    c.textAlign = 'left'
    c.fillStyle = '#ffffff'
    c.font = '600 22px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText('Tilt device for parallax depth', 74, 922)
    c.fillStyle = 'rgba(255,255,255,0.72)'
    c.font = '400 19px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText('Switch Sunny / Rain / Aurora from controls', 74, 962)
  }

  private drawNotifications(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    tilt: { x: number; y: number },
  ) {
    const bg = c.createLinearGradient(0, 0, w, h)
    bg.addColorStop(0, '#18181b')
    bg.addColorStop(0.5, '#27272a')
    bg.addColorStop(1, '#09090b')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)

    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 900)
    const aura = c.createRadialGradient(w * 0.5, 220, 20, w * 0.5, 220, 360)
    aura.addColorStop(0, `rgba(50, 120, 84, ${0.35 + pulse * 0.15})`)
    aura.addColorStop(1, 'transparent')
    c.fillStyle = aura
    c.fillRect(0, 0, w, h)

    c.textAlign = 'center'
    c.fillStyle = '#fafafa'
    c.font = '600 30px -apple-system, BlinkMacSystemFont, sans-serif'
    c.fillText('Thursday, Nov 26', w / 2, 165)
    c.font = '300 96px -apple-system, BlinkMacSystemFont, sans-serif'
    const now = new Date()
    c.fillText(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      w / 2,
      268,
    )

    const cards = [
      { app: 'Elastic Tray', title: '120 Hz Physics Active', detail: 'Tilt phone to roll, flick upward to toss.' },
      { app: 'Spatial Link', title: 'Low-Latency Room Sync', detail: 'WebRTC DataChannel with automatic relay.' },
      { app: '3D UI Studio', title: 'Real-Time Glass Reflections', detail: 'Specular coat responds live to orientation.' },
    ]

    let cursorY = 365
    cards.forEach((card, idx) => {
      const expanded = idx === this.state.expandedCard
      const cardH = expanded ? 215 : 132
      const ox = tilt.x * (8 + idx * 5)
      const oy = tilt.y * (8 + idx * 5)
      c.fillStyle = expanded ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)'
      c.beginPath()
      c.roundRect(38 + ox, cursorY + oy, w - 76, cardH, 28)
      c.fill()
      c.strokeStyle = expanded ? 'rgba(172, 216, 179, 0.7)' : 'rgba(255,255,255,0.14)'
      c.lineWidth = expanded ? 2 : 1
      c.stroke()

      c.textAlign = 'left'
      c.fillStyle = '#acd8b3'
      c.font = '600 17px -apple-system, BlinkMacSystemFont, sans-serif'
      c.fillText(card.app.toUpperCase(), 66 + ox, cursorY + 42 + oy)

      c.fillStyle = '#ffffff'
      c.font = '600 24px -apple-system, BlinkMacSystemFont, sans-serif'
      c.fillText(card.title, 66 + ox, cursorY + 80 + oy)

      c.fillStyle = 'rgba(255,255,255,0.78)'
      c.font = '400 19px -apple-system, BlinkMacSystemFont, sans-serif'
      c.fillText(card.detail, 66 + ox, cursorY + 116 + oy)

      if (expanded) {
        c.fillStyle = 'rgba(172, 216, 179, 0.22)'
        c.beginPath()
        c.roundRect(66 + ox, cursorY + 144 + oy, 180, 42, 21)
        c.fill()
        c.fillStyle = '#d1fae5'
        c.font = '600 17px -apple-system, BlinkMacSystemFont, sans-serif'
        c.fillText('Active Focus', 92 + ox, cursorY + 171 + oy)
      }

      cursorY += cardH + 22
    })
  }

  dispose() {
    this.media.texture.dispose()
  }
}
