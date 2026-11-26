import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Sprite } from '../components/Sprite'
import { audio } from '../utils/AudioFX'
import type { GameProps } from './types'

const GOAL = 40

/** 扭蛋狂搖：8 秒內狂撳，搖滿 40 下提早開殼；搖得越多扭蛋越高級 */
export function GachaGame({ score, addScore, finish }: GameProps) {
  const [wob, setWob] = useState(0)
  const done = useRef(false)
  const taps = useRef(0)

  const tap = () => {
    if (done.current) return
    taps.current += 1
    addScore(1)
    setWob((w) => w + 1)
    audio.shake()
    if (taps.current >= GOAL) {
      done.current = true
      audio.pop()
      window.setTimeout(finish, 450)
    }
  }

  return (
    <div className="gacha" onPointerDown={tap}>
      <div className="gacha-count">
        <b>{score}</b> / {GOAL}
      </div>
      <div className="gacha-bar">
        <motion.i animate={{ width: `${Math.min(100, (score / GOAL) * 100)}%` }} transition={{ duration: 0.08 }} />
      </div>
      <motion.div
        key={wob}
        className="gacha-ball"
        animate={{ rotate: [0, -9, 9, -5, 0], y: [0, -8, 0] }}
        transition={{ duration: 0.18 }}
      >
        <Sprite name="mg_gacha" />
      </motion.div>
      <Sprite
        key={score >= GOAL ? 'open' : 'egg'}
        name={score >= GOAL ? 'mg_egg_open' : score >= 28 ? 'mg_egg_silver' : score >= 16 ? 'mg_egg_bronze' : 'mg_egg_bronze'}
        className={`gacha-egg${score >= GOAL ? ' open' : ''}`}
      />
      <div className="gacha-hint">{score >= GOAL ? '開殼！' : '狂撳！狂撳！'}</div>
    </div>
  )
}
