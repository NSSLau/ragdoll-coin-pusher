import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { GAMES, type GameId } from '../data/games'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { BG_MINIGAME } from '../utils/SpriteAtlas'
import { Sprite } from '../components/Sprite'
import { WhackGame } from './WhackGame'
import { WheelGame } from './WheelGame'
import { GachaGame } from './GachaGame'
import type { GameProps } from './types'
import { Icon } from '../components/Icon'

const VIEW: Record<GameId, (p: GameProps) => React.ReactElement> = {
  whack: WhackGame,
  wheel: WheelGame,
  gacha: GachaGame,
}

type Phase = 'intro' | 'count' | 'play' | 'result'

/**
 * 小遊戲外殼：說明 → 玩家撳「開始」（先扣券）→ 3-2-1 → 局內倒數 → 結算積分。
 * 推幣機喺背後完全暫停，所以玩小遊戲冇任何損失。
 */
export function MiniGameShell() {
  const id = useGame((s) => s.activeGame)
  const tickets = useGame((s) => s.tickets)
  const points = useGame((s) => s.points)
  const best = useGame((s) => (id ? s.best[id] : 0)) ?? 0
  const def = id ? GAMES[id] : null

  const [phase, setPhase] = useState<Phase>('intro')
  const [count, setCount] = useState(3)
  const [timeLeft, setTimeLeft] = useState(def?.duration ?? 0)
  const [score, setScore] = useState(0)
  const [reward, setReward] = useState(0)
  const [isBest, setIsBest] = useState(false)
  const scoreRef = useRef(0)
  const ended = useRef(false)

  const addScore = useCallback((n: number) => {
    scoreRef.current += n
    setScore(scoreRef.current)
  }, [])

  const end = useCallback(() => {
    if (ended.current || !id) return
    ended.current = true
    const final = scoreRef.current
    const prevBest = useGame.getState().best[id] ?? 0
    const pts = useGame.getState().finishGame(id, final)
    setReward(pts)
    setIsBest(final > prevBest)
    setPhase('result')
    audio.win()
    audio.points()
    if (pts >= 50) void confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 }, zIndex: 200 })
  }, [id])

  const start = () => {
    if (!def) return
    if (!useGame.getState().consumeTicket(def.cost)) {
      useGame.getState().showToast('冇小遊戲券喇')
      return
    }
    scoreRef.current = 0
    setScore(0)
    setTimeLeft(def.duration)
    ended.current = false
    setCount(3)
    setPhase('count')
  }

  // 3-2-1
  useEffect(() => {
    if (phase !== 'count') return
    audio.countBeep(false)
    const t = window.setTimeout(() => {
      if (count > 1) setCount(count - 1)
      else {
        audio.countBeep(true)
        setPhase('play')
      }
    }, 650)
    return () => window.clearTimeout(t)
  }, [phase, count])

  // 局內倒數（分頁隱藏時 rAF 停，回來 dt 有上限，所以等於暫停）
  useEffect(() => {
    if (phase !== 'play' || !def) return
    let raf = 0
    let last = performance.now()
    let left = def.duration
    let lastWhole = Math.ceil(left)
    const tick = (now: number) => {
      left -= Math.min(0.1, (now - last) / 1000)
      last = now
      setTimeLeft(Math.max(0, left))
      const whole = Math.ceil(left)
      if (whole !== lastWhole) {
        lastWhole = whole
        if (whole <= 3 && whole > 0) audio.urgent()
      }
      if (left <= 0) {
        end()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, def, end])

  if (!id || !def) return null
  const Game = VIEW[id]
  const urgent = phase === 'play' && timeLeft <= 3

  return (
    <motion.div className="panel mg-panel" style={{ backgroundImage: `url(${BG_MINIGAME})` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="panel-inner">
        <div className="panel-head">
          <button
            className="back"
            onClick={() => {
              audio.click()
              if (phase === 'play') end()
              else useGame.getState().openPanel('hub')
            }}
          >
            {phase === 'play' ? '✕ 結束' : '← 返回'}
          </button>
          <h2>
            {def.emoji} {def.name}
          </h2>
          <span className="chip"><Icon name="ui_ticket" /> {tickets}</span>
        </div>

        {phase === 'intro' && (
          <div className="mg-center">
            <div className="mg-emoji">{def.emoji}</div>
            <p className="mg-rules">{def.rules}</p>
            <p className="mg-note">冇時間壓力：撳「開始」先會用券。推幣機已暫停，你嘅金幣同金幣池原封不動。</p>
            <p className="mg-best">最高紀錄：{best || '—'}</p>
            <button className="primary" disabled={tickets < def.cost} onClick={start}>
              {tickets < def.cost ? '券唔夠' : `開始（用 ${def.cost} 張券）`}
            </button>
          </div>
        )}

        {phase === 'count' && (
          <div className="mg-center">
            <motion.div key={count} className="mg-count" initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <Sprite name={`mg_num${count}` as 'mg_num3' | 'mg_num2' | 'mg_num1'} />
            </motion.div>
          </div>
        )}

        {phase === 'play' && (
          <div className="mg-play">
            <div className={`mg-timer${urgent ? ' urgent' : ''}`}>
              <i style={{ width: `${(timeLeft / def.duration) * 100}%` }} />
              <span>{timeLeft.toFixed(1)}s</span>
            </div>
            <div className="mg-score">分數 {score}</div>
            <Game timeLeft={timeLeft} duration={def.duration} score={score} addScore={addScore} finish={end} />
          </div>
        )}

        {phase === 'result' && (
          <div className="mg-center">
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="mg-emoji">
              🎉
            </motion.div>
            <p className="mg-rules">{def.resultText(score)}</p>
            {isBest && <p className="mg-best">🏅 新紀錄！</p>}
            <div className="mg-reward">
              積分 <b>+{reward}</b>
            </div>
            <p className="mg-note">目前積分 {points} · 小遊戲券剩 {tickets} 張</p>
            <div className="mg-actions">
              <button className="primary" disabled={tickets < def.cost} onClick={() => setPhase('intro')}>
                再玩一次
              </button>
              <button onClick={() => useGame.getState().openPanel('shop', 'exchange')}>去兌換獎品</button>
              <button onClick={() => useGame.getState().closePanel()}>返回遊戲</button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
