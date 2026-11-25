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
  idle: '射幣疊高塔！',
  shoot: '貓耳炮發射～',
  win: '食到幣喇！',
  jackpot: 'JACKPOT！！',
  dizzy: '冇幣喇，補幣先',
  sleep: 'Zzz… 撳掣喚醒我',
}

const fmt = (n: number) => Math.floor(n).toString().padStart(5, '0')

/** 上半部 LED 巨幕：JP1/JP2/JP3、動態布偶看板娘、圈塔進度 */
export function LedScreen() {
  const jp = useGame((s) => s.jp)
  const tower = useGame((s) => s.tower)
  const mood = useGame((s) => s.mood)
  const totalWin = useGame((s) => s.totalWin)

  return (
    <div className="led">
      <div className="led-jp">
        {([
          ['JP1', jp.jp1, '#ff7ac8'],
          ['JP2', jp.jp2, '#5ee7ff'],
          ['JP3', jp.jp3, '#ffd34d'],
        ] as const).map(([label, v, color]) => (
          <div className="jp-cell" key={label} style={{ ['--c' as string]: color }}>
            <span className="jp-label">{label}</span>
            <span className="jp-val">{fmt(v)}</span>
          </div>
        ))}
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
            <span>圈塔進度</span>
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
            {MOOD_LINE[mood]} · 總贏分 {Math.floor(totalWin)}
          </div>
        </div>
      </div>
    </div>
  )
}
