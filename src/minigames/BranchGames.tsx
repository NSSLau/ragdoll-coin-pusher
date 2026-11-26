import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useGame, type Reward } from '../store/gameStore'
import { SPECIAL_NAME, type SpecialKind } from '../engine/SpecialItems'
import { audio } from '../utils/AudioFX'
import { BG_MINIGAME } from '../utils/SpriteAtlas'
import { Sprite } from '../components/Sprite'

/* ------------------------------------------------------------------ */
/*  特殊道具分支小遊戲（推幣機暫停，結束領獎後先恢復）                      */
/*  球體類（扭蛋球 / 彩虹貓球）→ 扭蛋三選一 / 皇家命運大轉盤                  */
/*  寶石 / 鈴鐺 → 皇家猜大細翻倍挑戰 / 幸運翻牌                             */
/*  全部用程式 UI + 現有 sprite 佔位，獎勵數值集中喺下面，方便平衡               */
/* ------------------------------------------------------------------ */

interface Prize {
  label: string
  reward: Reward
}

const shuffle = <T,>(a: T[]): T[] => {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

/** 命運大轉盤 8 格 */
const WHEEL: Prize[] = [
  { label: '💰10', reward: { credits: 10 } },
  { label: '⭐40', reward: { points: 40 } },
  { label: '🎟️1', reward: { tickets: 1 } },
  { label: '🍀30', reward: { luck: 30 } },
  { label: '🏗️15', reward: { dock: 15 } },
  { label: '💰25', reward: { credits: 25 } },
  { label: '⭐100', reward: { points: 100 } },
  { label: '🎟️2', reward: { tickets: 2 } },
]
/** 扭蛋三選一 */
const EGGS: Prize[] = [
  { label: '🥉 金幣 +12', reward: { credits: 12 } },
  { label: '🥈 小遊戲券 +2 · 積分 +30', reward: { tickets: 2, points: 30 } },
  { label: '🥇 積分 +120', reward: { points: 120 } },
]
/** 幸運翻牌 6 張 */
const CARDS: Prize[] = [
  { label: '💰 金幣 +10', reward: { credits: 10 } },
  { label: '💰 金幣 +25', reward: { credits: 25 } },
  { label: '⭐ 積分 +60', reward: { points: 60 } },
  { label: '🍀 運氣值 +40', reward: { luck: 40 } },
  { label: '🏗️ 築塔 +15', reward: { dock: 15 } },
  { label: '🎟️ 小遊戲券 +1', reward: { tickets: 1 } },
]
/** 猜大細底注；每答啱 ×2，最多 4 次 */
const HL_BASE: Reward = { credits: 15, points: 50 }
const HL_MAX_WINS = 4

interface GameProps {
  done: (prize: Prize) => void
}

/* ---------- 皇家命運大轉盤（彩虹貓球） ---------- */
function FateWheel({ done }: GameProps) {
  const SEG = 360 / WHEEL.length
  const [angle, setAngle] = useState(0)
  const [hit, setHit] = useState<number | null>(null)
  const st = useRef({ angle: Math.random() * 360, v: 0, t: 0, phase: 'spin' as 'spin' | 'stop' | 'done', lastSeg: 0 })

  const settle = () => {
    const s = st.current
    if (s.phase === 'done') return
    s.phase = 'done'
    const idx = Math.floor(((((-s.angle % 360) + 360) % 360) + SEG / 2) / SEG) % WHEEL.length
    setHit(idx)
    audio.win()
    window.setTimeout(() => done(WHEEL[idx]), 900)
  }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = st.current
      s.t += dt
      if (s.phase === 'spin') {
        s.v = 420 + 280 * Math.sin(s.t * 2.3)
        if (s.t > 7) s.phase = 'stop'
      } else if (s.phase === 'stop') {
        s.v *= Math.exp(-2.6 * dt)
        if (s.v < 6) settle()
      }
      if (s.phase !== 'done') {
        s.angle += s.v * dt
        const seg = Math.floor(s.angle / SEG)
        if (seg !== s.lastSeg) {
          s.lastSeg = seg
          audio.wheelTick()
        }
        setAngle(s.angle)
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="wheel-wrap">
      <Sprite name="mg_pointer" className="wheel-pointer" />
      <div className="wheel" style={{ transform: `rotate(${angle}deg)` }}>
        <Sprite name="mg_wheel" className="wheel-art" />
        {WHEEL.map((p, i) => (
          <span
            key={i}
            className={`wheel-label${hit === i ? ' is-hit' : ''}`}
            style={{ transform: `rotate(${i * SEG}deg) translateY(calc(var(--S) * -0.33))` }}
          >
            {p.label}
          </span>
        ))}
        <Sprite name="mg_hub" className="wheel-hub" />
      </div>
      <motion.button
        className="big-btn"
        whileTap={{ scale: 0.92 }}
        onPointerDown={() => {
          audio.click()
          if (st.current.phase === 'spin') st.current.phase = 'stop'
        }}
        disabled={hit !== null}
      >
        {hit !== null ? WHEEL[hit].label : '停！'}
      </motion.button>
    </div>
  )
}

/* ---------- 驚喜扭蛋三選一（粉紅扭蛋球） ---------- */
function EggPick({ done }: GameProps) {
  const eggs = useMemo(() => shuffle(EGGS), [])
  const [pick, setPick] = useState<number | null>(null)
  const choose = (i: number) => {
    if (pick !== null) return
    setPick(i)
    audio.pop()
    window.setTimeout(() => done(eggs[i]), 1300)
  }
  return (
    <div className="bx-row">
      {eggs.map((e, i) => (
        <motion.button
          key={i}
          className={`bx-egg${pick === i ? ' picked' : ''}${pick !== null && pick !== i ? ' dim' : ''}`}
          whileTap={{ scale: 0.92 }}
          animate={pick === null ? { rotate: [0, -6, 6, 0] } : { rotate: 0 }}
          transition={pick === null ? { duration: 1.2, repeat: Infinity, delay: i * 0.2 } : {}}
          onClick={() => choose(i)}
        >
          <span className="bx-egg-ball">{pick === null ? '🥚' : pick === i ? '🎁' : '🥚'}</span>
          {pick !== null && <small>{e.label}</small>}
        </motion.button>
      ))}
    </div>
  )
}

/* ---------- 幸運翻牌（貓咪鈴鐺） ---------- */
function CardFlip({ done }: GameProps) {
  const cards = useMemo(() => shuffle(CARDS), [])
  const [pick, setPick] = useState<number | null>(null)
  const choose = (i: number) => {
    if (pick !== null) return
    setPick(i)
    audio.pop()
    window.setTimeout(() => done(cards[i]), 1400)
  }
  return (
    <div className="bx-grid">
      {cards.map((c, i) => (
        <motion.button
          key={i}
          className={`bx-card${pick === i ? ' picked' : ''}${pick !== null && pick !== i ? ' dim' : ''}`}
          whileTap={{ scale: 0.94 }}
          onClick={() => choose(i)}
        >
          {pick === null ? <span className="bx-q">🐾</span> : <small>{c.label}</small>}
        </motion.button>
      ))}
    </div>
  )
}

/* ---------- 皇家猜大細翻倍挑戰（皇家寶石） ---------- */
const RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const draw = (not?: number) => {
  let n = Math.floor(Math.random() * 13)
  while (n === not) n = Math.floor(Math.random() * 13)
  return n
}
function HighLow({ done }: GameProps) {
  const [cur, setCur] = useState(() => draw())
  const [wins, setWins] = useState(0)
  const [state, setState] = useState<'ask' | 'lose'>('ask')
  const mul = 2 ** wins
  const pot: Prize = {
    label: `💰${(HL_BASE.credits ?? 0) * mul} ⭐${(HL_BASE.points ?? 0) * mul}`,
    reward: { credits: (HL_BASE.credits ?? 0) * mul, points: (HL_BASE.points ?? 0) * mul },
  }
  const guess = (higher: boolean) => {
    if (state !== 'ask') return
    const next = draw(cur) // 同點數重抽（唔當輸）
    const ok = higher ? next > cur : next < cur
    setCur(next)
    if (ok) {
      audio.ting(3)
      const w = wins + 1
      setWins(w)
      if (w >= HL_MAX_WINS) window.setTimeout(() => done({ label: `🏆 連贏 ${w} 次！`, reward: { credits: (HL_BASE.credits ?? 0) * 2 ** w, points: (HL_BASE.points ?? 0) * 2 ** w } }), 700)
    } else {
      audio.error()
      setState('lose')
      window.setTimeout(() => done({ label: '猜錯，安慰獎 ⭐10', reward: { points: 10 } }), 1100)
    }
  }
  return (
    <div className="bx-hl">
      <div className="bx-hl-pot">
        目前獎池 <b>{pot.label}</b> <small>（連贏 {wins}/{HL_MAX_WINS}，每贏 ×2）</small>
      </div>
      <motion.div key={`${cur}-${wins}-${state}`} className={`bx-playing${state === 'lose' ? ' lose' : ''}`} initial={{ rotateY: 90, scale: 0.8 }} animate={{ rotateY: 0, scale: 1 }}>
        {RANK[cur]}
      </motion.div>
      <div className="bx-hl-btns">
        <button disabled={state !== 'ask' || wins >= HL_MAX_WINS} onClick={() => guess(false)}>⬇ 細</button>
        <button disabled={state !== 'ask' || wins >= HL_MAX_WINS} onClick={() => guess(true)}>⬆ 大</button>
      </div>
      <button className="primary" disabled={state !== 'ask' || wins >= HL_MAX_WINS} onClick={() => done(pot)}>
        {wins === 0 ? '收下底注' : '收錢離場'}
      </button>
    </div>
  )
}

const META: Record<SpecialKind, { title: string; hint: string; Game: (p: GameProps) => React.ReactElement }> = {
  gacha: { title: '驚喜扭蛋三選一', hint: '揀一粒扭蛋，睇下開出乜！', Game: EggPick },
  rainbow: { title: '皇家命運大轉盤', hint: '撳「停」，指針指住嘅格就係獎勵！', Game: FateWheel },
  gem: { title: '皇家猜大細翻倍挑戰', hint: '估下一張牌比而家大定細？啱就獎池翻倍，隨時可以收錢。', Game: HighLow },
  bell: { title: '幸運翻牌', hint: '6 張牌揀 1 張，翻開就係你嘅獎勵！', Game: CardFlip },
}

function rewardLines(r: Reward) {
  const l: string[] = []
  if (r.credits) l.push(`金幣 +${r.credits}`)
  if (r.points) l.push(`積分 +${r.points}`)
  if (r.tickets) l.push(`小遊戲券 +${r.tickets}`)
  if (r.luck) l.push(`運氣值 +${r.luck}`)
  if (r.dock) l.push(`加速築塔 +${r.dock} 枚`)
  return l
}

/** 分支小遊戲外殼：全屏蓋住推幣機（機台已暫停），領獎後 closeBranch 恢復 */
export function BranchShell() {
  const kind = useGame((s) => s.branch)
  const [result, setResult] = useState<Prize | null>(null)
  if (!kind) return null
  const { title, hint, Game } = META[kind]
  const finish = (p: Prize) => {
    if (result) return
    useGame.getState().grantReward(p.reward)
    setResult(p)
    audio.points()
    void confetti({ particleCount: 90, spread: 80, origin: { y: 0.5 }, zIndex: 200 })
  }
  return (
    <motion.div className="panel mg-panel" style={{ backgroundImage: `url(${BG_MINIGAME})` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="panel-inner">
        <div className="panel-head">
          <span />
          <h2>{title}</h2>
          <span className="chip">{SPECIAL_NAME[kind]}</span>
        </div>
        {!result ? (
          <div className="mg-center">
            <p className="mg-note">推幣機已暫停，完成後先會恢復。</p>
            <p className="mg-rules">{hint}</p>
            <Game done={finish} />
          </div>
        ) : (
          <div className="mg-center">
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="mg-emoji">🎉</motion.div>
            <p className="mg-rules">{result.label}</p>
            <div className="mg-reward">{rewardLines(result.reward).join(' · ') || '多謝參與'}</div>
            <button className="primary" onClick={() => { audio.click(); useGame.getState().closeBranch() }}>
              領獎並返回推幣
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
