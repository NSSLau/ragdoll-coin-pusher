import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { LobbyView } from './components/LobbyView'
import { Panels } from './components/Panels'
import { useGame } from './store/gameStore'
import { BG_LOBBY, loadAtlas } from './utils/SpriteAtlas'
import { audio } from './utils/AudioFX'

// 3D 引擎 (three + rapier wasm) 體積大，入遊戲先載入，大廳可以即刻開
const loadCabinet = () => import('./components/GameCabinetView').then((m) => ({ default: m.GameCabinetView }))
const GameCabinetView = lazy(loadCabinet)

/** 3D 錯誤隔離：機台任何渲染錯誤只影響機台畫面，大廳 / 貓窩 / 設定照常可用 */
class CabinetBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

/** WebGL 失敗 / 載入逾時降級提示 */
function CabinetFallback({ reason, onRetry, onBack }: { reason: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="cabinet-fallback">
      <div className="loading-card">
        <div>⚠️ 3D 機台暫時未能啟動</div>
        <small>{reason}</small>
        <div className="fb-btns">
          <button onClick={onRetry}>重試</button>
          <button onClick={onBack}>返回大廳</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const view = useGame((s) => s.view)
  const engineReady = useGame((s) => s.engineReady)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  // 3D 機台只喺玩家第一次撳「開始遊戲」先掛載；大廳 / 貓窩 / 設定唔依賴 WebGL
  const [cabinetOn, setCabinetOn] = useState(false)
  const [cabinetKey, setCabinetKey] = useState(0)
  const [failReason, setFailReason] = useState<string | null>(null)

  useEffect(() => {
    const boot = (window as unknown as { __boot?: { progress(f: number): void; done(): void } }).__boot
    loadAtlas((done, total) => {
      setProgress(done / total)
      boot?.progress(done / total)
    })
      .then(() => {
        setReady(true)
        boot?.done() // 大廳優先：圖集一就緒就收起預載畫面
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        boot?.done()
      })
  }, [])

  // 玩家第一次入機台先掛載 3D；順手檢查 WebGL
  useEffect(() => {
    if (view !== 'game' || cabinetOn) return
    if (!hasWebGL()) {
      setFailReason('你嘅瀏覽器 / 裝置唔支援 WebGL。大廳、貓窩同設定仍然可以正常使用。')
    }
    setCabinetOn(true)
  }, [view, cabinetOn])

  // 大廳閒置時預先下載 3D 代碼（只下載，唔掛載 Canvas）
  useEffect(() => {
    if (!ready || cabinetOn) return
    const id = window.setTimeout(() => void loadCabinet(), 2500)
    return () => window.clearTimeout(id)
  }, [ready, cabinetOn])

  // 入咗機台 20 秒仲未就緒：當 WebGL 初始化失敗，提示重試 / 返大廳
  useEffect(() => {
    if (view !== 'game' || !cabinetOn || engineReady || failReason) return
    const id = window.setTimeout(() => setFailReason('載入逾時（可能係裝置唔支援或記憶體不足）。'), 20000)
    return () => window.clearTimeout(id)
  }, [view, cabinetOn, engineReady, failReason, cabinetKey])

  const retry = useCallback(() => {
    useGame.setState({ engineReady: false })
    setFailReason(null)
    setCabinetKey((k) => k + 1)
  }, [])
  const back = useCallback(() => {
    useGame.setState({ engineReady: false })
    setFailReason(null)
    setCabinetOn(false)
    setCabinetKey((k) => k + 1)
    useGame.getState().goLobby()
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
  return (
    <>
      {view === 'lobby' && <LobbyView />}
      {/* 機台：第一次入先掛載，之後常駐（大廳時隱藏 + 暫停渲染）；任何錯誤隔離喺 boundary 入面 */}
      {cabinetOn && !failReason && (
        <div className={`cabinet-host${view === 'game' ? ' on' : ''}`}>
          <CabinetBoundary key={cabinetKey} onFail={() => setFailReason('3D 畫面出現錯誤。')}>
            <Suspense fallback={null}>
              <GameCabinetView active={view === 'game'} />
            </Suspense>
          </CabinetBoundary>
        </div>
      )}
      {view === 'game' && cabinetOn && !engineReady && !failReason && (
        <div className="cabinet-fallback loading-veil">
          <div className="loading-card">載入 3D 機台…</div>
        </div>
      )}
      {view === 'game' && failReason && <CabinetFallback reason={failReason} onRetry={retry} onBack={back} />}
      <Panels />
    </>
  )
}
