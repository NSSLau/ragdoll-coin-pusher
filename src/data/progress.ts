/** 每日任務、四階成就、布偶貓裝束（美術素材 pet_* 之後接入，暫用 emoji 佔位） */
export type StatKey = 'hits' | 'collected' | 'jackpots' | 'boss' | 'branch'
export interface Stats {
  hits: number
  collected: number
  jackpots: number
  boss: number
  branch: number
}
export const EMPTY_STATS: Stats = { hits: 0, collected: 0, jackpots: 0, boss: 0, branch: 0 }

export interface Reward2 {
  credits?: number
  points?: number
  tickets?: number
}

export interface DailyStage {
  goal: number
  reward: Reward2
}
export interface DailyDef {
  id: string
  name: string
  key: 'hits' | 'collected' | 'branch'
  /** 三階段遞進制：完成一階先解鎖下一階 */
  stages: [DailyStage, DailyStage, DailyStage]
}
/** 3 個每日目標 × 三階段（每日 0 時重置）。券只喺最後一階、分支小遊戲同 Boss 掉落 */
export const DAILY: DailyDef[] = [
  { id: 'd_hits', name: '命中缺口', key: 'hits', stages: [{ goal: 40, reward: { credits: 30 } }, { goal: 120, reward: { credits: 60, points: 40 } }, { goal: 300, reward: { points: 100, tickets: 1 } }] },
  { id: 'd_coll', name: '推落金幣入派彩槽', key: 'collected', stages: [{ goal: 80, reward: { credits: 40 } }, { goal: 250, reward: { credits: 80, points: 40 } }, { goal: 600, reward: { points: 120, tickets: 1 } }] },
  { id: 'd_branch', name: '完成特殊道具小遊戲', key: 'branch', stages: [{ goal: 1, reward: { points: 30 } }, { goal: 2, reward: { credits: 60, points: 40 } }, { goal: 3, reward: { points: 100, tickets: 1 } }] },
]

/** 四階：藍 → 金 → 紅 → 幻彩，按事件頻率定門檻（愈罕有嘅事件門檻愈細） */
export const TIERS = [
  { name: '藍', color: '#4da6ff', points: 20, tickets: 0 },
  { name: '金', color: '#ffd34d', points: 60, tickets: 0 },
  { name: '紅', color: '#ff4d6d', points: 150, tickets: 1 },
  { name: '幻彩', color: 'linear-gradient(90deg,#ff4d6d,#ffd34d,#5fe36a,#4dd2ff,#c46cff)', points: 400, tickets: 2 },
] as const

export interface AchDef {
  id: string
  name: string
  emoji: string
  key: StatKey
  tiers: [number, number, number, number]
}
export const ACHS: AchDef[] = [
  { id: 'a_hits', name: '神射手 · 命中缺口', emoji: '🎯', key: 'hits', tiers: [100, 600, 2500, 8000] },
  { id: 'a_coll', name: '金幣富翁 · 推落金幣', emoji: '💰', key: 'collected', tiers: [400, 2500, 10000, 40000] },
  { id: 'a_jp', name: '大獎得主 · Royal JP', emoji: '👑', key: 'jackpots', tiers: [3, 10, 30, 80] },
  { id: 'a_boss', name: '馬戲團剋星 · 擊敗 Boss', emoji: '🦁', key: 'boss', tiers: [3, 15, 50, 120] },
  { id: 'a_branch', name: '驚喜探險家 · 道具小遊戲', emoji: '🎁', key: 'branch', tiers: [8, 25, 70, 160] },
]

export interface CostumeDef {
  id: string
  name: string
  emoji: string
  cost: number // 小遊戲券
  desc: string
  /** 實戰被動增益說明 */
  buff: string
}
/** 高級裝束需大量券，用嚟消化多餘遊戲券；裝備後 3D 貓身上即時穿戴，並有實戰被動增益 */
export const COSTUMES: CostumeDef[] = [
  { id: 'pet_hat_wizard', name: '巫師帽', emoji: '🧙', cost: 12, desc: '星星巫師帽', buff: '運氣值累積 +15%' },
  { id: 'pet_cape_royal', name: '皇家披風', emoji: '🦸', cost: 25, desc: '紅金皇家披風', buff: 'Boss 傷害 +20%' },
  { id: 'pet_wings', name: '天使翼', emoji: '👼', cost: 40, desc: '潔白天使翼', buff: '築塔速度 +15%' },
  { id: 'pet_clown_nose', name: '小丑鼻', emoji: '🤡', cost: 8, desc: '紅色小丑鼻', buff: '命中積分 +20%' },
]

export const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
