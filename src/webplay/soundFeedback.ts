class SoundFeedback {
  private context: AudioContext | null = null
  private muted = false

  setMuted(muted: boolean) {
    this.muted = muted
  }

  isMuted() {
    return this.muted
  }

  unlock() {
    if (typeof window === 'undefined') return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!this.context) {
      this.context = new Ctor()
    }
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {})
    }
  }

  private playTone(freqStart: number, freqEnd: number, durationSec: number, gainPeak: number, type: OscillatorType = 'sine') {
    if (this.muted || !this.context || this.context.state !== 'running') return
    const now = this.context.currentTime
    const osc = this.context.createOscillator()
    const gain = this.context.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqStart, now)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + durationSec)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec)
    osc.connect(gain)
    gain.connect(this.context.destination)
    osc.start(now)
    osc.stop(now + durationSec + 0.01)
  }

  playCatch() {
    this.playTone(540, 820, 0.075, 0.14, 'triangle')
    if (!this.muted && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(14)
    }
  }

  playDrop() {
    this.playTone(220, 95, 0.14, 0.12, 'sine')
  }

  playSpawn() {
    this.playTone(360, 540, 0.06, 0.09, 'sine')
  }
}

export const soundFeedback = new SoundFeedback()
