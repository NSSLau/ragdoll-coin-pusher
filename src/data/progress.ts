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

export interface DailyDef {
  id: string
  name: string
  key: 'hits' | 'collected' | 'branch'
  goal: number
  reward: Reward2
}
/** 3 個每日目標（每日 0 時重置）：券只喺呢度同分支小遊戲、Boss 掉落 */
export const DAILY: DailyDef[] = [
  { id: 'd_hits', name: '命中缺口 25 次', key: 'hits', goal: 25, reward: { tickets: 1 } },
  { id: 'd_coll', name: '推落 40 枚金幣入派彩槽', key: 'collected', goal: 40, reward: { credits: 40 } },
  { id: 'd_branch', name: '完成 1 次特殊道具小遊戲', key: 'branch', goal: 1, reward: { tickets: 1, points: 30 } },
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
  { id: 'a_hits', name: '神射手 · 命中缺口', emoji: '🎯', key: 'hits', tiers: [30, 150, 600, 2000] },
  { id: 'a_coll', name: '金幣富翁 · 推落金幣', emoji: '💰', key: 'collected', tiers: [100, 500, 2000, 8000] },
  { id: 'a_jp', name: '大獎得主 · Royal JP', emoji: '👑', key: 'jackpots', tiers: [1, 3, 10, 30] },
  { id: 'a_boss', name: '馬戲團剋星 · 擊敗 Boss', emoji: '🦁', key: 'boss', tiers: [1, 5, 15, 40] },
  { id: 'a_branch', name: '驚喜探險家 · 道具小遊戲', emoji: '🎁', key: 'branch', tiers: [3, 10, 30, 80] },
]

export interface CostumeDef {
  id: string
  name: string
  emoji: string
  cost: number // 小遊戲券
  desc: string
}
/** 高級裝束需大量券，用嚟消化多餘遊戲券 */
export const COSTUMES: CostumeDef[] = [
  { id: 'pet_scarf', name: '紅金圍巾', emoji: '🧣', cost: 8, desc: '馬戲團團員標準裝' },
  { id: 'pet_cape', name: '王者斗篷', emoji: '🦸', cost: 20, desc: '紅金斗篷，威風凜凜' },
  { id: 'pet_crown', name: '皇家皇冠', emoji: '👑', cost: 40, desc: '海雙布偶團長專屬' },
  { id: 'pet_rainbow', name: '幻彩禮服', emoji: '🌈', cost: 80, desc: '全服最閃嘅終極裝束' },
]

export const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
