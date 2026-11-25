import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { PusherScene } from './PusherScene'
import { LedScreen } from './LedScreen'
import { Sprite } from './Sprite'
import type { EngineEvents, PusherEngine } from '../engine/PusherEngine'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { BG_TABLET, CABINET_FRAME } from '../utils/SpriteAtlas'

const HOLD_INTERVAL = 150 // 長按連發間隔 (ms)
const TURBO_INTERVAL = 230 // Turbo 自動連發間隔 (ms)

const TIER_NAME = { 1: 'JP1', 2: 'JP2', 3: 'JP3' } as const

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
  const paused = panel !== 'none' // 小遊戲／兌換面板開住：推幣機完全暫停
  const [shaking, setShaking] = useState(false)
  const recent = useRef<number[]>([])
  const burstLvl = useRef(0)
  const [dpr, setDpr] = useState(1.5)
  const [canvasKey, setCanvasKey] = useState(0)
  const [lost, setLost] = useState(false)
  const onContextLost = useCallback(() => setLost(true), [])
  const onDecline = useCallback(() => setDpr((d) => (d > 1 ? 1 : d)), []) // 掉幀就降畫質

  // 物理引擎 → store / 音效 嘅橋
  const events = useMemo<EngineEvents>(
    () => ({
      onCollect: (_kind, value) => {
        const g = useGame.getState()
        g.collect(value)
        audio.ting(value)
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
        useGame.getState().awardJackpot(tier)
        audio.jackpot()
        if (tier === 3) window.setTimeout(() => audio.crash(), 250)
        burst(true)
      },
      onTowerSpawn: () => {
        audio.magic()
        const g = useGame.getState()
        g.addPoints(10)
        g.addTicket(1)
      },
      onClink: () => audio.clink(),
      onPusherTurn: () => audio.clunk(),
      onStack: (i) => audio.stackTick(i),
    }),
    [],
  )

  const fire = useCallback((): boolean => {
    audio.unlock()
    const engine = engineRef.current
    if (!engine) return false
    const r = useGame.getState().spend()
    if (!r.ok) {
      audio.error()
      return false
    }
    if (!engine.shoot()) {
      // 引擎冇位射：退返個幣，唔好白白扣
      useGame.getState().refund(r.towerReady)
      return false
    }
    audio.shoot()
    if (r.towerReady) engine.spawnTower()
    return true
  }, [])

  const stopHold = useCallback(() => {
    if (holdTimer.current !== undefined) {
      window.clearInterval(holdTimer.current)
      holdTimer.current = undefined
    }
  }, [])

  const startHold = useCallback(() => {
    stopHold()
    fire()
    holdTimer.current = window.setInterval(() => {
      if (!fire()) stopHold()
    }, HOLD_INTERVAL)
  }, [fire, stopHold])

  const holdHandlers = {
    onPointerDown: startHold,
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
      audio.stopLoops()
    } else {
      audio.startLoops()
    }
  }, [paused, stopHold])
  useEffect(() => () => audio.stopLoops(), [])

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
      audio.stopLoops()
    }
    const onVis = () => {
      if (document.hidden) halt()
      else if (useGame.getState().panel === 'none') audio.startLoops()
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
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        startHold()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') stopHold()
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
        <LedScreen />

        <div className="rotate-hint">請將手機直向使用</div>

        <div className="play-area">
          <div className={`canvas-wrap${shaking ? ' shaking' : ''}`} {...holdHandlers}>
            <Canvas
              key={canvasKey}
              dpr={dpr}
              frameloop={paused ? 'never' : 'always'}
              camera={{ fov: 40, near: 0.1, far: 120 }}
              gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
              resize={{ scroll: false }}
            >
              <PusherScene engineRef={engineRef} events={events} onContextLost={onContextLost} onDecline={onDecline} />
            </Canvas>

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

          <div className="side-btns">
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
              className="side-btn"
              aria-label="兌換獎品"
              onClick={() => {
                audio.click()
                useGame.getState().openPanel('shop', 'exchange')
              }}
            >
              <Sprite name="icon_bag" />
              <span>⭐{points}</span>
            </button>
          </div>

          <div className="hud">
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

            <button className="hud-btn fire" aria-label="發射金幣" {...holdHandlers}>
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
                <div className="jackpot-title">{TIER_NAME[jackpotPop.tier]} JACKPOT</div>
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
