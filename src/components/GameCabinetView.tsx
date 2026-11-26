import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { PusherScene } from './PusherScene'
import { LedScreen } from './LedScreen'
import { Sprite } from './Sprite'
import { Icon } from './Icon'
import type { EngineEvents, PusherEngine } from '../engine/PusherEngine'
import {
  BELL_EVERY_HITS,
  BELL_STREAK,
  DOCK_FEED_HIT,
  DOCK_FEED_LUCK,
  DOCK_FEED_PERFECT,
  GACHA_EVERY_HITS,
  useGame,
} from '../store/gameStore'
import { DOCK_LAYERS } from '../engine/TowerDock'
import { SPECIAL_NAME } from '../engine/SpecialItems'
import { useAdventure } from '../adventure/adventureStore'
import { audio } from '../utils/AudioFX'
import { BG_TABLET, CABINET_FRAME } from '../utils/SpriteAtlas'

const HOLD_INTERVAL = 260 // 長按連發間隔 (ms)，約 3.8 隻/秒
const TURBO_INTERVAL = 330 // Turbo 自動連發間隔 (ms)，約 3 隻/秒
const COMBO_LIFE = 950 // 連擊跳字壽命 (ms)，同 CSS combo-fly 一致
const COMBO_MAX = 4 // 同時最多幾個連擊跳字

/** 連擊跳字：每次隨機方向（左上 / 右上 / 垂直微弧）+ 微幅傾斜，飄出再淡出 */
interface ComboPopData {
  id: number
  n: number
  lvl: number
  x0: number // 起點 X 偏移 (cqw)：跟住命中嗰條線
  dx: number // 飄動 X (cqw)
  dy: number // 飄動 Y (cqw，負 = 向上)
  rot: number // 終點傾斜角 (deg)
}
let comboSeq = 0
function rollComboPop(n: number, lvl: number, lane: -1 | 0 | 1): ComboPopData {
  const r = Math.random()
  const side = r < 0.4 ? -1 : r < 0.8 ? 1 : 0 // 左上 / 右上 / 垂直微弧
  const dx = side === 0 ? (Math.random() - 0.5) * 8 : side * (7 + Math.random() * 9)
  const dy = -(12 + Math.random() * 9)
  const tilt = 5 + Math.random() * 9
  return {
    id: ++comboSeq,
    n,
    lvl,
    x0: lane * 14,
    dx,
    dy,
    rot: side === 0 ? (Math.random() < 0.5 ? -1 : 1) * tilt * 0.5 : side * tilt,
  }
}

function burst(big: boolean) {
  void confetti({
    particleCount: big ? 160 : 60,
    spread: big ? 100 : 70,
    startVelocity: 38,
    origin: { y: 0.55 },
    colors: ['#ffd34d', '#ff7ac8', '#5ee7ff', '#ffffff'],
    zIndex: 60,
    disableForReducedMotion: true,
  })
}

