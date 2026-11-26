import { motion } from 'framer-motion'
import { Sprite } from './Sprite'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
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

const NAV: Array<{ icon: SpriteKey; label: string; action?: 'hub' | 'shop' | 'nest' | 'settings' }> = [
  { icon: 'icon_book', label: '圖鑑' },
  { icon: 'icon_trophy', label: '布偶貓小窩', action: 'nest' },
  { icon: 'icon_puzzle', label: '小遊戲', action: 'hub' },
  { icon: 'icon_bag', label: '兌換', action: 'shop' },
]

export function LobbyView() {
  const goGame = useGame((s) => s.goGame)
  const showToast = useGame((s) => s.showToast)
  const credits = useGame((s) => s.credits)
  const points = useGame((s) => s.points)
  const tickets = useGame((s) => s.tickets)
  const hero = HERO

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
            <span className="cur"><Sprite name="ui_coin" /><b>{Math.floor(credits)}</b></span>
            <span className="cur"><Sprite name="ui_star" /><b>{points}</b></span>
            <span className="cur"><Sprite name="ui_ticket" /><b>{tickets}</b></span>
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
            <span className="hot-tag">🔥 熱門</span>
            <span className="hero-name">{hero.name}</span>
          </motion.div>

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
