import { useEffect, useRef } from 'react'
import { audio } from '../utils/AudioFX'
import { getSprite, type SpriteKey } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  2.5D 布偶貓小窩：手繪 4 動作精靈圖（idle / walk / eat / happy）+ Canvas 2D 景深舞台  */
/*  - 景深舞台：遠細近大、投影、地毯；貓喺房間 (x, d) 平面自主行走                    */

/*    行走：左右翻轉 scaleX(-1) + 步頻彈跳 / 搖擺；食糧：低頭咀嚼；撫摸：跳 + 愛心   */
/*  - 生活 AI：迎賓跑到前面 → 閒逛 → 食自動餵糧機 → 貓抓柱伸懶腰 → 坐下理毛           */
/*  - 互動：撫摸（點擊 / 滑動）、餵零食（魚乾追住食）、飾品綁定頭 / 背關節             */
/* ------------------------------------------------------------------ */

const W = 360
const H = 300
const LINE = '#3a241b'

type PoseKey = 'idle' | 'walk' | 'eat' | 'happy'
/** 每個動作：精靈鍵、顯示高度、頭頂 / 背 / 鼻座標（精靈圖寬高比例，圖面向左）、頭寬比例 */
const POSES: Record<PoseKey, { key: SpriteKey; h: number; head: [number, number]; back: [number, number]; nose: [number, number]; hw: number }> = {
  idle: { key: 'pet_pose_idle', h: 132, head: [0.46, 0.09], back: [0.5, 0.6], nose: [0.46, 0.37], hw: 0.5 },
  walk: { key: 'pet_pose_walk', h: 112, head: [0.37, 0.13], back: [0.62, 0.34], nose: [0.39, 0.45], hw: 0.34 },
  eat: { key: 'pet_pose_eat', h: 92, head: [0.27, 0.28], back: [0.6, 0.42], nose: [0.27, 0.74], hw: 0.34 },
  happy: { key: 'pet_pose_happy', h: 116, head: [0.38, 0.11], back: [0.64, 0.42], nose: [0.4, 0.45], hw: 0.34 },
}

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

    /**
     * 畫貓：用手繪 4 動作精靈圖（idle / walk / eat / happy），唔再用程式向量。
     * 精靈圖原本都係面向左（idle 近乎正面）→ 向右行時 scaleX(-1) 翻轉；行走配步頻彈跳 + 輕微搖擺。
     * 飾品按每個動作嘅頭 / 背座標（佔精靈圖寬高嘅比例）綁定，並跟住翻轉鏡像。
     */
    let curPose: PoseKey = 'idle'
    let prevPose: PoseKey = 'idle'
    let fade = 0
    let dtNow = 0.016
    const drawCat = () => {
      const has = (id: string) => eq.current.includes(id)
      const s = scaleAt(cat.d)
      const sx = screenX(cat.x, cat.d)
      const sy = floorY(cat.d)
      const st = cat.st as St
      const walking = (st === 'walk' || st === 'run' || st === 'chase') && cat.speed > 0
      const jumping = cat.jump > 0
      const happy = cat.happy > 0 || st === 'pet'
      let pose: PoseKey = 'idle'
      if (st === 'eat' || st === 'chew') pose = 'eat'
      else if (jumping || happy) pose = 'happy'
      else if (walking || st === 'greet') pose = 'walk'
      // 動作切換：舊動作淡出 0.18s（交叉淡入淡出，唔再硬切）
      if (pose !== curPose) {
        prevPose = curPose
        curPose = pose
        fade = 1
      }
      const P = POSES[pose]
      const spr = getSprite(P.key).canvas
      const h = P.h * s
      const w = (spr.width / spr.height) * h
      const flip = pose === 'idle' ? 1 : cat.face > 0 ? -1 : 1 // 精靈圖面向左：向右行就翻轉
      const ph = cat.walkPh
      const jp = 1 - cat.jump // 起跳進度 0..1：頭 15% 先下蹲蓄力，之後先彈起
      const crouching = jumping && jp < 0.15
      const hop = jumping && !crouching ? Math.abs(Math.sin(jp * Math.PI * 2)) * 50 * cat.jump * s : 0
      const stepBob = walking ? Math.abs(Math.sin(ph)) * 6 * s : st === 'greet' ? Math.abs(Math.sin(time * 5)) * 3 * s : Math.sin(time * 2) * 1 * s
      const sway = walking ? Math.sin(ph) * 0.045 : st === 'greet' ? Math.sin(time * 5) * 0.03 : st === 'groom' ? Math.sin(time * 3) * 0.025 : 0
      const spinA = cat.spin > 0 ? (1 - cat.spin) * Math.PI * 2 : 0
      let sqx = 1
      let sqy = 1
      if (walking) {
        const k = Math.sin(ph)
        sqy = 1 - Math.abs(k) * 0.025
        sqx = 1 + Math.abs(k) * 0.025
      }
      if (pose === 'eat') sqy = 1 + Math.sin(time * 14) * 0.012
      if (st === 'scratch') {
        sqx = 1.08
        sqy = 0.92
      }
      if (crouching) {
        const e = jp / 0.15
        sqy *= 1 - 0.22 * e
        sqx *= 1 + 0.14 * e
      } else if (jumping) {
        // 升空拉長、落地壓扁
        sqy *= 1 + Math.sin(jp * Math.PI * 4) * 0.09 * cat.jump
        sqx *= 1 - Math.sin(jp * Math.PI * 4) * 0.05 * cat.jump
      }
      // 投影（貼地）
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.beginPath()
      g.ellipse(sx, sy + 2, (w * 0.36 - hop * 0.15), 9 * s, 0, 0, Math.PI * 2)
      g.fill()
      g.save()
      g.translate(sx, sy - hop - stepBob)
      g.rotate(sway)
      g.scale(sqx * Math.max(0.12, Math.abs(Math.cos(spinA))) * (Math.cos(spinA) < 0 ? 1 : 1), sqy)
      // 錨點（精靈圖比例 → 本地座標；翻轉時 x 鏡像）
      const A = (ax: number, ay: number) => ({ x: (flip < 0 ? 0.5 - ax : ax - 0.5) * w, y: (ay - 1) * h })
      const head = A(P.head[0], P.head[1])
      const back = A(P.back[0], P.back[1])
      const nose = A(P.nose[0], P.nose[1])
      const hw = P.hw * w

      // 背後：披風 / 天使翼
      if (has('pet_wings')) {
        const flap = Math.sin(time * (walking || jumping ? 10 : 2.6)) * 0.3
        for (const sgn of [-1, 1]) {
          g.save()
          g.translate(back.x, back.y - h * 0.04)
          g.scale(flip < 0 ? -1 : 1, 1)
          g.rotate(sgn * (0.55 + flap) - (sgn > 0 ? 0 : 0))
          g.lineWidth = 2
          g.strokeStyle = LINE
          for (let i = 0; i < 4; i++) ell(g, sgn * (0.07 * w + i * 0.05 * w), -0.06 * h - i * 0.035 * h, 0.1 * w - i * 0.012 * w, 0.034 * h, '#ffffff', sgn * (-0.3 - i * 0.16))
          g.restore()
        }
      }
      if (has('pet_cape_royal')) {
        const fl = Math.sin(walking ? ph * 0.5 : time * 2) * 0.02 * w
        g.lineWidth = 2.2
        g.strokeStyle = LINE
        g.fillStyle = '#c8142e'
        g.beginPath()
        g.moveTo(head.x - hw * 0.35, head.y + hw * 0.5)
        g.quadraticCurveTo(back.x - 0.2 * w + fl, back.y + 0.05 * h, back.x - 0.12 * w + fl * 1.5, back.y + 0.28 * h)
        g.lineTo(back.x + 0.2 * w + fl * 1.5, back.y + 0.28 * h)
        g.quadraticCurveTo(back.x + 0.26 * w + fl, back.y, head.x + hw * 0.4, head.y + hw * 0.5)
        g.closePath()
        g.fill()
        g.stroke()
      }

      // 精靈圖本體
      fade = Math.max(0, fade - dtNow / 0.18)
      if (fade > 0 && prevPose !== pose) {
        const PP = POSES[prevPose]
        const ps = getSprite(PP.key).canvas
        const ph2 = PP.h * s
        const pw2 = (ps.width / ps.height) * ph2
        const pflip = prevPose === 'idle' ? 1 : cat.face > 0 ? -1 : 1
        g.save()
        g.globalAlpha = fade
        g.scale(pflip, 1)
        g.drawImage(ps, -pw2 / 2, -ph2, pw2, ph2)
        g.restore()
      }
      g.save()
      g.globalAlpha = 1 - fade * 0.6
      g.scale(flip, 1)
      g.drawImage(spr, -w / 2, -h, w, h)
      g.restore()

      // 前面：小丑鼻 / 巫師帽（綁頭部座標）
      if (has('pet_clown_nose')) {
        g.lineWidth = 2
        g.strokeStyle = LINE
        ell(g, nose.x, nose.y, hw * 0.075, hw * 0.075, '#ff1e3c')
        ell(g, nose.x - hw * 0.02, nose.y - hw * 0.025, hw * 0.02, hw * 0.015, 'rgba(255,255,255,0.85)', 0, false)
      }
      if (has('pet_hat_wizard')) {
        g.save()
        g.translate(head.x, head.y)
        const wob = Math.sin(time * 2.4) * 0.03 + (walking ? Math.sin(ph) * 0.05 : 0)
        g.rotate((flip < 0 ? 0.12 : -0.12) + wob)
        g.lineWidth = 2.2
        g.strokeStyle = LINE
        ell(g, 0, 0, hw * 0.62, hw * 0.1, '#4a1a8a')
        g.fillStyle = '#6a2ac0'
        g.beginPath()
        g.moveTo(-hw * 0.38, 0)
        g.quadraticCurveTo(-hw * 0.12, -hw * 0.55, hw * 0.12 + Math.sin(time * 3) * hw * 0.03, -hw * 0.95)
        g.quadraticCurveTo(hw * 0.2, -hw * 0.5, hw * 0.38, 0)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = '#f2c14e'
        g.fillRect(-hw * 0.38, -hw * 0.1, hw * 0.76, hw * 0.1)
        g.fillStyle = '#ffe066'
        g.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
          const a2 = a + Math.PI / 5
          g.lineTo(hw * 0.02 + Math.cos(a) * hw * 0.1, -hw * 0.45 + Math.sin(a) * hw * 0.1)
          g.lineTo(hw * 0.02 + Math.cos(a2) * hw * 0.04, -hw * 0.45 + Math.sin(a2) * hw * 0.04)
        }
        g.closePath()
        g.fill()
        g.restore()
      }
      g.restore()
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
      dtNow = dt
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
