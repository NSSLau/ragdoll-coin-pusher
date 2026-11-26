import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sprite } from '../components/Sprite'
import { audio } from '../utils/AudioFX'
import type { GameProps } from './types'

interface Target {
  id: number
  golden: boolean
}
interface Float {
  id: number
  idx: number
  text: string
}

/** 貓爪急擊：9 個洞，貓仔彈出就撳。連擊加成，漏咗連擊歸零（冇其他懲罰） */
export function WhackGame({ addScore }: GameProps) {
  const holes = useRef<(Target | null)[]>(Array(9).fill(null)) // 邏輯用
  const [view, setView] = useState<(Target | null)[]>(() => Array(9).fill(null)) // 渲染用
  const [floats, setFloats] = useState<Float[]>([])
  const [combo, setCombo] = useState(0)
  const comboRef = useRef(0)
  const idRef = useRef(0)
  const t0 = useRef(0)

  const render = () => setView([...holes.current])
  const setComboBoth = (n: number) => {
    comboRef.current = n
    setCombo(n)
  }

  useEffect(() => {
    t0.current = performance.now()
    let alive = true
    const timers: number[] = []

    const spawn = () => {
      if (!alive) return
      const elapsed = (performance.now() - t0.current) / 1000
      const empty = holes.current.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0)
      if (empty.length) {
        const idx = empty[Math.floor(Math.random() * empty.length)]
        const golden = Math.random() < 0.15
        const id = ++idRef.current
        holes.current[idx] = { id, golden }
        render()
        const ttl = Math.max(520, (golden ? 680 : 980) - elapsed * 14)
        timers.push(
          window.setTimeout(() => {
            if (holes.current[idx]?.id === id) {
              holes.current[idx] = null // 走咗：連擊歸零
              setComboBoth(0)
              render()
            }
          }, ttl),
        )
      }
      timers.push(window.setTimeout(spawn, Math.max(330, 720 - elapsed * 20)))
    }
    spawn()
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
  }, [])

  const hit = (idx: number) => {
    const h = holes.current[idx]
    if (!h) {
      audio.miss()
      setComboBoth(0)
      return
    }
    holes.current[idx] = null
    const c = comboRef.current + 1
    setComboBoth(c)
    const mult = Math.min(3, 1 + Math.floor(c / 5) * 0.5)
    const gain = Math.round((h.golden ? 30 : 10) * mult)
    addScore(gain)
    audio.hit(h.golden)
    const fid = ++idRef.current
    setFloats((f) => [...f, { id: fid, idx, text: `+${gain}` }])
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== fid)), 600)
    render()
  }

  return (
    <div className="whack">
      <div className="whack-combo">{combo >= 3 ? `🔥 連擊 ×${combo}` : ' '}</div>
      <div className="whack-grid">
        {view.map((h, i) => (
          <button key={i} className="hole" onPointerDown={() => hit(i)} aria-label={`洞 ${i + 1}`}>
            <Sprite name="mg_hole" className="hole-art" />
            <AnimatePresence>
              {h && (
                <motion.div
                  key={h.id}
                  className="hole-cat"
                  initial={{ y: 50, scale: 0.5, opacity: 0 }}
                  animate={{ y: 0, scale: 1, opacity: 1 }}
                  exit={{ scale: 0.2, opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                >
                  <Sprite name={h.golden ? 'mg_cat_gold' : 'mg_cat_pop'} />
                </motion.div>
              )}
            </AnimatePresence>
            {floats
              .filter((f) => f.idx === i)
              .map((f) => (
                <motion.span
                  key={f.id}
                  className="float-score"
                  initial={{ y: 0, opacity: 1 }}
                  animate={{ y: -46, opacity: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  {f.text}
                </motion.span>
              ))}
          </button>
        ))}
      </div>
    </div>
  )
}
