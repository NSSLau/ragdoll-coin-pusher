import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sprite } from '../components/Sprite'
import { Roll } from '../components/Rolling'
import { ELEMENTS } from '../data/progress'
import type { SpriteKey } from '../utils/SpriteAtlas'
import { ALERT_TIME, BOSS_EVERY_M, PX_PER_M, SLASH_TIME, isBossAt, monsterAt, nextBossAt, useAdventure } from './adventureStore'

/* ------------------------------------------------------------------ */
/*  4 層視差舞台（Canvas 2D 程序繪製，rAF 60fps）                        */
/*  L1 星河城堡（最慢） → L2 馬戲帳篷樹林 → L3 石板路燈 → L4 魔法光塵（最快）  */
/*  捲動距離 = 里數 × PX_PER_M；里數只喺金幣推過正門先會增加                 */
/* ------------------------------------------------------------------ */

const SPEED = { far: 0.08, mid: 0.25, road: 0.6, dust: 1.2 }
const GROUND = 0.8 // 路面頂 (佔舞台高度比例)

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Star { x: number; y: number; r: number; p: number }
interface Castle { x: number; w: number; h: number; towers: Array<{ dx: number; w: number; h: number }> }
interface Prop { x: number; kind: 'tent' | 'pine' | 'round'; s: number; hue: number }
interface Dust { x: number; y: number; r: number; sp: number; p: number }

function makeWorld() {
  const r = rng(7)
  const stars: Star[] = Array.from({ length: 70 }, () => ({ x: r(), y: r() * 0.6, r: 0.4 + r() * 1.1, p: r() * 6 }))
  const castles: Castle[] = [0.05, 0.42, 0.78].map((x) => ({
    x,
    w: 0.14 + r() * 0.05,
    h: 0.26 + r() * 0.1,
    towers: [0, 1, 2].map((i) => ({ dx: (i - 0.5) * 0.045, w: 0.03 + r() * 0.012, h: 0.12 + r() * 0.1 })),
  }))
  const props: Prop[] = []
  let x = 0.02
  while (x < 1) {
    const k = r()
    props.push({ x, kind: k < 0.28 ? 'tent' : k < 0.66 ? 'pine' : 'round', s: 0.8 + r() * 0.5, hue: Math.floor(r() * 3) })
    x += 0.1 + r() * 0.07
  }
  const dust: Dust[] = Array.from({ length: 34 }, () => ({ x: r(), y: 0.15 + r() * 0.7, r: 0.8 + r() * 2.2, sp: 0.6 + r() * 0.9, p: r() * 6 }))
  return { stars, castles, props, dust }
}

const wrap = (v: number, m: number) => ((v % m) + m) % m

