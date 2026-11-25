import { useState } from 'react'
import type { Prize } from '../data/prizes'

/** 獎品圖：有 art 就載入 PNG，冇（或載入失敗）就用 emoji 佔位 */
export function PrizeArt({ prize, size = 72 }: { prize: Prize; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (prize.art && !failed) {
    return (
      <img
        src={`${import.meta.env.BASE_URL}assets/prizes/${prize.id}.png`}
        alt={prize.name}
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    )
  }
  return (
    <div
      className="prize-ph"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.52,
        background: `radial-gradient(circle at 35% 30%, #fff8 0%, ${prize.tint}cc 45%, ${prize.tint}55 100%)`,
        borderColor: prize.tint,
      }}
      aria-label={prize.name}
    >
      {prize.emoji}
    </div>
  )
}
