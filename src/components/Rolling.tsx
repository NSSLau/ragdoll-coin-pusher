import { useEffect, useRef, useState } from 'react'

/** 數字滾動：值變動時用 rAF 緩動追上目標（easeOutCubic），首次顯示唔滾動 */
export function useRolling(target: number, ms = 450): number {
  const [shown, setShown] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    const from = cur.current
    if (from === target) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      cur.current = from + (target - from) * e
      setShown(cur.current)
      if (k < 1) raf = requestAnimationFrame(tick)
      else cur.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

export function Roll({ value, pad = 0, ms }: { value: number; pad?: number; ms?: number }) {
  const v = useRolling(value, ms)
  const s = Math.round(v).toString()
  return <>{pad ? s.padStart(pad, '0') : s}</>
}
