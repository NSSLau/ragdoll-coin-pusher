import { motion } from 'framer-motion'
import { useGame, luckGoal } from '../store/gameStore'
import { Sprite } from './Sprite'
import { getSprite } from '../utils/SpriteAtlas'
import { AdventureStage } from '../adventure/AdventureStage'
import { Roll } from './Rolling'

/** 上半部 LED 巨幕：Royal JP + 運氣值（頂行）、布偶貓勇者闖關舞台（下面） */
export function LedScreen({ paused }: { paused: boolean }) {
  const jp = useGame((s) => s.jp)
  const tower = useGame((s) => s.tower)
  const dimJp = useGame((s) => s.hudLayers === 0)
  const TOWER_GOAL = useGame((s) => luckGoal(s.upgrades.luck))

  return (
    <div className="led">
      <div className="led-top">
        <div className={`jp-cell${dimJp ? ' dim' : ''}`} style={{ ['--c' as string]: '#ffd34d' }}>
          <Sprite name="ui_jp_gold" className="jp-badge" />
          <span className="jp-label">ROYAL JP</span>
          <span className="jp-val"><Roll value={Math.floor(jp)} pad={5} ms={700} /></span>
        </div>

        <div className="luck-box" aria-label={`運氣值 ${tower} / ${TOWER_GOAL}`}>
          <Sprite name="ui_clover" className="tower-icon" />
          <div className="tower-bar">
            <motion.div
              className="tower-fill"
              animate={{ width: `${(tower / TOWER_GOAL) * 100}%` }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}
              style={{ backgroundImage: `url(${getSprite('ui_luck_fill').url})` }}
            />
            <Sprite name="ui_luck_frame" className="tower-frame" />
          </div>
          <span className="tower-count">
            <b>{tower}</b>/{TOWER_GOAL}
          </span>
        </div>
      </div>

      <AdventureStage paused={paused} />
    </div>
  )
}
