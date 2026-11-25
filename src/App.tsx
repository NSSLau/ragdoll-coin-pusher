import { lazy, Suspense, useEffect, useState } from 'react'
import { LobbyView } from './components/LobbyView'
import { useGame } from './store/gameStore'
import { BG_LOBBY, loadAtlas } from './utils/SpriteAtlas'
import { audio } from './utils/AudioFX'

// 3D 引擎 (three + rapier wasm) 體積大，入遊戲先載入，大廳可以即刻開
const GameCabinetView = lazy(() =>
  import('./components/GameCabinetView').then((m) => ({ default: m.GameCabinetView })),
)

function LoadingCard({ text }: { text: string }) {
  return (
    <div className="loading" style={{ backgroundImage: `url(${BG_LOBBY})` }}>
      <div className="loading-card">{text}</div>
    </div>
  )
}

export default function App() {
  const view = useGame((s) => s.view)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    loadAtlas((done, total) => setProgress(done / total))
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // iOS Safari 無視 user-scalable=no，要自己擋雙指縮放
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', block)
    return () => document.removeEventListener('gesturestart', block)
  }, [])

  // 任何第一次互動都解鎖 Web Audio
  useEffect(() => {
    const unlock = () => audio.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  if (error) {
    return (
      <div className="loading" style={{ backgroundImage: `url(${BG_LOBBY})` }}>
        <div className="loading-card">載入失敗：{error}</div>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="loading" style={{ backgroundImage: `url(${BG_LOBBY})` }}>
        <div className="loading-card">
          <div>載入緊素材…</div>
          <div className="loading-bar">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      </div>
    )
  }
  if (view === 'lobby') return <LobbyView />
  return (
    <Suspense fallback={<LoadingCard text="載入 3D 引擎…" />}>
      <GameCabinetView />
    </Suspense>
  )
}
