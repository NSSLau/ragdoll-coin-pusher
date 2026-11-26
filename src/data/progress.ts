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
/** 3 個每日目標 × 三階段（每日 0 時重置）。最後一階獎勵最豐厚 */
export const DAILY: DailyDef[] = [
  { id: 'd_hits', name: '命中缺口', key: 'hits', stages: [{ goal: 40, reward: { credits: 30 } }, { goal: 120, reward: { credits: 60, points: 40 } }, { goal: 300, reward: { points: 150 } }] },
  { id: 'd_coll', name: '推落金幣入派彩槽', key: 'collected', stages: [{ goal: 80, reward: { credits: 40 } }, { goal: 250, reward: { credits: 80, points: 40 } }, { goal: 600, reward: { points: 180 } }] },
  { id: 'd_branch', name: '完成特殊道具小遊戲', key: 'branch', stages: [{ goal: 1, reward: { points: 30 } }, { goal: 2, reward: { credits: 60, points: 40 } }, { goal: 3, reward: { points: 150 } }] },
]

/** 四階：藍 → 金 → 紅 → 幻彩，按事件頻率定門檻（愈罕有嘅事件門檻愈細） */
export const TIERS = [
  { name: '藍', color: '#4da6ff', points: 20 },
  { name: '金', color: '#ffd34d', points: 60 },
  { name: '紅', color: '#ff4d6d', points: 150 },
  { name: '幻彩', color: 'linear-gradient(90deg,#ff4d6d,#ffd34d,#5fe36a,#4dd2ff,#c46cff)', points: 400 },
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
  cost: number // 積分
  desc: string
  /** 實戰被動增益說明 */
  buff: string
}
/** 裝束用積分購買（或擊敗魔物掉落）；裝備後 3D 貓身上即時穿戴，並有實戰被動增益 */
export const COSTUMES: CostumeDef[] = [
  { id: 'pet_hat_wizard', name: '巫師帽', emoji: '🧙', cost: 500, desc: '星星巫師帽', buff: '運氣值累積 +15%' },
  { id: 'pet_cape_royal', name: '皇家披風', emoji: '🦸', cost: 1000, desc: '紅金皇家披風（首次擊敗 Boss 亦會掉落）', buff: '魔物傷害 +20%' },
  { id: 'pet_wings', name: '天使翼', emoji: '👼', cost: 1600, desc: '潔白天使翼', buff: '築塔速度 +15%' },
  { id: 'pet_clown_nose', name: '小丑鼻', emoji: '🤡', cost: 200, desc: '紅色小丑鼻', buff: '命中積分 +20%' },
]

export const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/* ------------------------------------------------------------------ */
/*  元素系統、魔物圖鑑、戰利品                                            */
/* ------------------------------------------------------------------ */
export type Element = 'fire' | 'water' | 'lightning'
export const ELEMENT_LIST: Element[] = ['fire', 'water', 'lightning']
export const ELEMENTS: Record<Element, { name: string; emoji: string; color: string; beats: Element }> = {
  fire: { name: '火', emoji: '🔥', color: '#ff6a3d', beats: 'lightning' },
  water: { name: '水', emoji: '💧', color: '#4dc3ff', beats: 'fire' },
  lightning: { name: '雷', emoji: '⚡', color: '#ffd93d', beats: 'water' },
}
/** 屬性倍率：攻方克守方 3.0×、同屬性 0.3×、其餘 1× */
export const elementMul = (atk: Element, def: Element) => (ELEMENTS[atk].beats === def ? 3 : atk === def ? 0.3 : 1)

export type OrbId = 'orb_fire' | 'orb_water' | 'orb_lightning' | 'orb_mystery' | 'trophy_dragon_medal'
export interface MonsterDex {
  id: string
  name: string
  sprite: 'monster_fire' | 'monster_water' | 'monster_lightning' | 'monster_boss'
  desc: string
  boss?: boolean
}
export const MONSTER_DEX: MonsterDex[] = [
  { id: 'monster_fire', name: '火焰幼獅', sprite: 'monster_fire', desc: '鬃毛燒緊嘅幼獅，脾氣急燥，最驚水元素珠。' },
  { id: 'monster_water', name: '水母貓精靈', sprite: 'monster_water', desc: '半透明嘅水母貓，滑溜溜，被火元素珠蒸發嗰刻最吃驚。' },
  { id: 'monster_lightning', name: '雷電刺蝟狐', sprite: 'monster_lightning', desc: '全身電光嘅刺蝟狐，跑得快，但水一潑就麻痺。' },
  { id: 'monster_boss', name: '皇家幻術梟', sprite: 'monster_boss', boss: true, desc: '馬戲團嘅幻術團長，每 5 隻先出 1 次。只有七星龍珠先打得穿佢嘅魔法披風。' },
]
export const ORB_DEX: Array<{ id: OrbId; name: string; desc: string }> = [
  { id: 'orb_fire', name: '火元素珠', desc: '克制雷屬性魔物（3.0×），被水屬性克制。' },
  { id: 'orb_water', name: '水元素珠', desc: '克制火屬性魔物（3.0×），被雷屬性克制。' },
  { id: 'orb_lightning', name: '雷元素珠', desc: '克制水屬性魔物（3.0×），被火屬性克制。' },
  { id: 'trophy_dragon_medal', name: '七星龍珠', desc: '推落正門點亮機背 1 盞燈；集滿 7 盞觸發 SUPER FEVER。對魔物造成「全屬性無雙必殺」。' },
  { id: 'orb_mystery', name: '彩虹神秘彩球', desc: '推落正門即開「彩虹命運轉盤」或「皇家猜大細」。' },
]

export interface TrophyDef {
  id: 'trophy_royal_crown' | 'trophy_galaxy_orb' | 'trophy_element_tome' | 'trophy_dragon_medal'
  name: string
  /** 解鎖條件文字 */
  how: string
  /** 永久被動加成 */
  perk: string
}
export const TROPHIES: TrophyDef[] = [
  { id: 'trophy_royal_crown', name: '皇冠獎盃', how: '首次擊敗 Boss（皇家幻術梟）', perk: '被動：擊敗魔物金幣雨 +5 枚' },
  { id: 'trophy_galaxy_orb', name: '星河水晶球', how: '累計擊敗 3 隻魔物', perk: '被動：運氣值累積 +10%' },
  { id: 'trophy_element_tome', name: '三元素魔導書', how: '火、水、雷三種魔物各擊敗 1 次', perk: '被動：元素珠掉落率 +10%' },
  { id: 'trophy_dragon_medal', name: '七星龍珠徽章', how: '首次集滿 7 星觸發 SUPER FEVER', perk: '被動：SUPER FEVER 延長 2 秒' },
]
/** 按圖鑑數據判斷戰利品有冇達成解鎖條件 */
export function trophyEarned(id: TrophyDef['id'], bestiary: Record<string, number>, feverCount: number): boolean {
  const k = (m: string) => bestiary[m] ?? 0
  switch (id) {
    case 'trophy_royal_crown':
      return k('monster_boss') >= 1
    case 'trophy_galaxy_orb':
      return k('monster_fire') + k('monster_water') + k('monster_lightning') + k('monster_boss') >= 3
    case 'trophy_element_tome':
      return k('monster_fire') >= 1 && k('monster_water') >= 1 && k('monster_lightning') >= 1
    case 'trophy_dragon_medal':
      return feverCount >= 1
  }
}
