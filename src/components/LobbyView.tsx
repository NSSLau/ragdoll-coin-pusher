import { motion } from 'framer-motion'
import { Sprite } from './Sprite'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { BG_LOBBY, type SpriteKey } from '../utils/SpriteAtlas'
import { Icon } from './Icon'

interface Theme {
  id: number
  name: string
  badge: SpriteKey
  blurb: string
}

const HERO: Theme = {
  id: 1,
  name: '皇家海雙布偶馬戲團',
  badge: 'badge_ragdoll',
  blurb: '海雙布偶貓看板娘坐鎮，射幣疊塔搶 Royal JP！',
}

const NAV: Array<{ icon: SpriteKey; label: string; action?: 'hub' | 'shop' }> = [
  { icon: 'icon_book', label: '圖鑑' },
  { icon: 'icon_trophy', label: '排行' },
  { icon: 'icon_puzzle', label: '小遊戲', action: 'hub' },
  { icon: 'icon_bag', label: '兌換', action: 'shop' },
]

export function LobbyView() {
  const goGame = useGame((s) => s.goGame)
  const muted = useGame((s) => s.muted)
  const toggleMute = useGame((s) => s.toggleMute)
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
            <b>皇家海雙布偶馬戲團</b>
            <small>3D 推幣機</small>
          </div>
          <div className="lobby-credits">
            <Sprite name="ui_coin" />
            <span>{Math.floor(credits)}</span>
            <em><Icon name="ui_star" />{points}</em>
            <em><Icon name="ui_ticket" />{tickets}</em>
          </div>
        </header>

        <main className="lobby-main">
          <motion.button
            className="hero"
            whileTap={{ scale: 0.97 }}
            animate={{ y: [0, -6, 0] }}
            transition={{ y: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }}
            onClick={start}
            aria-label={`開始 ${hero.name}`}
          >
            <Sprite name={hero.badge} className="hero-badge" />
            <span className="hot-tag">🔥 熱門</span>
            <span className="hero-name">{hero.name}</span>
          </motion.button>

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
            className={muted ? 'is-muted' : ''}
            onClick={() => {
              toggleMute()
              audio.unlock()
              audio.click()
            }}
          >
            <Sprite name="icon_sound" />
            <span>{muted ? '靜音' : '音效'}</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
