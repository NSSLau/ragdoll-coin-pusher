import { lazy, Suspense, useEffect, useState } from 'react'
import { LobbyView } from './components/LobbyView'
import { Panels } from './components/Panels'
import { useGame } from './store/gameStore'
import { BG_LOBBY, loadAtlas } from './utils/SpriteAtlas'
import { audio } from './utils/AudioFX'

// 3D 引擎 (three + rapier wasm) 體積大，入遊戲先載入，大廳可以即刻開
const GameCabinetView = lazy(() =>
  import('./components/GameCabinetView').then((m) => ({ default: m.GameCabinetView })),
)

export default function App() {
  const view = useGame((s) => s.view)
  const engineReady = useGame((s) => s.engineReady)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const boot = (window as unknown as { __boot?: { progress(f: number): void; done(): void } }).__boot
    loadAtlas((done, total) => {
      setProgress(done / total)
      boot?.progress(done / total)
    })
      .then(() => {
        setReady(true) // 引擎喺背景預載 + 預編譯 shader，完成先收起預載畫面（見下面 effect）
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        boot?.done()
      })
  }, [])

  // 預載畫面：圖集 + 3D 引擎（含 shader 預編譯暖機）都就緒先淡出；最多等 15 秒保底
  useEffect(() => {
    const boot = (window as unknown as { __boot?: { progress(f: number): void; done(): void } }).__boot
    if (ready && engineReady) boot?.done()
    if (!ready) return
    const id = window.setTimeout(() => boot?.done(), 15000)
    return () => window.clearTimeout(id)
  }, [ready, engineReady])

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
  return (
    <>
      {view === 'lobby' && <LobbyView />}
      {/* 機台常駐掛載（大廳時隱藏 + 暫停渲染）：背景預載、預編譯材質，入機台零卡頓 */}
      <div className={`cabinet-host${view === 'game' ? ' on' : ''}`}>
        <Suspense fallback={null}>
          <GameCabinetView active={view === 'game'} />
        </Suspense>
      </div>
      <Panels />
    </>
  )
}
