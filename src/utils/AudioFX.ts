/**
 * 零依賴 Web Audio API 音效（全部即時合成，冇任何音檔）。
 * 瀏覽器要求用戶手勢先可以出聲，所以第一次互動時先 unlock()。
 */
type OscType = OscillatorType

class AudioFX {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private muted = false
  private lastTing = 0

  /** 喺 pointerdown 等用戶手勢內呼叫 */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.5
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      /* 靜音降級 */
    }
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.01)
  }

  private tone(freq: number, dur: number, type: OscType, vol: number, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  /** 貓耳炮射幣 */
  shoot() {
    this.tone(520, 0.09, 'square', 0.1, 980)
    this.tone(1300, 0.05, 'triangle', 0.06, undefined, 0.03)
  }

  /** 吞幣（價值愈大音愈高） */
  ting(value = 1) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (now - this.lastTing < 0.045) return
    this.lastTing = now
    const base = value >= 20 ? 1319 : value >= 5 ? 1175 : 1568
    this.tone(base, 0.14, 'triangle', 0.14)
    this.tone(base * 1.5, 0.22, 'sine', 0.07, undefined, 0.04)
  }

  /** 魔法陣疊塔 */
  magic() {
    this.tone(260, 0.7, 'sawtooth', 0.06, 1560)
    this.tone(390, 0.7, 'sine', 0.08, 2340, 0.05)
    ;[1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.08, undefined, 0.55 + i * 0.07))
  }

  /** Jackpot 號角 */
  jackpot() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318, 1568]
    notes.forEach((f, i) => {
      this.tone(f, 0.22, 'square', 0.09, undefined, i * 0.09)
      this.tone(f / 2, 0.22, 'triangle', 0.1, undefined, i * 0.09)
    })
  }

  /** 冇幣 / 錯誤 */
  error() {
    this.tone(220, 0.16, 'sawtooth', 0.1, 110)
  }

  /** UI 點擊 */
  click() {
    this.tone(880, 0.05, 'triangle', 0.08, 660)
  }
}

export const audio = new AudioFX()
