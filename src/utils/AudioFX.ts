/**
 * 零依賴 Web Audio API 音效（全部即時合成，冇任何音檔）。
 * - 瀏覽器要求用戶手勢先可以出聲，所以第一次互動時先 unlock()
 * - 主輸出經 DynamicsCompressor，連環爆幣都唔會爆音
 * - 兩條持續循環聲：推板機械運轉 + 幣滑動磨擦，音量跟遊戲狀態變化
 */
type OscType = OscillatorType

interface NoiseOpts {
  type?: BiquadFilterType
  freq?: number
  freqEnd?: number
  q?: number
  vol?: number
  delay?: number
  attack?: number
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

// ---- 背景音樂樂譜：C 大調五聲音階，112 BPM，8 小節循環（C - Am - F - G）×2 ----
const BPM = 112
const EIGHTH = 60 / BPM / 2
const BARS = 8
const CHORDS = [
  { root: 48, tones: [60, 64, 67] }, // C
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 43, tones: [55, 59, 62] }, // G
]
const ARP = [0, 1, 2, 1, 0, 1, 2, 1]
const N = null
const MELODY: Array<number | null> = [
  76, N, 79, 76, 74, N, 72, N, //  C
  69, 72, 76, 72, 69, N, 67, N, //  Am
  72, N, 69, 72, 76, N, 74, N, //  F
  74, N, 79, 76, 74, 72, 74, N, //  G
  76, 79, 81, 79, 76, N, 72, N, //  C
  76, N, 72, 69, 72, N, 76, N, //  Am
  74, N, 72, 69, 72, N, 74, N, //  F
  79, N, 76, 74, 72, N, 67, N, //  G
]

class AudioFX {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private muted = false
  private lastTing = 0
  private lastClink = 0

  // 背景音樂（輕快、低音量；用 lookahead 排程，播放平穩）
  private musicGain: GainNode | null = null
  private musicTimer: number | undefined
  private musicStep = 0
  private musicNext = 0
  private musicLevel = 1

  /** 喺 pointerdown 等用戶手勢內呼叫 */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        const comp = this.ctx.createDynamicsCompressor()
        comp.threshold.value = -18
        comp.ratio.value = 6
        comp.attack.value = 0.003
        comp.release.value = 0.2
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.6
        this.master.connect(comp).connect(this.ctx.destination)

