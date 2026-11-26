import { useEffect, useRef } from 'react'
import { audio } from '../utils/AudioFX'

/* ------------------------------------------------------------------ */
/*  2.5D 布偶貓小窩：分層關節動畫（Canvas 2D 即時繪製，唔係單張紙板貼圖）            */
/*  - 景深舞台：遠細近大、投影、地毯；貓喺房間 (x, d) 平面自主行走                    */
/*  - 關節：身體 / 頭（歪頭、低頭）/ 雙耳 / 眼（眨眼、月牙笑眼）/ 尾巴（分段擺動）/    */
/*    四肢（行走擺動、伸懶腰、理毛）                                                  */
/*  - 生活 AI：迎賓跑到前面 → 閒逛 → 食自動餵糧機 → 貓抓柱伸懶腰 → 坐下理毛           */
/*  - 互動：撫摸（點擊 / 滑動）、餵零食（魚乾追住食）、飾品綁定頭 / 背關節             */
/* ------------------------------------------------------------------ */

const W = 360
const H = 300
const CREAM = '#fbf3e6'
const SEAL = '#6b4636'
const SEAL_D = '#4a2f24'
const LINE = '#3a241b'
const PINK = '#ff9db5'

type St = 'run' | 'greet' | 'idle' | 'walk' | 'eat' | 'scratch' | 'groom' | 'chase' | 'chew' | 'pet'

interface Treat { x: number; d: number; h: number; vh: number; life: number }
interface Heart { x: number; y: number; vy: number; vx: number; life: number; s: number }
interface Kibble { x: number; y: number; vy: number }

const floorY = (d: number) => 168 + d * 118
const scaleAt = (d: number) => 0.5 + d * 0.62
const screenX = (x: number, d: number) => W / 2 + x * (96 + d * 74)

const FEEDER = { x: 0.78, d: 0.1 }
const BOWL = { x: 0.7, d: 0.3 }
const POST = { x: -0.82, d: 0.2 }
const POST_FRONT = { x: -0.62, d: 0.34 }

function ell(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, rot = 0, stroke = true) {
  g.beginPath()
  g.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2)
  g.fillStyle = fill
  g.fill()
  if (stroke) g.stroke()
}

interface Props {
  equipped: string[]
  /** 增加 = 慶祝（跳 + 愛心） */
  cheer: number
  /** 增加 = 丟一粒魚乾 */
  treat: number
}