function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, scroll: number, time: number, alarm: number, world: ReturnType<typeof makeWorld>) {
  const gy = H * GROUND
  // —— L1：星河夜空 + 城堡 ——
  const sky = ctx.createLinearGradient(0, 0, 0, gy)
  sky.addColorStop(0, '#0a0524')
  sky.addColorStop(0.55, '#2c0f55')
  sky.addColorStop(1, '#8a2f78')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  // 星河帶
  ctx.save()
  ctx.globalAlpha = 0.22
  const band = ctx.createLinearGradient(0, gy * 0.1, W, gy * 0.6)
  band.addColorStop(0, 'rgba(255,200,255,0)')
  band.addColorStop(0.5, 'rgba(180,140,255,1)')
  band.addColorStop(1, 'rgba(255,200,255,0)')
  ctx.fillStyle = band
  ctx.beginPath()
  ctx.moveTo(0, gy * 0.55)
  ctx.lineTo(W, gy * 0.05)
  ctx.lineTo(W, gy * 0.25)
  ctx.lineTo(0, gy * 0.85)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  const tileFar = W * 2
  const offFar = wrap(scroll * SPEED.far, tileFar)
  for (const s of world.stars) {
    const tw = 0.55 + 0.45 * Math.sin(time * 2 + s.p)
    ctx.fillStyle = `rgba(255,240,200,${tw})`
    for (const k of [-1, 0, 1]) {
      const sx = s.x * tileFar - offFar + k * tileFar
      if (sx > -4 && sx < W + 4) ctx.fillRect(sx, s.y * gy, s.r, s.r)
    }
  }
  ctx.fillStyle = '#26104a'
  for (const k of [-1, 0, 1]) {
    for (const c of world.castles) {
      const cx = c.x * tileFar - offFar + k * tileFar
      const cw = c.w * W
      const ch = c.h * gy
      if (cx > W + 10 || cx + cw < -10) continue
      ctx.fillRect(cx, gy - ch, cw, ch)
      for (const t of c.towers) {
        const tx = cx + cw / 2 + t.dx * W
        const tw2 = t.w * W
        const th = t.h * gy
        ctx.fillRect(tx - tw2 / 2, gy - ch - th, tw2, th)
        ctx.beginPath()
        ctx.moveTo(tx - tw2 * 0.7, gy - ch - th)
        ctx.lineTo(tx, gy - ch - th - tw2 * 1.3)
        ctx.lineTo(tx + tw2 * 0.7, gy - ch - th)
        ctx.fill()
      }
      ctx.fillStyle = '#ffd34d'
      for (let i = 0; i < 4; i++) ctx.fillRect(cx + cw * (0.15 + i * 0.2), gy - ch * 0.7, 2.4, 3.6)
      ctx.fillStyle = '#26104a'
    }
  }

  // —— L2：馬戲帳篷 + 樹林 ——
  const tileMid = W * 1.6
  const offMid = wrap(scroll * SPEED.mid, tileMid)
  const hues = ['#4a1670', '#5a1a58', '#34185e']
  for (const k of [-1, 0, 1]) {
    for (const p of world.props) {
      const px = p.x * tileMid - offMid + k * tileMid
      if (px < -80 || px > W + 80) continue
      const base = gy + 2
      const s = p.s * H * 0.22
      ctx.fillStyle = hues[p.hue]
      if (p.kind === 'tent') {
        ctx.fillRect(px - s * 0.5, base - s * 0.55, s, s * 0.55)
        ctx.beginPath()
        ctx.moveTo(px - s * 0.62, base - s * 0.55)
        ctx.lineTo(px, base - s * 1.15)
        ctx.lineTo(px + s * 0.62, base - s * 0.55)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,90,120,0.55)'
        for (let i = -2; i <= 2; i += 2) {
          ctx.beginPath()
          ctx.moveTo(px + (i - 1) * s * 0.1, base - s * 0.55)
          ctx.lineTo(px, base - s * 1.15)
          ctx.lineTo(px + (i + 1) * s * 0.1, base - s * 0.55)
          ctx.fill()
        }
        ctx.fillStyle = '#ffd34d'
        ctx.fillRect(px - 0.5, base - s * 1.3, 1.2, s * 0.18)
        ctx.fillRect(px, base - s * 1.3, s * 0.12, s * 0.07)
      } else if (p.kind === 'pine') {
        ctx.fillRect(px - 2, base - s * 0.25, 4, s * 0.25)
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.moveTo(px - s * (0.38 - i * 0.07), base - s * (0.2 + i * 0.28))
          ctx.lineTo(px, base - s * (0.65 + i * 0.28))
          ctx.lineTo(px + s * (0.38 - i * 0.07), base - s * (0.2 + i * 0.28))
          ctx.fill()
        }
      } else {
        ctx.fillRect(px - 2, base - s * 0.35, 4, s * 0.35)
        ctx.beginPath()
        ctx.arc(px, base - s * 0.55, s * 0.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,211,77,0.55)'
        for (let i = 0; i < 3; i++) ctx.fillRect(px + Math.cos(i * 2.1) * s * 0.18, base - s * 0.55 + Math.sin(i * 2.1) * s * 0.16, 2, 2) // 掛燈
      }
    }
  }

  // —— L3：石板路 + 路燈 ——
  const road = ctx.createLinearGradient(0, gy, 0, H)
  road.addColorStop(0, '#5a3a78')
  road.addColorStop(1, '#2c1448')
  ctx.fillStyle = road
  ctx.fillRect(0, gy, W, H - gy)
  ctx.fillStyle = '#ffe08a'
  ctx.fillRect(0, gy, W, 2)
  const offRoad = scroll * SPEED.road
  ctx.strokeStyle = 'rgba(20,6,40,0.55)'
  ctx.lineWidth = 1.2
  const brickW = 46
  const rows = 3
  for (let r = 0; r < rows; r++) {
    const y0 = gy + ((H - gy) * r) / rows
    const y1 = gy + ((H - gy) * (r + 1)) / rows
    ctx.beginPath()
    ctx.moveTo(0, y1)
    ctx.lineTo(W, y1)
    const shift = r % 2 ? brickW / 2 : 0
    for (let x = -wrap(offRoad - shift, brickW); x < W; x += brickW) {
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
    }
    ctx.stroke()
  }
  const lampGap = W * 0.62
  for (let i = -1; i < 4; i++) {
    const lx = i * lampGap - wrap(offRoad, lampGap) + lampGap * 0.5
    if (lx < -40 || lx > W + 40) continue
    const lh = H * 0.34
    ctx.fillStyle = '#1b0a30'
    ctx.fillRect(lx - 1.5, gy - lh, 3, lh + 4)
    ctx.fillRect(lx - 6, gy + 2, 12, 3)
    const glow = ctx.createRadialGradient(lx, gy - lh, 1, lx, gy - lh, H * 0.28)
    glow.addColorStop(0, 'rgba(255,225,140,0.85)')
    glow.addColorStop(1, 'rgba(255,225,140,0)')
    ctx.fillStyle = glow
    ctx.fillRect(lx - H * 0.3, gy - lh - H * 0.3, H * 0.6, H * 0.6)
    ctx.fillStyle = '#fff3c0'
    ctx.beginPath()
    ctx.arc(lx, gy - lh, 3.2, 0, Math.PI * 2)
    ctx.fill()
  }

  // —— L4：魔法光塵（最近、最快；亦會上下浮動） ——
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const offDust = scroll * SPEED.dust
  for (const d of world.dust) {
    const x = wrap(d.x * W * 1.3 - offDust * d.sp, W * 1.3) - W * 0.15
    const y = d.y * H + Math.sin(time * 1.4 * d.sp + d.p) * 6
    const a = 0.35 + 0.35 * Math.sin(time * 2 + d.p)
    const g = ctx.createRadialGradient(x, y, 0, x, y, d.r * 3.2)
    g.addColorStop(0, `rgba(255,236,160,${a})`)
    g.addColorStop(1, 'rgba(255,200,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - d.r * 3.2, y - d.r * 3.2, d.r * 6.4, d.r * 6.4)
  }
  ctx.restore()

  // 稀有怪警報：紅色暗角閃爍
  if (alarm > 0) {
    const a = alarm * (0.25 + 0.2 * Math.sin(time * 14))
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7)
    v.addColorStop(0, 'rgba(255,40,70,0)')
    v.addColorStop(1, `rgba(255,40,70,${a * 2})`)
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
  }
}

