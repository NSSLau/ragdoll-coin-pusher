/** 全屏面板 / 彈窗共用嘅彈性進出場（framer-motion spring） */
export const panelMotion = {
  initial: { opacity: 0, y: 36, scale: 0.94 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
  exit: { opacity: 0, y: 24, scale: 0.96, transition: { duration: 0.18 } },
}
