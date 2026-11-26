import { motion } from 'framer-motion'
import { Sprite } from './Sprite'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { Roll } from './Rolling'
import { COSTUMES, DAILY, todayKey } from '../data/progress'
import { BG_LOBBY, type SpriteKey } from '../utils/SpriteAtlas'

interface Theme {
  id: number
  name: string
  badge: SpriteKey
  blurb: string
}

const HERO: Theme = {
  id: 1,
  name: '布偶推幣團',
  badge: 'badge_ragdoll',
  blurb: '海雙布偶貓看板娘坐鎮，射幣疊塔搶 Royal JP！',
}

const NAV: Array<{ icon: SpriteKey; label: string; action?: 'dex' | 'shop' | 'nest' | 'settings' }> = [
  { icon: 'icon_book', label: '圖鑑', action: 'dex' },
  { icon: 'icon_trophy', label: '布偶貓小窩', action: 'nest' },
  { icon: 'icon_bag', label: '兌換', action: 'shop' },
]

export function LobbyView() {
  const goGame = useGame((s) => s.goGame)
  const showToast = useGame((s) => s.showToast)
  const credits = useGame((s) => s.credits)
  const points = useGame((s) => s.points)
  const hero = HERO
  const costumes = useGame((s) => s.costumes)
  const daily = useGame((s) => s.daily)
  // 下一個目標：最近未擁有嘅裝束（按券差距）；全部擁有就睇每日任務進度
  const goal = (() => {
    const next = COSTUMES.filter((c) => !costumes[c.id]).sort((a, b) => a.cost - b.cost)[0]
    if (next) {
      const gap = next.cost - points
      return gap <= 0 ? `⭐ 積分夠喇！去貓窩換「${next.name}」` : `距離解鎖下一件裝束「${next.name}」仲差 ${gap} 積分`
    }
    const d = daily.date === todayKey() ? daily : null
    const open = DAILY.map((x) => ({ x, st: x.stages[Math.min(2, d?.claimed[DAILY.indexOf(x)] ?? 0)], have: d?.[x.key] ?? 0 })).find((o) => o.have < o.st.goal)
    return open ? `今日任務「${open.x.name}」：${open.have}/${open.st.goal}` : '今日任務已全部完成 🎉'
  })()

  const start = () => {
    audio.unlock()
    audio.click()
    goGame()
  }

  return (
    <div className="lobby" style={{ backgroundImage: `url(${BG_LOBBY})` }}>
      <div className="lobby-col">
        <header className="lobby-head">
          <Sprite name="plaque" className="plaque-img" />
          <div className="plaque-text">
            <b>布偶推幣團</b>
            <small>3D 推幣機</small>
          </div>
          <div className="lobby-credits">
            <span className="cur"><Sprite name="ui_coin" /><b><Roll value={Math.floor(credits)} /></b></span>
            <span className="cur"><Sprite name="ui_star" /><b><Roll value={points} /></b></span>
          </div>
        </header>

        <main className="lobby-main">
          <motion.div
            className="hero"
            animate={{ y: [0, -6, 0] }}
            transition={{ y: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }}
            role="img"
            aria-label={hero.name}
          >
            <span className="hero-art">
              <Sprite name={hero.badge} className="hero-badge hero-ring" />
              <Sprite name={hero.badge} className="hero-badge hero-core" />
            </span>
          </motion.div>

          <div className="next-goal">{goal}</div>

          <motion.button className="start-btn" whileTap={{ scale: 0.95 }} onClick={start}>
            <Sprite name="btn_start" />
            <span>開始遊戲</span>
          </motion.button>
        </main>

        <nav className="lobby-nav">
          {NAV.map((n) => (
            <button
              key={n.label}
              onClick={() => {
                audio.unlock()
                audio.click()
                if (n.action) useGame.getState().openPanel(n.action)
                else showToast(`${n.label}即將推出`)
              }}
            >
              <Sprite name={n.icon} />
              <span>{n.label}</span>
            </button>
          ))}
          <button
            onClick={() => {
              audio.unlock()
              audio.click()
              useGame.getState().openPanel('settings')
            }}
          >
            <Sprite name="icon_gear" />
            <span>設定</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