export function GameCabinetView() {
  const engineRef = useRef<PusherEngine | null>(null)
  const holdTimer = useRef<number | undefined>(undefined)

  const credits = useGame((s) => s.credits)
  const turbo = useGame((s) => s.turbo)
  const muted = useGame((s) => s.muted)
  const winPop = useGame((s) => s.winPop)
  const jackpotPop = useGame((s) => s.jackpotPop)
  const shots = useGame((s) => s.shots)
  const goLobby = useGame((s) => s.goLobby)
  const panel = useGame((s) => s.panel)
  const tickets = useGame((s) => s.tickets)
  const points = useGame((s) => s.points)
  const burstPop = useGame((s) => s.burstPop)
  const dock = useGame((s) => s.dock)
  const paused = panel !== 'none' // 小遊戲／兌換面板開住：推幣機完全暫停
  const [shaking, setShaking] = useState(false)
  const [gatePop, setGatePop] = useState<{ id: number; text: string; perfect: boolean } | null>(null)
  const [recoil, setRecoil] = useState(0)
  const [firing, setFiring] = useState(false) // 中間砲開火瞬間（第 2 格火花版）
  const [hitFx, setHitFx] = useState<{ id: number; lane: -1 | 0 | 1; lvl: number } | null>(null)
  const [comboPops, setComboPops] = useState<ComboPopData[]>([])
  const [flash5, setFlash5] = useState(0) // 5 連擊全畫面高光
  const [shakeLvl, setShakeLvl] = useState(0) // 命中星爆
  const [beamTick, setBeamTick] = useState(0) // 派彩光束
  const [slotFlash, setSlotFlash] = useState(0) // 金幣落槽閃光
  const lastFlash = useRef(0)
  const firingTimer = useRef(0)
  const [laneKick, setLaneKick] = useState<Record<number, number>>({})
  const recent = useRef<number[]>([])
  const burstLvl = useRef(0)
  const [dpr, setDpr] = useState(1.5)
  const [canvasKey, setCanvasKey] = useState(0)
  const [lost, setLost] = useState(false)
  const onContextLost = useCallback(() => setLost(true), [])
  const onDecline = useCallback(() => setDpr((d) => (d > 1 ? 1 : d)), []) // 掉幀就降畫質

  // 物理引擎 → store / 音效 嘅橋
  /** 連擊階梯特效：爆炸粒子 / 鏡頭震動 / 中央跳字隨連擊數升級 */
  const comboFx = useCallback((lvl: number, streak: number, lane: -1 | 0 | 1) => {
    const colors = [['#ffffff'], ['#ffffff', '#ffe9a8'], ['#ffd34d', '#fff3b0'], ['#ffd34d', '#ff9b2e', '#ff7ac8'], ['#b46cff', '#ffd34d', '#ff7ac8', '#ffffff']][lvl - 1]
    void confetti({
      particleCount: 8 + lvl * 14,
      spread: 40 + lvl * 14,
      startVelocity: 18 + lvl * 5,
      origin: { x: 0.5 + lane * 0.28, y: 0.38 },
      colors,
      scalar: 0.6 + lvl * 0.12,
      zIndex: 60,
      disableForReducedMotion: true,
    })
    if (lvl >= 2) {
      setShakeLvl(lvl)
      setShaking(true)
      window.setTimeout(() => setShaking(false), 300 + lvl * 60)
    }
    if (streak >= 2) {
      const pop = rollComboPop(streak, lvl, lane)
      setComboPops((list) => [...list.slice(-(COMBO_MAX - 1)), pop])
      window.setTimeout(() => setComboPops((list) => list.filter((p) => p.id !== pop.id)), COMBO_LIFE + 80)
    }
  }, [])

  const events = useMemo<EngineEvents>(() => {
    /** 運氣值滿：掉落皇家寶石 + 側方築塔大幅加速（唔再喺池中央直接生成塔） */
    const luckFull = (engine: PusherEngine) => {
      engine.feedDock(DOCK_FEED_LUCK)
      engine.dropSpecial('gem')
    }
    return {
      onCollect: (kind, value) => {
        // 闖關：銀幣落槽回血；金磚落槽召喚巨型貓爪必殺
        if (kind === 'bar') useAdventure.getState().smash()
        else useAdventure.getState().heal()
        const g = useGame.getState()
        g.collect(value)
        audio.ting(value)
        const t = performance.now()
        if (t - lastFlash.current > 140) {
          lastFlash.current = t
          setSlotFlash((n) => n + 1)
          setBeamTick((n) => n + 1)
        }
        // 爆幣：0.8 秒內跌 6 / 12 / 20 隻幣 → 一級比一級大
        const now = performance.now()
        const r = recent.current
        r.push(now)
        while (r.length && now - r[0] > 800) r.shift()
        const n = r.length
        if (n < 3) burstLvl.current = 0
        const lvl = n >= 20 ? 3 : n >= 12 ? 2 : n >= 6 ? 1 : 0
        if (lvl > burstLvl.current) {
          burstLvl.current = lvl
          audio.burst(lvl)
          g.setBurst(n, lvl as 1 | 2 | 3)
          g.addPoints(lvl * 5)
          setShaking(true)
          window.setTimeout(() => setShaking(false), 500)
          if (lvl >= 2) burst(false)
        }
      },
      onJackpot: (tier) => {
        if (!useGame.getState().tryJackpot(tier)) return // 擲唔中就算
        audio.jackpot()
        if (tier === 3) window.setTimeout(() => audio.crash(), 250)
        burst(true)
      },
      onTowerSpawn: () => {
        audio.magic()
        useGame.getState().addPoints(10)
      },
      onDockPush: () => {
        audio.clunk()
        useGame.getState().showToast('金幣塔推入池！🏗️')
        setShakeLvl(1)
        setShaking(true)
        window.setTimeout(() => setShaking(false), 420)
      },
      onDockChange: (layers, phase) => useGame.getState().setDock(layers, phase),
      onSpecialDrop: (kind) => {
        audio.magic()
        useGame.getState().showToast(`${SPECIAL_NAME[kind]}掉落！推落槽有獎 ✨`)
      },
      onSpecial: (kind) => {
        const g = useGame.getState()
        const rw = g.claimSpecial(kind)
        g.showToast(rw.text)
        if (kind === 'gem') audio.jackpot()
        else if (kind === 'gacha') audio.ticket()
        else audio.ting(5)
        burst(kind === 'gem')
        const engine = engineRef.current
        if (engine && rw.dockUnits > 0) engine.feedDock(rw.dockUnits)
        if (engine && rw.luckFull) luckFull(engine)
      },
      onSpecialLost: () => useGame.getState().showToast('道具跌入邊溝，冇獎勵 😿'),
      onGate: (hit, perfect, lane) => {
        const g = useGame.getState()
        const r = g.gateResult(hit, perfect, lane)
        const engine = engineRef.current
        if (hit) {
          audio.gateHit(perfect)
          g.addPoints(perfect ? 4 : 2)
          setGatePop({ id: Date.now(), text: perfect ? '正中！' : '命中！', perfect })
          const gs = useGame.getState() // gateResult 已更新連擊數同累計命中
          const st = gs.streak
          const lvl = Math.min(5, Math.max(1, st))
          setHitFx({ id: Date.now(), lane, lvl })
          comboFx(lvl, st, lane)
          useAdventure.getState().attack(lane) // 射中缺口 = 揮劍（中線暴擊 2 倍）
          if (r.ticket) g.addTicket(1)
          if (st >= 3 && engine && !r.bonus) engine.dropLaneCoins(lane, st - 2) // 3 連 +1、4 連 +2 枚額外銀幣
          if (r.bonus && engine) {
            engine.dropBar()
            g.showToast(`${st} COMBO！獎勵金磚 1 塊 🧱`)
            setFlash5((n) => n + 1)
          }
          if (engine) {
            // 命中 → 側方築塔進度；特定命中數 / 連擊 → 特殊道具由上方掉落
            engine.feedDock(perfect ? DOCK_FEED_PERFECT : DOCK_FEED_HIT)
            if (gs.gateHits % GACHA_EVERY_HITS === 0) engine.dropSpecial('gacha')
            if (gs.gateHits % BELL_EVERY_HITS === 0 || st % BELL_STREAK === 0) engine.dropSpecial('bell')
          }
        } else audio.gateMiss()
        if (r.luckFull && engine) luckFull(engine) // 運氣值滿：皇家寶石掉落 + 築塔大幅加速
      },
      onClink: () => audio.clink(),
      onGutter: () => audio.gutter(),
      onPusherTurn: () => audio.clunk(),
      onStack: (i) => audio.stackTick(i),
    }
  }, [comboFx])

  if (import.meta.env.DEV) (window as unknown as { __eng: () => PusherEngine | null }).__eng = () => engineRef.current

  const fire = useCallback((lane: -1 | 0 | 1 = 0): boolean => {
    audio.unlock()
    const engine = engineRef.current
    if (!engine) return false
    const r = useGame.getState().spend()
    if (!r.ok) {
      audio.error()
      return false
    }
    if (!engine.shoot(lane)) {
      // 引擎冇位射：退返個幣，唔好白白扣
      useGame.getState().refund()
      return false
    }
    audio.shoot()
    setRecoil((n) => n + 1)
    if (lane === 0) {
      setFiring(true)
      window.clearTimeout(firingTimer.current)
      firingTimer.current = window.setTimeout(() => setFiring(false), 130)
    }
    setLaneKick((k) => ({ ...k, [lane]: (k[lane] ?? 0) + 1 }))
    return true
  }, [])

  const stopHold = useCallback(() => {
    if (holdTimer.current !== undefined) {
      window.clearInterval(holdTimer.current)
      holdTimer.current = undefined
    }
  }, [])

  const startHold = useCallback(
    (lane: -1 | 0 | 1 = 0) => {
      stopHold()
      fire(lane)
      holdTimer.current = window.setInterval(() => {
        if (!fire(lane)) stopHold()
      }, HOLD_INTERVAL)
    },
    [fire, stopHold],
  )

  // 撳畫面左 / 中 / 右三分一 = 射對應嗰條線
  const laneFrom = (e: React.PointerEvent): -1 | 0 | 1 => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    return x < 0.33 ? -1 : x > 0.67 ? 1 : 0
  }

  const holdHandlers = {
    onPointerDown: (e: React.PointerEvent) => startHold(laneFrom(e)),
    onPointerUp: stopHold,
    onPointerLeave: stopHold,
    onPointerCancel: stopHold,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }

  // Turbo 自動連發
  useEffect(() => {
    if (!turbo) return
    const id = window.setInterval(() => {
      if (!fire()) useGame.getState().setTurbo(false)
    }, TURBO_INTERVAL)
    return () => window.clearInterval(id)
  }, [turbo, fire])

  // 面板開住就暫停：停連發、停機械聲；返嚟先再開
  useEffect(() => {
    if (paused) {
      stopHold()
      useGame.getState().setTurbo(false)
    }
  }, [paused, stopHold])

  // 命中提示自動收起
  useEffect(() => {
    if (!gatePop) return
    const id = window.setTimeout(() => setGatePop(null), 900)
    return () => window.clearTimeout(id)
  }, [gatePop])

  // 爆幣提示自動收起
  useEffect(() => {
    if (!burstPop) return
    const id = window.setTimeout(() => useGame.setState({ burstPop: null }), 1500)
    return () => window.clearTimeout(id)
  }, [burstPop])

  // 放手事件喺畫面外／切走 App／分頁入背景：一律停止連發同 Turbo，避免背景偷扣幣
  useEffect(() => {
    const halt = () => {
      stopHold()
      useGame.getState().setTurbo(false)
    }
    const onVis = () => {
      if (document.hidden) halt()
    }
    window.addEventListener('pointerup', stopHold)
    window.addEventListener('pointercancel', stopHold)
    window.addEventListener('blur', halt)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pointerup', stopHold)
      window.removeEventListener('pointercancel', stopHold)
      window.removeEventListener('blur', halt)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [stopHold])

  // 鍵盤：空白鍵按住連發
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space') {
        e.preventDefault()
        startHold(0)
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') startHold(-1)
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') startHold(1)
    }
    const up = (e: KeyboardEvent) => {
      if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) stopHold()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      stopHold()
    }
  }, [startHold, stopHold])

  // 閒置 10 秒，看板娘瞓覺
  useEffect(() => {
    const id = window.setTimeout(() => useGame.getState().setMood('sleep'), 10000)
    return () => window.clearTimeout(id)
  }, [shots])

  // 大獎自動收起
  useEffect(() => {
    if (!jackpotPop) return
    const id = window.setTimeout(() => useGame.getState().clearJackpot(), 3400)
    return () => window.clearTimeout(id)
  }, [jackpotPop])

  return (
    <div className="stage" style={{ backgroundImage: `url(${BG_TABLET})` }}>
      <div className="cabinet" style={{ backgroundImage: `url(${CABINET_FRAME})` }}>
        <LedScreen paused={paused} />

        <div className="rotate-hint">請將手機直向使用</div>

        <div className="play-area">
          <div className={`canvas-wrap${shaking ? ' shaking' : ''}`} style={{ ['--shk' as string]: shakeLvl * 0.35 }} {...holdHandlers}>
            <Canvas
              key={canvasKey}
              dpr={dpr}
              frameloop={paused ? 'never' : 'always'}
              camera={{ fov: 62, near: 0.1, far: 120 }}
              gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
              resize={{ scroll: false }}
            >
              <PusherScene engineRef={engineRef} events={events} onContextLost={onContextLost} onDecline={onDecline} />
            </Canvas>

            {([-1, 1] as const).map((lane) => (
              <motion.div
                key={`sg-${lane}-${laneKick[lane] ?? 0}`}
                className={`side-gun ${lane < 0 ? 'left' : 'right'}`}
                initial={{ y: laneKick[lane] ? 10 : 0 }}
                animate={{ y: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              >
                <Sprite name={lane < 0 ? 'cannon_left' : 'cannon_right'} />
              </motion.div>
            ))}

            <motion.div
              key={`gun-${recoil}`}
              className="gun"
              initial={{ y: recoil ? 14 : 0 }}
              animate={{ y: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            >
              <Sprite name={firing ? 'cannon_mid_fire' : 'cannon_mid'} className={firing ? 'is-fire' : ''} />
            </motion.div>

            {hitFx && (
              <Sprite
                key={hitFx.id}
                name="fx_hit_star"
                className={`fx-hit lane${hitFx.lane} cmb${hitFx.lvl}`}
                onAnimationEnd={() => setHitFx(null)}
              />
            )}
            {comboPops.map((p) => (
              <div
                key={p.id}
                className={`combo-pop cmb${p.lvl}`}
                style={{ ['--x0' as string]: p.x0, ['--dx' as string]: p.dx, ['--dy' as string]: p.dy, ['--rot' as string]: p.rot }}
              >
                {p.n} COMBO!
              </div>
            ))}
            <div className={`dock-chip ${dock.phase}`} aria-label="側方築塔進度">
              <i>🏗️</i>
              {dock.phase === 'build' ? (
                <span>築塔 <b>{dock.layers}</b>/{DOCK_LAYERS}</span>
              ) : dock.phase === 'retract' ? (
                <span>復位中…</span>
              ) : (
                <span>推塔入池！</span>
              )}
            </div>
            {flash5 > 0 && <div key={`f5-${flash5}`} className="flash5" />}
            {beamTick > 0 && <Sprite key={`pb-${beamTick}`} name="payout_beam" className="fx-beam" />}
            {slotFlash > 0 && <Sprite key={`sf-${slotFlash}`} name="fx_slot_flash" className="fx-slot" />}

            <AnimatePresence>
              {winPop && (
                <motion.div
                  key={winPop.id}
                  className="win-pop"
                  initial={{ y: 10, scale: 0.6, opacity: 0 }}
                  animate={{ y: -14, scale: 1, opacity: 1 }}
                  exit={{ y: -40, opacity: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  +{winPop.amount}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {gatePop && (
                <motion.div
                  key={gatePop.id}
                  className={`gate-pop${gatePop.perfect ? ' perfect' : ''}`}
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  {gatePop.text}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {burstPop && (
                <motion.div
                  key={burstPop.id}
                  className={`burst-pop lv${burstPop.level}`}
                  initial={{ scale: 0.3, opacity: 0, rotate: -8 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 1.3, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 14 }}
                >
                  {['', '爆幣！', '大爆幣！！', '超級爆幣！！！'][burstPop.level]}
                  <small>×{burstPop.count}</small>
                </motion.div>
              )}
            </AnimatePresence>

            {lost && (
              <div className="refill" onPointerDown={(e) => e.stopPropagation()}>
                <div>畫面中斷</div>
                <button
                  onClick={() => {
                    setLost(false)
                    setCanvasKey((k) => k + 1)
                  }}
                >
                  重新載入畫面
                </button>
              </div>
            )}

            {credits < 1 && !lost && (
              <div className="refill" onPointerDown={(e) => e.stopPropagation()}>
                <div>冇幣喇</div>
                <button
                  onClick={() => {
                    audio.click()
                    useGame.getState().refill()
                  }}
                >
                  補幣 +200
                </button>
              </div>
            )}
          </div>

          <div className="hud">
            <button
              className={`side-btn${tickets > 0 ? ' invite' : ''}`}
              aria-label="小遊戲"
              onClick={() => {
                audio.click()
                useGame.getState().openPanel('hub')
              }}
            >
              <Sprite name="icon_puzzle" />
              <span>小遊戲</span>
              {tickets > 0 && <i className="badge">{tickets}</i>}
            </button>
            <button
              className={`hud-btn turbo${turbo ? ' on' : ''}`}
              aria-pressed={turbo}
              aria-label="Turbo 自動連發"
              onClick={() => {
                audio.unlock()
                audio.click()
                useGame.getState().setTurbo(!turbo)
              }}
            >
              <Sprite name="btn_bolt" />
              <span className="hud-cap">TURBO</span>
            </button>

            <button
              className="hud-btn fire"
              aria-label="發射金幣"
              onPointerDown={() => startHold(0)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Sprite name="btn_paw_pink" />
              <span className="hud-cap">按住連發</span>
            </button>

            <div className="credit-panel">
              <Sprite name="panel_cat" />
              <div className="credit-text">
                <small>金幣</small>
                <b>{Math.floor(credits)}</b>
              </div>
            </div>
            <button
              className="side-btn"
              aria-label="兌換獎品"
              onClick={() => {
                audio.click()
                useGame.getState().openPanel('shop', 'exchange')
              }}
            >
              <Sprite name="icon_bag" />
              <span><Icon name="ui_star" />{points}</span>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {jackpotPop && (
            <motion.div
              key={jackpotPop.id}
              className="jackpot-pop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => useGame.getState().clearJackpot()}
            >
              <motion.div
                initial={{ scale: 0.3, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 180, damping: 12 }}
                className="jackpot-card"
              >
                <Sprite name="crown" className="jackpot-crown" />
                <div className="jackpot-title">ROYAL JP JACKPOT</div>
                <div className="jackpot-amount">+{jackpotPop.amount}</div>
                <Sprite name="cat_royal" className="jackpot-cat" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        className="icon-btn top-left"
        aria-label="返回大廳"
        onClick={() => {
          audio.click()
          goLobby()
        }}
      >
        <Sprite name="icon_arrow" />
      </button>
      <button
        className={`icon-btn top-right${muted ? ' is-muted' : ''}`}
        aria-label="切換音效"
        onClick={() => {
          useGame.getState().toggleMute()
          audio.click()
        }}
      >
        <Sprite name="icon_sound" />
      </button>
    </div>
  )
}
