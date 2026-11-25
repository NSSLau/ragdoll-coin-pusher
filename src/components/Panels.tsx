import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '../store/gameStore'
import { MiniGameHub } from '../minigames/MiniGameHub'
import { MiniGameShell } from '../minigames/MiniGameShell'
import { ShopView } from './ShopView'

/** 全屏面板（小遊戲大堂 / 小遊戲 / 獎品兌換）同全域 toast，大廳同機台共用 */
export function Panels() {
  const panel = useGame((s) => s.panel)
  const toast = useGame((s) => s.toast)
  return (
    <>
      <AnimatePresence mode="wait">
        {panel === 'hub' && <MiniGameHub key="hub" />}
        {panel === 'shop' && <ShopView key="shop" />}
        {panel === 'minigame' && <MiniGameShell key="mg" />}
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