        const len = this.ctx.sampleRate * 1.5
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      this.startMusic()
    } catch {
      /* 靜音降級 */
    }
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.01)
  }

  /* ------------------------- 基本積木 ------------------------- */
  private tone(freq: number, dur: number, type: OscType, vol: number, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, o: NoiseOpts = {}) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return
    const { type = 'bandpass', freq = 1500, freqEnd, q = 1, vol = 0.1, delay = 0, attack = 0.005 } = o
    const t0 = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(freq, t0)
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t0, Math.random() * 0.5)
    src.stop(t0 + dur + 0.05)
  }

  /* ------------------------- 背景音樂 ------------------------- */
  /** 開始輕快背景音樂（重複呼叫無副作用） */
  startMusic() {
    if (!this.ctx || !this.master || this.musicTimer !== undefined) return
    if (!this.musicGain) {
      this.musicGain = this.ctx.createGain()
      this.musicGain.gain.value = 0.32 * this.musicLevel
      this.musicGain.connect(this.master)
    }
    this.musicNext = this.ctx.currentTime + 0.1
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90)
  }

  stopMusic() {
    if (this.musicTimer !== undefined) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = undefined
    }
  }

  /** 小遊戲等面板開住時壓低音樂（0..1） */
  setMusicLevel(v: number) {
    this.musicLevel = v
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(0.32 * v, this.ctx.currentTime, 0.3)
  }

  private scheduleMusic() {
    if (!this.ctx) return
    // 預排 0.35 秒內嘅音符；分頁卡咗太耐就重新對時，避免狂補音
    if (this.musicNext < this.ctx.currentTime - 0.5) this.musicNext = this.ctx.currentTime + 0.05
    while (this.musicNext < this.ctx.currentTime + 0.35) {
      this.musicStepAt(this.musicStep, this.musicNext)
      this.musicNext += EIGHTH
      this.musicStep = (this.musicStep + 1) % (BARS * 8)
    }
  }

  private mTone(midi: number, t: number, dur: number, type: OscType, vol: number) {
    if (!this.ctx || !this.musicGain) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this.musicGain)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private musicStepAt(step: number, t: number) {
    const bar = Math.floor(step / 8)
    const i = step % 8
    const chord = CHORDS[bar % CHORDS.length]
    // 低音：第 1、3 拍根音，第 2、4 拍五度，輕彈
    if (i % 2 === 0) this.mTone(i % 4 === 0 ? chord.root : chord.root + 7, t, EIGHTH * 1.6, 'triangle', i % 4 === 0 ? 0.11 : 0.06)
    // 和弦琶音（高八度，柔音）
    this.mTone(chord.tones[ARP[i]] + 12, t, EIGHTH * 1.3, 'sine', 0.05)
    // 旋律：五聲音階，輕快跳躍
    const m = MELODY[step]
    if (m) this.mTone(m, t, EIGHTH * 1.5, 'triangle', 0.075)
    // 輕打擊：第 1、3 拍軟底鼓，反拍細小 hi-hat
    if (i % 4 === 0 && this.noiseBuf) this.mKick(t)
    if (i % 2 === 1) this.mHat(t)
  }

  private mKick(t: number) {
    if (!this.ctx || !this.musicGain) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.frequency.setValueAtTime(130, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    g.gain.setValueAtTime(0.12, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    osc.connect(g).connect(this.musicGain)
    osc.start(t)
    osc.stop(t + 0.18)
  }

  private mHat(t: number) {
    if (!this.ctx || !this.musicGain || !this.noiseBuf) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = this.ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.035, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(f).connect(g).connect(this.musicGain)
    src.start(t, Math.random())
    src.stop(t + 0.06)
  }

  /* ------------------------- 推幣機音效 ------------------------- */
  /** 貓耳炮射幣：氣壓 whoosh + 上揚叮 */
  shoot() {
    this.noise(0.14, { type: 'bandpass', freq: 900, freqEnd: 3200, q: 1.2, vol: 0.08 })
    this.tone(520, 0.09, 'square', 0.08, 980)
    this.tone(1300, 0.05, 'triangle', 0.05, undefined, 0.03)
  }

  /** 幣首次落到檯面／幣堆：金屬清脆碰撞 */
  clink() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (now - this.lastClink < 0.035) return
    this.lastClink = now
    const f = rnd(2300, 3600)
    this.tone(f, 0.07, 'triangle', 0.06)
    this.tone(f * 1.52, 0.05, 'sine', 0.035)
    this.noise(0.03, { type: 'highpass', freq: 5000, vol: 0.04 })
  }

  /** 推板行程終點嘅機械撞擊 */
  clunk() {
    this.tone(95, 0.14, 'sine', 0.06, 50)
    this.noise(0.06, { type: 'lowpass', freq: 600, vol: 0.03 })
  }

  /** 幣跌入吞幣溝（價值愈大音愈高、愈厚） */
  ting(value = 1) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (now - this.lastTing < 0.04) return
    this.lastTing = now
    if (value >= 20) return this.thud()
    if (value >= 5) return this.chime()
    const base = rnd(1400, 1750)
    this.tone(base, 0.14, 'triangle', 0.13)
    this.tone(base * 1.5, 0.22, 'sine', 0.065, undefined, 0.04)
    this.noise(0.05, { type: 'highpass', freq: 4500, vol: 0.03 })
  }

  /** 落邊溝（唔派彩）：低沉嘅「咚」，唔刺耳 */
  gutter() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (now - this.lastTing < 0.06) return
    this.tone(150, 0.12, 'sine', 0.05, 80)
  }

  /** 金磚落：沉重 */
  thud() {
    this.tone(140, 0.26, 'sine', 0.2, 55)
    this.tone(1175, 0.3, 'triangle', 0.1, undefined, 0.03)
    this.noise(0.12, { type: 'lowpass', freq: 900, vol: 0.1 })
  }

  /** 白金幣落：鐘聲 */
  chime() {
    ;[1568, 2349, 3136].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.08 - i * 0.02, undefined, i * 0.03))
  }

  /**
   * 爆幣！一次跌好多幣：氣流爆開 + 低頻轟 + 銅幣雨。level 1..3
   */
  burst(level: number) {
    this.noise(0.5, { type: 'highpass', freq: 400, freqEnd: 6000, q: 0.6, vol: 0.13 + level * 0.03, attack: 0.04 })
    this.tone(120, 0.45, 'sine', 0.22, 38)
    const n = 8 + level * 6
    for (let i = 0; i < n; i++) {
      this.tone(rnd(1400, 3400), 0.14, 'triangle', 0.06, undefined, 0.05 + i * 0.045 + Math.random() * 0.03)
    }
    ;[523, 659, 784, 1046].slice(0, 2 + level).forEach((f, i) => this.tone(f, 0.2, 'square', 0.06, undefined, 0.08 + i * 0.07))
  }

  /** 塔倒塌：連環撞擊 + 滑塌 */
  crash() {
    this.noise(0.9, { type: 'lowpass', freq: 2500, freqEnd: 200, vol: 0.16, attack: 0.03 })
    this.tone(80, 0.6, 'sine', 0.22, 30)
    for (let i = 0; i < 12; i++) this.tone(rnd(900, 2800), 0.09, 'triangle', 0.06, undefined, i * 0.06 + Math.random() * 0.04)
  }

  /** 魔法陣疊塔 */
  magic() {
    this.tone(260, 0.7, 'sawtooth', 0.05, 1560)
    this.tone(390, 0.7, 'sine', 0.07, 2340, 0.05)
    ;[1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.07, undefined, 0.55 + i * 0.07))
  }

  /** 疊塔每層落一隻幣嘅叮（音階逐層升高） */
  stackTick(i: number) {
    this.tone(660 * Math.pow(1.045, i), 0.06, 'triangle', 0.05)
  }

  /** Jackpot 號角 */
  jackpot() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318, 1568]
    notes.forEach((f, i) => {
      this.tone(f, 0.22, 'square', 0.08, undefined, i * 0.09)
      this.tone(f / 2, 0.22, 'triangle', 0.09, undefined, i * 0.09)
    })
    this.noise(0.8, { type: 'highpass', freq: 3000, vol: 0.05, delay: 0.5 })
  }

  /** 冇幣 / 錯誤 */
  error() {
    this.tone(220, 0.16, 'sawtooth', 0.09, 110)
  }

  /** UI 點擊 */
  click() {
    this.tone(880, 0.05, 'triangle', 0.07, 660)
  }

  /* ------------------------- 積分 / 獎品 ------------------------- */
  /** 拎到小遊戲券 */
  ticket() {
    ;[880, 1175, 1760].forEach((f, i) => this.tone(f, 0.12, 'square', 0.05, undefined, i * 0.07))
  }

  /** 加積分 */
  points() {
    this.tone(1319, 0.08, 'triangle', 0.08)
    this.tone(1760, 0.14, 'triangle', 0.08, undefined, 0.07)
  }

  /** 兌換成功 */
  buy() {
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.09, undefined, i * 0.07))
    this.chime()
  }

  /* ------------------------- 小遊戲 ------------------------- */
  /** 倒數嘟聲；final = 開始嗰聲 */
  countBeep(final = false) {
    this.tone(final ? 1320 : 660, final ? 0.3 : 0.12, 'square', 0.08)
  }

  /** 最後 3 秒急促提示 */
  urgent() {
    this.tone(1000, 0.05, 'square', 0.06)
  }

  /** 打中貓仔 */
  hit(golden = false) {
    if (golden) {
      this.tone(1568, 0.1, 'triangle', 0.1)
      this.tone(2349, 0.2, 'triangle', 0.09, undefined, 0.05)
    } else {
      this.tone(rnd(780, 980), 0.08, 'square', 0.07, 1300)
    }
    this.noise(0.04, { type: 'highpass', freq: 3000, vol: 0.04 })
  }

  /** 漏咗 */
  miss() {
    this.tone(200, 0.12, 'sawtooth', 0.05, 120)
  }

  /** 輪盤格線咔嗒 */
  wheelTick() {
    this.tone(1900, 0.025, 'square', 0.05)
  }

  /** 扭蛋機搖晃 */
  shake() {
    this.noise(0.09, { type: 'bandpass', freq: rnd(1800, 3000), q: 3, vol: 0.09 })
    this.tone(rnd(300, 420), 0.05, 'square', 0.05)
  }

  /** 扭蛋開殼 */
  pop() {
    this.tone(300, 0.2, 'sine', 0.2, 900)
    this.noise(0.15, { type: 'highpass', freq: 2500, vol: 0.1 })
  }

  /** 完成／贏 */
  win() {
    ;[523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.07, undefined, i * 0.09))
    this.tone(1568, 0.5, 'triangle', 0.09, undefined, 0.4)
  }
}

export const audio = new AudioFX()

// 分頁入背景就停音樂，返嚟再開（唔會喺背景偷偷響）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.stopMusic()
    else audio.startMusic()
  })
}