/** 上方橫向冒險舞台（面板開住時暫停） */
export function AdventureStage({ paused }: { paused: boolean }) {
  const dist = useAdventure((s) => s.dist)
  const bossN = useAdventure((s) => s.bossN)
  const phase = useAdventure((s) => s.phase)
  const monHp = useAdventure((s) => s.monHp)
  const monMax = useAdventure((s) => s.monMax)
  const critId = useAdventure((s) => s.critId)
  const monHitId = useAdventure((s) => s.monHitId)
  const smashId = useAdventure((s) => s.smashId)
  const shieldBroken = useAdventure((s) => s.shieldBroken)
  const magic = useAdventure((s) => s.magic)
  const floats = useAdventure((s) => s.floats)
  const slashId = useAdventure((s) => s.slashId)
  const hopId = useAdventure((s) => s.hopId)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const ghost1 = useRef<HTMLDivElement>(null)
  const ghost2 = useRef<HTMLDivElement>(null)
  const world = useRef(makeWorld())
  const [frame, setFrame] = useState(0)
  const [lunge, setLunge] = useState(false)
  const anim = useRef({ walkT: 0, lastShown: 0, speed: 0, lungeAt: -9, hopAt: -9, frame: 0, lunge: false })

  const m = monsterAt(bossN)
  const boss = isBossAt(bossN)
  const showMonster = phase === 'alert' || phase === 'fight'

  useEffect(() => {
    if (slashId) anim.current.lungeAt = performance.now() / 1000
  }, [slashId])
  useEffect(() => {
    if (hopId) anim.current.hopAt = performance.now() / 1000
  }, [hopId])

  // 主迴圈：冒險時鐘 + 畫布 + 勇者程序動畫（全部 rAF，暫停時停）
  useEffect(() => {
    if (paused) return
    const cv = canvasRef.current
    const wrapEl = wrapRef.current
    if (!cv || !wrapEl) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let W = 0
    let H = 0
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      W = wrapEl.clientWidth
      H = wrapEl.clientHeight
      cv.width = Math.max(1, Math.round(W * dpr))
      cv.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapEl)
    let raf = 0
    let last = performance.now()
    const a = anim.current
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const t = now / 1000
      useAdventure.getState().tick(dt)
      const s = useAdventure.getState()
      // 速度（m/s）平滑：決定行路節奏
      const v = dt > 0 ? (s.shown - a.lastShown) / dt : 0
      a.lastShown = s.shown
      a.speed += (v - a.speed) * Math.min(1, dt * 8)
      const moving = Math.min(1, a.speed / 2.5)
      a.walkT += dt * (1.2 + 3.2 * moving) * (moving > 0.04 ? 1 : 0)
      const theta = a.walkT * Math.PI * 2

      if (W > 0 && H > 0) drawScene(ctx, W, H, s.shown * PX_PER_M, t, s.phase === 'alert' ? 1 : 0, world.current)

      // —— 勇者姿態（高度 = 容器高度比例，像素單位用 H） ——
      const pose = (tt: number) => {
        let x = 0
        let y = 0
        let sx = 1
        let sy = 1
        // 行路：雙拍彈跳（每步兩下）+ 落地壓扁
        if (s.phase === 'run' && moving > 0.04) {
          const b1 = Math.abs(Math.sin(theta))
          const b2 = Math.abs(Math.sin(theta * 2))
          y -= (b1 * 0.035 + b2 * 0.018) * H * moving
          const land = 1 - b1
          sy = 1 - 0.07 * land * moving + 0.04 * (1 - land) * moving
          sx = 1 + 0.06 * land * moving
        } else {
          sy = 1 + 0.02 * Math.sin(tt * 2.4) // 待機呼吸
          sx = 1 - 0.01 * Math.sin(tt * 2.4)
        }
        // 警報：下蹲蓄力 → 起跳 → 落地壓扁
        if (s.phase === 'alert') {
          const k = s.phaseT
          if (k < 0.3) {
            const e = k / 0.3
            sy = 1 - 0.24 * e
            sx = 1 + 0.16 * e
          } else if (k < 0.95) {
            const e = (k - 0.3) / 0.65
            y -= Math.sin(e * Math.PI) * 0.2 * H
            sy = 1 + 0.14 * Math.sin(e * Math.PI)
            sx = 1 - 0.07 * Math.sin(e * Math.PI)
          } else if (k < 1.2) {
            const e = 1 - (k - 0.95) / 0.25
            sy = 1 - 0.18 * e
            sx = 1 + 0.12 * e
          }
        }
        // 輕跳（無怪時命中）
        const hk = (tt - a.hopAt) / 0.3
        if (hk >= 0 && hk < 1) y -= Math.sin(hk * Math.PI) * 0.05 * H
        // 攻擊衝刺：先蓄後衝，殘影靠 lag 取樣
        const lk = (tt - a.lungeAt) / SLASH_TIME
        if (lk >= 0 && lk < 1) {
          const e = lk < 0.25 ? -lk * 0.6 : Math.sin(((lk - 0.25) / 0.75) * Math.PI)
          x = e * 0.22 * W
          sx *= 1 + 0.12 * Math.max(0, e)
          sy *= 1 - 0.06 * Math.max(0, e)
        }
        return { x, y, sx, sy }
      }
      const apply = (el: HTMLDivElement | null, p: { x: number; y: number; sx: number; sy: number }, opacity?: number) => {
        if (!el) return
        el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) scale(${p.sx.toFixed(3)},${p.sy.toFixed(3)})`
        if (opacity !== undefined) el.style.opacity = String(opacity)
      }
      apply(heroRef.current, pose(t))
      const lunging = t - a.lungeAt < SLASH_TIME + 0.15
      apply(ghost1.current, pose(t - 0.05), lunging ? 0.34 : 0)
      apply(ghost2.current, pose(t - 0.1), lunging ? 0.18 : 0)

      // 精靈幀：行路兩幀交替；攻擊用揮劍幀
      const wantFrame = s.phase === 'run' && moving > 0.04 ? (Math.sin(theta) > 0 ? 1 : 0) : 0
      const wantLunge = t - a.lungeAt < SLASH_TIME
      if (wantFrame !== a.frame) {
        a.frame = wantFrame
        setFrame(wantFrame)
      }
      if (wantLunge !== a.lunge) {
        a.lunge = wantLunge
        setLunge(wantLunge)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [paused])

  const heroSprite: SpriteKey = lunge ? 'adv_hero_slash' : frame ? 'adv_hero_walk2' : 'adv_hero_walk1'
  const target = nextBossAt(bossN)
  const remain = Math.max(0, Math.ceil(target - dist))
  const pct = Math.min(100, Math.max(0, ((dist - (target - BOSS_EVERY_M)) / BOSS_EVERY_M) * 100))

  return (
    <div className={`adv${boss && showMonster ? ' boss' : ''}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="adv-canvas" />

      <div className="adv-hud">
        <span className="adv-dist">
          🏃 <Roll value={Math.floor(dist)} ms={500} /> m
        </span>
        <div className="adv-next" aria-label="距離下一隻稀有怪">
          <i style={{ width: `${pct}%` }} />
          <span>{phase === 'run' ? `下一隻${isBossAt(bossN) ? ' BOSS' : '稀有怪'} 仲有 ${remain}m` : showMonster ? m.name : '打倒！'}</span>
        </div>
      </div>

      {/* 勇者（殘影兩層 + 本體） */}
      <div className="adv-hero">
        <div className="adv-ghost" ref={ghost2}>
          <Sprite name="adv_hero_slash" />
        </div>
        <div className="adv-ghost" ref={ghost1}>
          <Sprite name="adv_hero_slash" />
        </div>
        <div className="adv-sprite adv-pose" ref={heroRef}>
          <Sprite name={heroSprite} />
        </div>
      </div>

      {/* 稀有怪 / Boss */}
      <AnimatePresence>
        {showMonster && (
          <motion.div
            key={`m${bossN}`}
            className={`adv-mon${boss ? ' boss' : ''}`}
            initial={{ x: '130%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ y: '40%', opacity: 0, rotate: 25, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 150, damping: 17 }}
          >
            <div className="adv-mon-top">
              <span className={`adv-shield${shieldBroken ? ' broken' : ''}`} style={{ ['--c' as string]: ELEMENTS[m.element].color }} title={`${ELEMENTS[m.element].name}屬性護盾`}>
                {ELEMENTS[m.element].emoji}
              </span>
              <div className="adv-hp mon">
                <i style={{ width: `${phase === 'fight' && monMax ? (monHp / monMax) * 100 : 100}%` }} />
              </div>
            </div>
            <motion.div
              className="adv-sprite adv-idle"
              animate={paused ? undefined : { scaleY: [1, 0.92, 1.06, 1], scaleX: [1, 1.06, 0.96, 1], y: [0, 0, -5, 0] }}
              transition={{ duration: boss ? 1.3 : 0.9, repeat: Infinity, ease: 'easeInOut', times: [0, 0.35, 0.7, 1] }}
            >
              <div className="adv-hitbox" key={`mh${monHitId}`}>
                <Sprite name={m.sprite} className={monHitId ? 'adv-hit' : ''} />
              </div>
            </motion.div>
            {critId > 0 && <Sprite key={`c${critId}`} name="fx_hit_star" className="adv-crit" />}
          </motion.div>
        )}
      </AnimatePresence>

      {magic && phase === 'fight' && <div key={`mg${magic.id}`} className={`adv-magic ${magic.el}`} />}
      {smashId > 0 && phase === 'fight' && <Sprite key={`s${smashId}`} name="adv_giant_paw" className="adv-paw" />}

      <div className="adv-floats">
        <AnimatePresence>
          {floats.map((f) => (
            <motion.span
              key={f.id}
              className={`adv-float ${f.kind}`}
              initial={{ y: 0, opacity: 1, scale: f.kind === 'smash' || f.kind === 'crit' ? 1.4 : 1 }}
              animate={{ y: -26, opacity: 0, scale: 1 }}
              transition={{ duration: 0.9 }}
              onAnimationComplete={() => useAdventure.setState((s) => ({ floats: s.floats.filter((x) => x.id !== f.id) }))}
            >
              {f.text}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {phase === 'alert' && <div className="adv-banner warn" style={{ animationDuration: `${ALERT_TIME / 4}s` }}>⚠ {boss ? 'BOSS' : '稀有魔物'}出現！{ELEMENTS[m.element].emoji}{ELEMENTS[m.element].name}盾</div>}
      {phase === 'win' && <div className="adv-banner good">打倒！金幣雨 ×20 · 築塔 +15 · 已記入圖鑑</div>}
    </div>
  )
}
