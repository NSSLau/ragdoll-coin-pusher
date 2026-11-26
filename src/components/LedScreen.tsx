import { AnimatePresence, motion } from 'framer-motion'
import { useGame, TOWER_GOAL, type Mood } from '../store/gameStore'
import { Sprite } from './Sprite'
import type { SpriteKey } from '../utils/SpriteAtlas'

const MOOD_SPRITE: Record<Mood, SpriteKey> = {
  idle: 'cat_wizard',
  shoot: 'cat_rocket',
  win: 'cat_cheer',
  jackpot: 'cat_royal',
  dizzy: 'cat_dizzy',
  sleep: 'cat_sleep',
}

const MOOD_LINE: Record<Mood, string> = {
  idle: '睇準缺口，撳掣發射！',
  shoot: '發射～',
  win: '食到幣喇！',
  jackpot: 'JACKPOT！！',
  dizzy: '冇幣喇，補幣先',
  sleep: 'Zzz… 撳掣喚醒我',
}

const fmt = (n: number) => Math.floor(n).toString().padStart(5, '0')

/** 上半部 LED 巨幕：Royal JP、動態布偶看板娘、圈塔進度 */
export function LedScreen() {
  const jp = useGame((s) => s.jp)
  const tower = useGame((s) => s.tower)
  const mood = useGame((s) => s.mood)
  const totalWin = useGame((s) => s.totalWin)
  const hits = useGame((s) => s.gateHits)
  const streak = useGame((s) => s.streak)

  return (
    <div className="led">
      <div className="led-jp">
        <div className="jp-cell" style={{ ['--c' as string]: '#ffd34d' }}>
          <span className="jp-label">ROYAL JP</span>
          <span className="jp-val">{fmt(jp)}</span>
        </div>
      </div>

      <div className="led-body">
        <div className="mascot">
          <AnimatePresence mode="wait">
            <motion.div
              key={mood}
              className="mascot-inner"
              initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
              animate={{
                scale: 1,
                opacity: 1,
                rotate: 0,
                y: mood === 'sleep' ? 0 : [0, -4, 0],
              }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{
                duration: 0.25,
                y: { duration: mood === 'jackpot' ? 0.35 : 1.4, repeat: Infinity, ease: 'easeInOut' },
              }}
            >
              <Sprite name={MOOD_SPRITE[mood]} className="mascot-img" />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="tower-box">
          <div className="tower-head">
            <Sprite name="coin_stack" className="tower-icon" />
            <span>運氣值</span>
            <span className="tower-count">
              <b>{tower}</b> / {TOWER_GOAL}
            </span>
          </div>
          <div className="tower-bar">
            <motion.div
              className="tower-fill"
              animate={{ width: `${(tower / TOWER_GOAL) * 100}%` }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}
            />
          </div>
          <div className="tower-win">
            {streak >= 2 ? `🔥連中 ${streak}` : MOOD_LINE[mood]} · 命中 {hits} · 總贏 {Math.floor(totalWin)}
          </div>
        </div>
      </div>
    </div>
  )
}
