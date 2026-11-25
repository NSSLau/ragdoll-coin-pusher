import { motion } from 'framer-motion'
import { GAME_LIST } from '../data/games'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'

/** 小遊戲大堂：揀一款，入去先扣券，冇任何倒數邀請 */
export function MiniGameHub() {
  const tickets = useGame((s) => s.tickets)
  const best = useGame((s) => s.best)
  const points = useGame((s) => s.points)

  return (
    <motion.div className="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="panel-inner">
        <div className="panel-head">
          <button className="back" onClick={() => useGame.getState().closePanel()}>
            ← 返回
          </button>
          <h2>🎮 小遊戲</h2>
          <span className="chip">🎟️ {tickets}</span>
        </div>

        <p className="panel-note">
          隨時玩、冇時間限制。入去之後推幣機會暫停，唔使擔心金幣池。小遊戲券可以由疊塔、Jackpot、每射 100 幣獲得，亦可以用積分兌換。
        </p>

        <div className="mg-list">
          {GAME_LIST.map((g) => (
            <motion.button
              key={g.id}
              className="mg-card"
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                audio.click()
                useGame.getState().selectGame(g.id)
              }}
            >
              <span className="mg-card-emoji">{g.emoji}</span>
              <span className="mg-card-body">
                <b>{g.name}</b>
                <small>{g.tagline}</small>
                <small>最高紀錄：{best[g.id] ?? '—'}</small>
              </span>
              <span className="mg-card-go">玩</span>
            </motion.button>
          ))}
        </div>

        <div className="panel-foot">
          <span>⭐ 積分 {points}</span>
          <button onClick={() => useGame.getState().openPanel('shop', 'exchange')}>🎁 兌換獎品</button>
        </div>
      </div>
    </motion.div>
  )
}