export default function PetRoom({ equipped, cheer, treat }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const eq = useRef(equipped)
  eq.current = equipped
  const api = useRef<{ cheer: () => void; treat: () => void } | null>(null)
  const last = useRef({ cheer, treat })

  useEffect(() => {
    if (!api.current) return
    if (cheer !== last.current.cheer) api.current.cheer()
    if (treat !== last.current.treat) api.current.treat()
    last.current = { cheer, treat }
  }, [cheer, treat])

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d') as CanvasRenderingContext2D
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      const r = cv.getBoundingClientRect()
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const cat = {
      x: 0, d: 0.02, tx: 0, td: 0.8, st: 'run' as St, t: 0, next: 0,
      jump: 0, spin: 0, happy: 0, purr: 0, walkPh: 0, speed: 0, face: 1,
      blinkAt: 2, blinkUntil: 0, hopT: 0, eatT: 0, lastPurr: 0, waveT: 0,
    }
    const treats: Treat[] = []
    const hearts: Heart[] = []
    const kibbles: Kibble[] = []
    let time = 0
    let lastEat = 0
    let lastScratch = 0
    let raf = 0
    let prev = performance.now()
    let petDown = false
    let petDist = 0
    let lastPt: { x: number; y: number } | null = null

    const emitHearts = (n: number) => {
      const sx = screenX(cat.x, cat.d)
      const sy = floorY(cat.d) - 120 * scaleAt(cat.d)
      for (let i = 0; i < n; i++) hearts.push({ x: sx + (Math.random() - 0.5) * 50, y: sy, vy: -(28 + Math.random() * 24), vx: (Math.random() - 0.5) * 20, life: 1.4, s: 8 + Math.random() * 6 })
    }
    const go = (x: number, d: number, st: St) => {
      cat.tx = Math.max(-0.92, Math.min(0.92, x))
      cat.td = Math.max(0.02, Math.min(0.95, d))
      cat.st = st
    }
    const doPet = () => {
      cat.st = 'pet'
      cat.t = 0
      cat.jump = 1
      cat.spin = 1
      cat.happy = 2.4
      cat.purr = 2.6
      emitHearts(5)
      audio.pop()
    }
    api.current = {
      cheer: () => {
        cat.jump = 1
        cat.happy = 2
        emitHearts(4)
      },
      treat: () => {
        if (treats.length >= 3) return
        treats.push({ x: (Math.random() - 0.5) * 1.2, d: 0.4 + Math.random() * 0.45, h: 160, vh: 0, life: 0 })
        if (cat.st !== 'pet') {
          const t = treats[treats.length - 1]
          go(t.x, t.d, 'chase')
        }
      },
    }
    const pickNext = () => {
      cat.t = 0
      const r = Math.random()
      if (time - lastEat > 22 && r < 0.6) {
        go(BOWL.x - 0.02, BOWL.d + 0.04, 'walk')
        cat.next = 1
      } else if (time - lastScratch > 28 && r < 0.75) {
        go(POST_FRONT.x, POST_FRONT.d, 'walk')
        cat.next = 2
      } else if (r < 0.88) {
        cat.st = 'groom'
        cat.next = 0
      } else {
        go((Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.5, 'walk')
        cat.next = 0
      }
    }

    /* ---------------- 更新 ---------------- */
    const update = (dt: number) => {
      time += dt
      cat.t += dt
      cat.jump = Math.max(0, cat.jump - dt * 1.25)
      cat.spin = Math.max(0, cat.spin - dt * 1.3)
      cat.happy = Math.max(0, cat.happy - dt)
      cat.purr = Math.max(0, cat.purr - dt)
      if (cat.purr > 0 && time - cat.lastPurr > 1.3) {
        cat.lastPurr = time
        audio.purr()
      }
      // 眨眼
      if (time > cat.blinkAt) {
        cat.blinkUntil = time + 0.13
        cat.blinkAt = time + 2.4 + Math.random() * 3
      }
      // 魚乾：落地彈跳
      for (let i = treats.length - 1; i >= 0; i--) {
        const t = treats[i]
        t.vh -= 520 * dt
        t.h += t.vh * dt
        if (t.h <= 0) {
          t.h = 0
          t.vh = Math.abs(t.vh) > 60 ? -t.vh * 0.4 : 0
        }
        t.life += dt
        if (t.life > 14) treats.splice(i, 1)
      }
      for (let i = kibbles.length - 1; i >= 0; i--) {
        kibbles[i].vy += 400 * dt
        kibbles[i].y += kibbles[i].vy * dt
        if (kibbles[i].y > floorY(BOWL.d) - 6) kibbles.splice(i, 1)
      }
      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i]
        h.life -= dt
        h.y += h.vy * dt
        h.x += h.vx * dt
        if (h.life <= 0) hearts.splice(i, 1)
      }

      // 行走
      const moveTo = (arrive: () => void, spd: number) => {
        const dx = cat.tx - cat.x
        const dd = cat.td - cat.d
        const dist = Math.hypot(dx, dd * 1.4)
        if (dist < 0.035) {
          cat.speed = 0
          arrive()
          return
        }
        cat.speed = spd
        const k = Math.min(1, (spd * dt) / dist)
        cat.x += dx * k
        cat.d += dd * k
        cat.walkPh += dt * spd * 22
      }
      switch (cat.st) {
        case 'run':
          moveTo(() => {
            cat.st = 'greet'
            cat.t = 0
            cat.waveT = 0
            emitHearts(2)
          }, 0.55)
          break
        case 'greet':
          cat.waveT += dt
          if (cat.t > 2.6) {
            cat.st = 'idle'
            cat.t = 0
            cat.next = -1
          }
          break
        case 'idle':
          cat.speed = 0
          if (cat.t > 2.2 + (cat.next === -1 ? 0.5 : Math.random() * 0.01)) pickNext()
          break
        case 'walk':
          moveTo(() => {
            if (cat.next === 1) {
              cat.st = 'eat'
              cat.t = 0
              lastEat = time
              for (let i = 0; i < 7; i++) kibbles.push({ x: screenX(FEEDER.x, FEEDER.d) - 6 + (i % 3) * 4, y: floorY(FEEDER.d) - 64 - i * 9, vy: 0 })
            } else if (cat.next === 2) {
              cat.st = 'scratch'
              cat.t = 0
              lastScratch = time
            } else {
              cat.st = 'idle'
              cat.t = 0
            }
          }, 0.3)
          break
        case 'eat':
          if (cat.t > 3.4) {
            cat.st = 'idle'
            cat.t = 0
            cat.happy = 1.2
            emitHearts(2)
          }
          break
        case 'scratch':
          if (cat.t > 3) {
            cat.st = 'idle'
            cat.t = 0
          }
          break
        case 'groom':
          if (cat.t > 3.2) {
            cat.st = 'idle'
            cat.t = 0
          }
          break
        case 'chase': {
          const t = treats[0]
          if (!t) {
            cat.st = 'idle'
            cat.t = 0
            break
          }
          cat.tx = t.x
          cat.td = t.d
          moveTo(() => {
            if (t.h < 8) {
              treats.shift()
              cat.st = 'chew'
              cat.t = 0
            }
          }, 0.7)
          break
        }
        case 'chew':
          if (cat.t > 1.8) {
            cat.st = treats.length ? 'chase' : 'idle'
            cat.t = 0
            cat.happy = 1.4
            emitHearts(3)
            audio.ticket()
          }
          break
        case 'pet':
          if (cat.t > 1.1) {
            cat.st = 'idle'
            cat.t = 0
            cat.next = -1
          }
          break
      }
      if (Math.abs(cat.tx - cat.x) > 0.01 && cat.speed > 0) cat.face = cat.tx > cat.x ? 1 : -1
    }

    /* ---------------- 繪製 ---------------- */
    const drawRoom = () => {
      // 牆
      const wall = g.createLinearGradient(0, 0, 0, 170)
      wall.addColorStop(0, '#3a1670')
      wall.addColorStop(1, '#5a2a98')
      g.fillStyle = wall
      g.fillRect(0, 0, W, 172)
      g.fillStyle = 'rgba(255,225,160,0.55)'
      for (let i = 0; i < 26; i++) {
        const x = (i * 97) % W
        const y = (i * 53) % 130
        g.fillRect(x, y, 2, 2)
      }
      // 粉白條紋牆裙
      for (let i = 0; i < 18; i++) {
        g.fillStyle = i % 2 ? '#f6d8e6' : '#e9a9c6'
        g.fillRect(i * (W / 18), 132, W / 18 + 1, 40)
      }
      g.fillStyle = '#e9c46a'
      g.fillRect(0, 128, W, 5)
      // 窗 + 月
      g.fillStyle = '#16093a'
      g.fillRect(138, 26, 84, 70)
      g.fillStyle = '#ffe9a8'
      g.beginPath()
      g.arc(190, 52, 13, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#16093a'
      g.beginPath()
      g.arc(195, 48, 12, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#e9c46a'
      g.lineWidth = 4
      g.strokeRect(138, 26, 84, 70)
      g.beginPath()
      g.moveTo(180, 26)
      g.lineTo(180, 96)
      g.moveTo(138, 61)
      g.lineTo(222, 61)
      g.stroke()
      // 地板：木紋 + 紫絨地毯
      const fl = g.createLinearGradient(0, 168, 0, H)
      fl.addColorStop(0, '#6b4a3a')
      fl.addColorStop(1, '#8a6248')
      g.fillStyle = fl
      g.fillRect(0, 168, W, H - 168)
      g.strokeStyle = 'rgba(0,0,0,0.18)'
      g.lineWidth = 1
      for (let i = 1; i < 8; i++) {
        const y = 168 + (i / 8) ** 1.4 * 132
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(W, y)
        g.stroke()
      }
      g.fillStyle = '#5a22a0'
      g.beginPath()
      g.ellipse(W / 2, floorY(0.58), 150, 48, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#e9c46a'
      g.lineWidth = 3
      g.stroke()
      g.strokeStyle = 'rgba(255,225,160,0.4)'
      g.lineWidth = 1.5
      g.beginPath()
      g.ellipse(W / 2, floorY(0.58), 124, 38, 0, 0, Math.PI * 2)
      g.stroke()
    }

    const drawFeeder = () => {
      const sx = screenX(FEEDER.x, FEEDER.d)
      const sy = floorY(FEEDER.d)
      const s = scaleAt(FEEDER.d) * 1.15
      g.save()
      g.translate(sx, sy)
      g.scale(s, s)
      g.lineWidth = 2.2
      g.strokeStyle = LINE
      // 機身
      g.fillStyle = '#d4162f'
      g.beginPath()
      g.roundRect(-24, -66, 48, 66, 8)
      g.fill()
      g.stroke()
      g.fillStyle = '#e9c46a'
      g.fillRect(-24, -40, 48, 6)
      // 儲糧罐（透明）
      g.fillStyle = 'rgba(180,230,255,0.55)'
      g.beginPath()
      g.roundRect(-18, -104, 36, 40, 10)
      g.fill()
      g.stroke()
      g.fillStyle = '#c8924a'
      for (let i = 0; i < 9; i++) g.fillRect(-12 + (i % 3) * 9, -96 + Math.floor(i / 3) * 9, 6, 4)
      g.fillStyle = '#ffd34d'
      g.beginPath()
      g.arc(0, -20, 8, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      g.restore()
      // 碗
      const bx = screenX(BOWL.x + 0.08, BOWL.d)
      const by = floorY(BOWL.d)
      g.save()
      g.translate(bx, by)
      g.scale(scaleAt(BOWL.d) * 1.1, scaleAt(BOWL.d) * 1.1)
      g.lineWidth = 2
      g.strokeStyle = LINE
      ell(g, 0, -4, 20, 8, '#ff7ac8')
      ell(g, 0, -8, 15, 5, '#c8924a')
      g.restore()
      g.fillStyle = '#c8924a'
      for (const k of kibbles) g.fillRect(k.x, k.y, 4, 3)
    }

    const drawPost = () => {
      const sx = screenX(POST.x, POST.d)
      const sy = floorY(POST.d)
      const s = scaleAt(POST.d) * 1.15
      g.save()
      g.translate(sx, sy)
      g.scale(s, s)
      g.lineWidth = 2.2
      g.strokeStyle = LINE
      g.fillStyle = '#8a5a3a'
      g.beginPath()
      g.roundRect(-26, -8, 52, 10, 3)
      g.fill()
      g.stroke()
      g.fillStyle = '#e2c494'
      g.fillRect(-9, -86, 18, 80)
      g.strokeRect(-9, -86, 18, 80)
      g.strokeStyle = 'rgba(120,80,40,0.5)'
      for (let y = -80; y < -8; y += 7) {
        g.beginPath()
        g.moveTo(-9, y)
        g.lineTo(9, y + 3)
        g.stroke()
      }
      g.strokeStyle = LINE
      g.fillStyle = '#c8142e'
      g.beginPath()
      g.roundRect(-24, -98, 48, 14, 5)
      g.fill()
      g.stroke()
      g.fillStyle = '#ffd34d'
      g.beginPath()
      g.arc(14, -108, 7, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      g.restore()
    }

    /** 畫貓：原點喺腳底中心；單位 ≈ 像素（scale=1 時貓高約 128） */
    const drawCat = () => {
      const has = (id: string) => eq.current.includes(id)
      const s = scaleAt(cat.d) * 1.05
      const sx = screenX(cat.x, cat.d)
      const sy = floorY(cat.d)
      const st = cat.st as St
      const walking = (st === 'walk' || st === 'run' || st === 'chase') && cat.speed > 0
      const ph = cat.walkPh
      // 姿勢參數
      const jumpH = Math.abs(Math.sin((1 - cat.jump) * Math.PI * 2)) * 46 * cat.jump
      const bob = walking ? Math.abs(Math.sin(ph)) * 4 : Math.sin(time * 2.2) * 1.2
      const sitting = st === 'groom' || (st === 'idle' && cat.t > 0.4) || st === 'greet' || st === 'chew' || st === 'pet'
      const eating = st === 'eat'
      const stretching = st === 'scratch'
      const happy = cat.happy > 0 || st === 'pet' || st === 'chew'
      const blink = time < cat.blinkUntil
      let headDy = 0
      let headRot = Math.sin(time * 0.8) * 0.04
      let headDx = 0
      let tailAmp = 0.18
      let tailSpd = 1.8
      if (st === 'greet') {
        headRot = -0.14 + Math.sin(time * 4) * 0.05 // 抬頭打招呼
        tailAmp = 0.5
        tailSpd = 7
      }
      if (happy) {
        headRot += Math.sin(time * 5) * 0.12 + 0.12
        tailAmp = 0.5
        tailSpd = 8
      }
      if (eating) {
        headDy = 26 + Math.sin(time * 14) * 3
        headRot = 0.25
      }
      if (st === 'chew') {
        headDy = 6
        headRot = Math.sin(time * 16) * 0.05
      }
      if (st === 'chase') headDx = (cat.tx - cat.x) * 6
      const spinA = cat.spin > 0 ? (1 - cat.spin) * Math.PI * 2 : 0
      const scx = Math.cos(spinA) // 轉圈：橫向壓縮模擬旋轉
      const squash = 1 + Math.sin((1 - cat.jump) * Math.PI * 4) * 0.05 * cat.jump
      // 投影（貼地，唔跟跳高）
      g.save()
      g.translate(sx, sy)
      g.scale(s, s)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.beginPath()
      g.ellipse(0, 2, 40 - jumpH * 0.25, 9, 0, 0, Math.PI * 2)
      g.fill()
      g.translate(0, -jumpH - bob)
      g.scale(Math.abs(scx) * 0.15 + 0.85 > 0 ? 1 + (scx - 1) * 0.18 : 1, squash)
      g.lineWidth = 2.4
      g.strokeStyle = LINE
      g.lineJoin = 'round'
      g.lineCap = 'round'

      const lean = walking ? Math.sin(ph) * 0.03 + cat.face * 0.03 : 0
      g.rotate(lean + (stretching ? 0.12 : 0))

      // 披風（背後）
      if (has('pet_cape_royal')) {
        const fl = walking ? Math.sin(ph * 0.5) * 8 : Math.sin(time * 2) * 3
        g.fillStyle = '#c8142e'
        g.beginPath()
        g.moveTo(-22, -84)
        g.quadraticCurveTo(-44 - fl, -48, -36 - fl * 1.5, -6)
        g.lineTo(36 + fl * 1.5, -6)
        g.quadraticCurveTo(44 + fl, -48, 22, -84)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = '#f2c14e'
        g.fillRect(-26, -66, 52, 5)
      }
      // 天使翼（背後，拍動）
      if (has('pet_wings')) {
        const flap = Math.sin(time * (walking || happy ? 9 : 2.5)) * 0.35
        for (const sgn of [-1, 1]) {
          g.save()
          g.translate(sgn * 18, -78)
          g.rotate(sgn * (0.5 + flap))
          for (let i = 0; i < 3; i++) {
            ell(g, sgn * (14 + i * 11), -6 - i * 8, 22 - i * 3, 8, '#ffffff', sgn * (-0.35 - i * 0.18))
          }
          g.restore()
        }
      }
      // 尾巴：分段擺動（蓬鬆）
      {
        const base = { x: 20, y: -34 }
        const sg = 6
        let px = base.x
        let py = base.y
        let ang = -0.3
        for (let i = 0; i < sg; i++) {
          ang += Math.sin(time * tailSpd - i * 0.7) * tailAmp * 0.45 - 0.16
          px += Math.cos(ang) * 13
          py += Math.sin(ang) * 13
          ell(g, px, py, 11 - i * 0.2, 8.4, i > sg - 3 ? SEAL_D : SEAL, ang)
        }
      }
      // 後腿 / 臀
      if (sitting || eating) {
        ell(g, -24, -14, 17, 14, CREAM)
        ell(g, 24, -14, 17, 14, CREAM)
        ell(g, -26, -3, 11, 5, '#ffffff')
        ell(g, 26, -3, 11, 5, '#ffffff')
      } else {
        const sw = walking ? Math.sin(ph) * 7 : 0
        ell(g, -18, -12 + (walking ? Math.max(0, -sw) * 0.4 : 0), 13, 17, CREAM)
        ell(g, 18, -12 + (walking ? Math.max(0, sw) * 0.4 : 0), 13, 17, CREAM)
        ell(g, -18 + sw * 0.4, -3, 12, 5, '#ffffff')
        ell(g, 18 - sw * 0.4, -3, 12, 5, '#ffffff')
      }
      // 身體
      const bodyH = sitting ? 40 : eating ? 34 : 34
      ell(g, 0, -42 + (stretching ? 6 : 0), 30, bodyH, CREAM)
      ell(g, 0, -34, 22, 28, '#ffffff', 0, false)
      // 前肢
      const armUp = st === 'groom' ? 1 : st === 'greet' ? Math.sin(cat.waveT * 8) * 0.5 + 0.5 : 0
      for (const sgn of [-1, 1]) {
        let ax = sgn * 14
        let ay = -8
        let len = 28
        if (walking) ay -= Math.max(0, Math.sin(ph + (sgn > 0 ? Math.PI : 0))) * 6
        if (stretching) {
          ax = sgn * 14
          ay = -4
          len = 40
        }
        const raised = (st === 'groom' && sgn > 0) || (st === 'greet' && sgn > 0)
        if (raised) {
          g.save()
          g.translate(16, -60)
          g.rotate(-1.1 + armUp * -0.5)
          ell(g, 0, -14, 8, 17, CREAM)
          ell(g, 0, -28, 8, 6, '#ffffff')
          for (const k of [-3, 0, 3]) ell(g, k, -29, 1.6, 1.6, PINK, 0, false)
          g.restore()
        } else {
          ell(g, ax, ay - len / 2 - 4, 8, len / 2 + 2, CREAM)
          ell(g, ax, ay + 1, 10, 6, '#ffffff')
          for (const k of [-3.5, 0, 3.5]) ell(g, ax + k, ay + 1, 1.8, 1.6, PINK, 0, false)
        }
      }
      // 頸毛（蓬鬆白）
      ell(g, 0, -74, 26, 10, '#ffffff')

      // ---- 頭（關節：頸部樞軸 (0,-80)）----
      g.save()
      g.translate(headDx, -86 + headDy)
      g.rotate(headRot)
      // 耳（外深啡內粉紅，會抖耳）
      const flick = Math.sin(time * 3.1) > 0.97 ? 0.25 : 0
      for (const sgn of [-1, 1]) {
        g.save()
        g.translate(sgn * 21, -22)
        g.rotate(sgn * (0.38 + (sgn > 0 ? flick : 0)))
        g.fillStyle = SEAL_D
        g.beginPath()
        g.moveTo(-11, 6)
        g.lineTo(0, -24)
        g.lineTo(11, 6)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = '#ffb3c6'
        g.beginPath()
        g.moveTo(-6, 4)
        g.lineTo(0, -15)
        g.lineTo(6, 4)
        g.closePath()
        g.fill()
        g.restore()
      }
      ell(g, 0, 0, 35, 31, CREAM)
      // 面罩：額頭 + 眼周深啡，中間白色倒 V
      g.fillStyle = SEAL
      g.beginPath()
      g.moveTo(-34, -2)
      g.bezierCurveTo(-36, -28, -16, -34, 0, -33)
      g.bezierCurveTo(16, -34, 36, -28, 34, -2)
      g.bezierCurveTo(30, 6, 16, 10, 8, 4)
      g.lineTo(0, -20)
      g.lineTo(-8, 4)
      g.bezierCurveTo(-16, 10, -30, 6, -34, -2)
      g.closePath()
      g.fill()
      g.beginPath()
      g.ellipse(0, 12, 17, 12, 0, 0, Math.PI * 2)
      g.fillStyle = '#ffffff'
      g.fill()
      // 腮紅
      g.fillStyle = 'rgba(255,120,150,0.5)'
      ell(g, -23, 11, 6, 3.5, 'rgba(255,120,150,0.5)', 0, false)
      ell(g, 23, 11, 6, 3.5, 'rgba(255,120,150,0.5)', 0, false)
      // 眼
      for (const sgn of [-1, 1]) {
        const ex = sgn * 14
        const ey = 0
        g.strokeStyle = LINE
        if (happy || blink) {
          g.lineWidth = 2.6
          g.beginPath()
          if (happy) g.arc(ex, ey + 3, 7, Math.PI * 1.12, Math.PI * 1.88)
          else g.arc(ex, ey - 3, 7, Math.PI * 0.15, Math.PI * 0.85)
          g.stroke()
          g.lineWidth = 2.4
        } else {
          ell(g, ex, ey, 8.4, 9.6, '#ffffff', 0, false)
          const gr = g.createRadialGradient(ex, ey - 3, 1, ex, ey, 8)
          gr.addColorStop(0, '#9fe0ff')
          gr.addColorStop(0.6, '#3a8eea')
          gr.addColorStop(1, '#1a3f9a')
          const lx = Math.max(-2, Math.min(2, (cat.tx - cat.x) * 6 * (walking ? 1 : 0)))
          ell(g, ex + lx, ey + 0.5, 7.2, 8.6, gr as unknown as string, 0, false)
          ell(g, ex + lx, ey + 1, 3.4, 5.4, '#0d1730', 0, false)
          ell(g, ex + lx + 2.6, ey - 3.6, 2.5, 3, '#ffffff', 0, false)
          ell(g, ex + lx - 3, ey + 4, 1.2, 1.2, '#ffffff', 0, false)
          g.lineWidth = 1.8
          g.beginPath()
          g.ellipse(ex, ey, 8.6, 9.8, 0, Math.PI * 1.06, Math.PI * 1.94)
          g.stroke()
          g.lineWidth = 2.4
        }
      }
      // 鼻 + 嘴
      g.fillStyle = '#ff7f9f'
      g.beginPath()
      g.moveTo(-3.5, 6)
      g.lineTo(3.5, 6)
      g.lineTo(0, 10.5)
      g.closePath()
      g.fill()
      g.lineWidth = 1.6
      g.beginPath()
      if (happy || eating || (cat.st as St) === 'chew') {
        const open = eating || (cat.st as St) === 'chew' ? 4 + Math.abs(Math.sin(time * 14)) * 4 : 6
        g.moveTo(-7, 13)
        g.quadraticCurveTo(0, 13 + open * 2, 7, 13)
        g.closePath()
        g.fillStyle = '#c8304e'
        g.fill()
        g.stroke()
      } else {
        g.moveTo(0, 10.5)
        g.quadraticCurveTo(-3, 16, -8, 13)
        g.moveTo(0, 10.5)
        g.quadraticCurveTo(3, 16, 8, 13)
        g.stroke()
      }
      // 鬚
      g.strokeStyle = 'rgba(70,40,30,0.7)'
      g.lineWidth = 1
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          g.beginPath()
          g.moveTo(sgn * 18, 11 + i * 2.5)
          g.lineTo(sgn * 38, 6 + i * 6)
          g.stroke()
        }
      }
      g.strokeStyle = LINE
      g.lineWidth = 2.4
      // 小丑鼻（綁頭部關節）
      if (has('pet_clown_nose')) {
        ell(g, 0, 8, 6.5, 6.5, '#ff1e3c')
        ell(g, -2, 6, 1.8, 1.4, 'rgba(255,255,255,0.85)', 0, false)
      }
      // 巫師帽（綁頭部關節）
      if (has('pet_hat_wizard')) {
        g.save()
        g.translate(0, -30)
        g.rotate(0.12 + Math.sin(time * 2.4) * 0.03)
        ell(g, 0, 2, 42, 8, '#4a1a8a')
        g.fillStyle = '#6a2ac0'
        g.beginPath()
        g.moveTo(-26, 0)
        g.quadraticCurveTo(-8, -40, 10 + Math.sin(time * 3) * 3, -64)
        g.quadraticCurveTo(14, -36, 26, 0)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = '#f2c14e'
        g.fillRect(-26, -7, 52, 7)
        g.fillStyle = '#ffe066'
        g.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
          const a2 = a + Math.PI / 5
          g.lineTo(2 + Math.cos(a) * 7, -30 + Math.sin(a) * 7)
          g.lineTo(2 + Math.cos(a2) * 3, -30 + Math.sin(a2) * 3)
        }
        g.closePath()
        g.fill()
        g.restore()
      }
      g.restore() // 頭
      g.restore() // 貓
    }

    const drawTreats = () => {
      for (const t of treats) {
        const sx = screenX(t.x, t.d)
        const sy = floorY(t.d) - t.h * scaleAt(t.d)
        g.fillStyle = 'rgba(0,0,0,0.25)'
        g.beginPath()
        g.ellipse(sx, floorY(t.d), 9 * scaleAt(t.d) * 1.3, 3, 0, 0, Math.PI * 2)
        g.fill()
        g.save()
        g.translate(sx, sy - 6)
        g.scale(scaleAt(t.d) * 1.4, scaleAt(t.d) * 1.4)
        g.lineWidth = 1.6
        g.strokeStyle = LINE
        g.fillStyle = '#f0b050'
        g.beginPath()
        g.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2)
        g.fill()
        g.stroke()
        g.beginPath()
        g.moveTo(8, 0)
        g.lineTo(15, -5)
        g.lineTo(15, 5)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = LINE
        g.beginPath()
        g.arc(-5, -1, 1.2, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
    }

    const drawHearts = () => {
      for (const h of hearts) {
        g.save()
        g.globalAlpha = Math.max(0, Math.min(1, h.life))
        g.translate(h.x, h.y)
        g.scale(h.s / 10, h.s / 10)
        g.fillStyle = '#ff6f9a'
        g.strokeStyle = '#7a1838'
        g.lineWidth = 1.6
        g.beginPath()
        g.moveTo(0, 8)
        g.bezierCurveTo(-12, -2, -8, -12, 0, -6)
        g.bezierCurveTo(8, -12, 12, -2, 0, 8)
        g.fill()
        g.stroke()
        g.restore()
      }
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      update(dt)
      g.setTransform((cv.width / W), 0, 0, (cv.height / H), 0, 0)
      g.clearRect(0, 0, W, H)
      drawRoom()
      // 景深排序：按 d 由遠到近
      const items: Array<{ d: number; fn: () => void }> = [
        { d: FEEDER.d, fn: drawFeeder },
        { d: POST.d, fn: drawPost },
        { d: cat.d, fn: drawCat },
      ]
      items.sort((a, b) => a.d - b.d).forEach((i) => i.fn())
      drawTreats()
      drawHearts()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    /* ---------------- 撫摸 ---------------- */
    const toLogical = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
    }
    const onCat = (p: { x: number; y: number }) => {
      const s = scaleAt(cat.d) * 1.05
      const cx = screenX(cat.x, cat.d)
      const cy = floorY(cat.d) - 64 * s
      return Math.abs(p.x - cx) < 52 * s && Math.abs(p.y - cy) < 72 * s
    }
    const down = (e: PointerEvent) => {
      const p = toLogical(e)
      petDown = true
      lastPt = p
      petDist = 0
      if (onCat(p)) doPet()
    }
    const move = (e: PointerEvent) => {
      if (!petDown) return
      const p = toLogical(e)
      if (lastPt && onCat(p)) {
        petDist += Math.hypot(p.x - lastPt.x, p.y - lastPt.y)
        cat.happy = Math.max(cat.happy, 1.2)
        cat.purr = Math.max(cat.purr, 1.4)
        if (petDist > 36) {
          petDist = 0
          emitHearts(1)
          if (cat.st !== 'pet' && cat.jump === 0 && Math.random() < 0.25) doPet()
        }
      }
      lastPt = p
    }
    const up = () => {
      petDown = false
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // 入窗：由房間深處跑向前
    go(0, 0.82, 'run')

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      api.current = null
    }
  }, [])

  return <canvas ref={ref} className="pet-room" aria-label="布偶貓小窩" />
}
