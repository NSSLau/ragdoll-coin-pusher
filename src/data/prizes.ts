/**
 * 獎品目錄（資料先行，素材遲啲畫）
 *
 * 加美術：將圖放入 public/assets/prizes/<id>.png（建議 512×512 透明 PNG；由 scripts/slice_atlases.py 自動切 prizes-atlas 產生），
 * 然後喺下面對應獎品加 `art: true`。未加之前會用 emoji + 顏色佔位，唔會有 404 請求。
 */
export type PrizeKind = 'coins' | 'collectible'

export interface Prize {
  id: string
  name: string
  desc: string
  kind: PrizeKind
  /** coins 嘅數量 */
  amount?: number
  /** 所需積分 */
  cost: number
  /** collectible 最多擁有數量（預設 1） */
  limit?: number
  /** 佔位圖 */
  emoji: string
  tint: string
  /** 已放咗 public/assets/prizes/<id>.png 就設 true */
  art?: boolean
  comingSoon?: boolean
}


export const PRIZES: Prize[] = [
  { id: 'coins_s', name: '金幣袋（小）', desc: '即時加 60 銀幣', kind: 'coins', amount: 60, cost: 90, emoji: '👝', tint: '#f7c948', art: true },
  { id: 'coins_l', name: '金幣袋（大）', desc: '即時加 300 銀幣', kind: 'coins', amount: 300, cost: 420, emoji: '💰', tint: '#ff9b2e', art: true },

  { id: 'badge_crown', name: '皇冠貓徽章', desc: '收藏品 · 皇家海雙布偶嘅象徵', kind: 'collectible', cost: 300, emoji: '👑', tint: '#ffd34d', art: true },
  { id: 'doll_wizard', name: '魔法師貓公仔', desc: '收藏品 · 戴星星帽嘅小法師', kind: 'collectible', cost: 600, emoji: '🧙', tint: '#6c7bff', art: true },
  { id: 'doll_rocket', name: '火箭貓公仔', desc: '收藏品 · 騎住金火箭衝上天', kind: 'collectible', cost: 600, emoji: '🚀', tint: '#ff7a5e', art: true },
  { id: 'ring_rainbow', name: '彩虹圈戒', desc: '收藏品 · 七彩流光', kind: 'collectible', cost: 1000, emoji: '🌈', tint: '#ff7ac8', art: true },
  { id: 'cape_royal', name: '王者斗篷貓', desc: '收藏品 · 紅金斗篷限定款', kind: 'collectible', cost: 2000, emoji: '🦸', tint: '#d6213a', art: true },
  { id: 'trophy_paw', name: '金色貓爪獎盃', desc: '收藏品 · 全場最高榮譽', kind: 'collectible', cost: 3500, emoji: '🏆', tint: '#ffcf3f', art: true },

  { id: 'chest_cat', name: '神秘寶箱貓', desc: '收藏品 · 終極珍藏，只此一件', kind: 'collectible', cost: 8000, emoji: '🎁', tint: '#9aa0ff', art: true },
]

export const PRIZE_MAP: Record<string, Prize> = Object.fromEntries(PRIZES.map((p) => [p.id, p]))
