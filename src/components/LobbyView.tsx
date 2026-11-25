import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sprite } from './Sprite'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { BG_LOBBY, type SpriteKey } from '../utils/SpriteAtlas'

interface Theme {
  id: number
  name: string
  badge: SpriteKey
  blurb: string
  open: boolean
}

const THEMES: Theme[] = [
  { id: 1, name: '皇家海雙布偶馬戲團', badge: 'badge_ragdoll', blurb: '海雙布偶貓看板娘坐鎮，射幣疊塔搶 JP！', open: true },
  { id: 2, name: '螢光蘑菇森林', badge: 'badge_forest', blurb: '夜光蘑菇、橡果同螢火蟲，森林限定掉落。', open: false },
  { id: 3, name: '珍珠貝海灣', badge: 'badge_ocean', blurb: '海浪推幣，打開貝殼贏彩虹珍珠。', open: false },
  { id: 4, name: '星環黑洞太空', badge: 'badge_space', blurb: '失重推盤，穿過黑洞倍率翻倍。', open: false },
  { id: 5, name: '焦糖惡魔布丁', badge: 'badge_pudding', blurb: '黏黏糖漿地板，布丁魔王等你挑戰。', open: false },
]

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
  const [preview, setPreview] = useState<Theme | null>(null)

  const hero = THEMES[0]
  const others = THEMES.slice(1)

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
            <Sprite name="coin_paw" />
            <span>{Math.floor(credits)}</span>
            <em>⭐{points}</em>
            <em>🎟️{tickets}</em>
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

          <div className="theme-row">
            {others.map((t) => (
              <motion.button
                key={t.id}
                className="theme-chip"
                whileTap={{ scale: 0.93 }}
                onClick={() => {
                  audio.unlock()
                  audio.click()
                  setPreview(t)
                }}
                aria-label={`${t.name}（未解鎖）`}
              >
                <Sprite name={t.badge} className="chip-badge" />
                <Sprite name="lock" className="chip-lock" />
              </motion.button>
            ))}
          </div>
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

      <AnimatePresence>
        {preview && (
          <motion.div
            className="modal-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreview(null)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-badge">
                <Sprite name={preview.badge} />
                <Sprite name="lock" className="modal-lock" />
              </div>
              <h2>{preview.name}</h2>
              <p>{preview.blurb}</p>
              <p className="modal-soon">🔒 敬請期待 · 第 {preview.id} 台即將開放</p>
              <button className="modal-ok" onClick={() => setPreview(null)}>
                知道喇
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
