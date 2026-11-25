import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { audio } from '../utils/AudioFX'
import type { GameProps } from './types'

const VALUES = [30, 10, 50, 20, 100, 15, 60, 25]
const COLORS = ['#ffd34d', '#3fd27a', '#8a5cff', '#3aa0ff', '#ff4d6d', '#ffb347', '#2dd4bf', '#ff7ac8']
const SEG = 360 / VALUES.length

const gradient = `conic-gradient(from 0deg, ${COLORS.map((c, i) => `${c} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`

/** 幸運輪盤：轉速時快時慢，撳「停」令輪盤減速停落；指針（頂部）指住嘅格就係積分 */
export function WheelGame({ timeLeft, addScore, finish }: GameProps) {
  const [angle, setAngle] = useState(0)
  const [hit, setHit] = useState<number | null>(null)
  const st = useRef({ angle: 0, v: 0, t: 0, phase: 'spin' as 'spin' | 'stop' | 'done', lastSeg: 0 })

  const settle = () => {
    const s = st.current
    if (s.phase === 'done') return
    s.phase = 'done'
    const idx = Math.floor((((-s.angle % 360) + 360) % 360) / SEG)
    setHit(idx)
    addScore(VALUES[idx])
    audio.win()
    window.setTimeout(finish, 1100)
  }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = st.current
      s.t += dt
      if (s.phase === 'spin') s.v = 420 + 280 * Math.sin(s.t * 2.3)
      else if (s.phase === 'stop') {
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

  // 時間到仲未撳：即刻停落
  useEffect(() => {
    if (timeLeft <= 0.3 && st.current.phase === 'spin') settle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft])

  const stop = () => {
    audio.click()
    if (st.current.phase === 'spin') st.current.phase = 'stop'
  }

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" />
      <div className="wheel" style={{ transform: `rotate(${angle}deg)`, background: gradient }}>
        {VALUES.map((v, i) => (
          <span
            key={i}
            className={`wheel-label${hit === i ? ' is-hit' : ''}`}
            style={{ transform: `rotate(${i * SEG + SEG / 2}deg) translateY(calc(var(--S) * -0.33))` }}
          >
            {v}
          </span>
        ))}
        <div className="wheel-hub">🐾</div>
      </div>
      <motion.button
        className="big-btn"
        whileTap={{ scale: 0.92 }}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ scale: { duration: 0.6, repeat: Infinity } }}
        onPointerDown={stop}
        disabled={hit !== null}
      >
        {hit !== null ? `${VALUES[hit]} 分！` : '停！'}
      </motion.button>
    </div>
  )
}
