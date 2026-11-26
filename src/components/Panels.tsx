import { AnimatePresence, motion } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { ShopView } from './ShopView'
const NestView = lazy(() => import('./NestView').then((m) => ({ default: m.NestView })))
const DexView = lazy(() => import('./DexView').then((m) => ({ default: m.DexView })))
import { SettingsView } from './SettingsView'
import { BranchShell } from '../minigames/BranchGames'

/** 全屏面板（獎品兌換 / 貓窩 / 圖鑑 / 設定 / 神秘彩球小遊戲）同全域 toast，大廳同機台共用 */
export function Panels() {
  const panel = useGame((s) => s.panel)
  const toast = useGame((s) => s.toast)
  const branchId = useGame((s) => s.branchId)
  // 玩小遊戲時音樂壓低啲，專心撳
  useEffect(() => {
    audio.setMusicLevel(panel === 'branch' ? 0.4 : 1)
  }, [panel])
  return (
    <>
      <AnimatePresence mode="wait">
        {panel === 'shop' && <ShopView key="shop" />}
        {panel === 'nest' && (
          <Suspense key="nest" fallback={null}>
            <NestView />
          </Suspense>
        )}
        {panel === 'dex' && (
          <Suspense key="dex" fallback={null}>
            <DexView />
          </Suspense>
        )}
        {panel === 'settings' && <SettingsView key="settings" />}
        {panel === 'branch' && <BranchShell key={`br-${branchId}`} />}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
