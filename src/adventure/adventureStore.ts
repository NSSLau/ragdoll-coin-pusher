import { create } from 'zustand'
import { useGame } from '../store/gameStore'
import { ELEMENT_LIST, ELEMENTS, MONSTER_DEX, elementMul, type Element } from '../data/progress'
import { audio } from '../utils/AudioFX'

/**
 * 上方橫向冒險（4 層視差）：
 * - 冇無限刷怪：只有金幣被推過 65% 黃金正門先會前進（銀幣 +1m、金幣 +3m、金磚 +5m）
 * - 每 100m 停低背景、響警報，出現 1 隻稀有怪 / Boss（每 5 次出 1 隻 Boss 獅子團長）
 * - 魔物各帶 火 / 水 / 雷 護盾：推落對應元素珠入正門發動魔法（水克火、火克雷、雷克水 = 3.0× 破盾；同屬性 0.3×）
 * - 七星龍珠 = 全屬性無雙必殺；戰鬥期間唔計里數，射擊命中、金幣推落正門都會打傷害，冇反擊
 * - 打倒獎勵：20 枚稀有金幣雨（每枚 +5）+ 築塔進度 +15 + 魔物圖鑑 / 戰利品
 */

export type AdvPhase = 'run' | 'alert' | 'fight' | 'win'

export interface MonsterDef {
  id: string
  name: string
  sprite: 'monster_fire' | 'monster_water' | 'monster_lightning' | 'monster_boss'
  boss?: boolean
  /** 護盾屬性（普通魔物固定對應造型；Boss 隨機） */
  element: Element
}

export const BOSS_EVERY_M = 100 // 每 100m 一隻
export const BOSS_BOSS_EVERY = 5 // 每 5 隻有 1 隻 Boss
export const M_PER = { silver: 1, gold: 3, bar: 5 } as const
export const PX_PER_M = 38 // 背景捲動：每米幾多 px
export const ALERT_TIME = 1.7
export const WIN_TIME = 2.8
export const SLASH_TIME = 0.28
const SMASH_RATIO = 0.4
const SMASH_MIN = 8
/** 打倒獎勵（集中喺度，方便平衡） */
export const WIN_REWARD = { gold: 20, dock: 15 }
/** 元素珠基礎傷害佔魔物最大血量比例；七星龍珠必殺比例 */
const ORB_RATIO = 0.16
const ORB_MIN = 6
const ULT_RATIO = 0.55

/** 第 n 隻（0 起）係咪 Boss */
export const isBossAt = (n: number) => (n + 1) % BOSS_BOSS_EVERY === 0
const hash = (n: number) => {
  let x = (n + 1) * 2654435761
  x = ((x >>> 16) ^ x) * 45679
  return (x >>> 0) % 997
}
/** 第 n 隻魔物：造型 + 護盾屬性由 n 決定（存檔後重入都一致） */
export const monsterAt = (n: number): MonsterDef => {
  const dex = isBossAt(n) ? MONSTER_DEX[3] : MONSTER_DEX[hash(n) % 3]
  // 造型 = 屬性（火獅 🔥 / 水母貓 💧 / 刺蝟狐 ⚡）；只有 Boss 係隨機護盾
  const element: Element = dex.boss ? ELEMENT_LIST[hash(n * 7 + 3) % 3] : (dex.id.replace('monster_', '') as Element)
  return { id: dex.id, name: dex.name, sprite: dex.sprite, boss: dex.boss, element }
}
export const monsterHp = (n: number) => Math.round((14 + 5 * n) * (isBossAt(n) ? 2 : 1))
export const nextBossAt = (n: number) => (n + 1) * BOSS_EVERY_M

export interface FloatText {
  id: number
  text: string
  kind: 'dmg' | 'crit' | 'smash' | 'break' | 'resist' | 'ult'
}

interface AdvState {
  dist: number // 目標里數 (m)
  shown: number // 畫面緩動里數（背景捲動用）
  bossN: number // 已打倒嘅稀有怪數
  phase: AdvPhase
  phaseT: number
  monHp: number
  monMax: number
  slashT: number
  slashId: number
  hopId: number
  critId: number
  monHitId: number
  smashId: number
  /** 護盾已被克制破除 */
  shieldBroken: boolean
  /** 元素魔法特效（id 變就重播） */
  magic: { id: number; el: Element | 'all' } | null
  floats: FloatText[]

  tick: (dt: number) => void
  /** 金幣被推落正門：前進里數 */
  addDist: (kind: 'silver' | 'gold' | 'bar') => void
  attack: (lane: -1 | 0 | 1, mult?: number) => void
  bonusDamage: (n: number) => void
  smash: () => void
  /** 推落元素珠 / 七星龍珠入正門：返回是否有魔物受擊（冇魔物 = 蓄能 +3m） */
  orbAttack: (kind: Element | 'dragon') => boolean
}

let fid = 0
const pushFloat = (floats: FloatText[], text: string, kind: FloatText['kind']) => [...floats.slice(-5), { id: ++fid, text, kind }]
const capeMul = () => (useGame.getState().equipped.includes('pet_cape_royal') ? 1.2 : 1)

function payWin(n: number) {
  const g = useGame.getState()
  const m = monsterAt(n)
  const bonus = g.trophies.trophy_royal_crown ? 5 : 0 // 皇冠獎盃被動：金幣雨 +5 枚
  g.grantReward({ gold: WIN_REWARD.gold + bonus, dock: WIN_REWARD.dock }) // 稀有金幣雨 + 築塔
  g.addStat('boss')
  g.addKill(m.id)
  if (m.boss) g.grantCostume('pet_cape_royal') // Boss 首殺掉落皇家披風
  g.checkTrophies()
  g.showToast(`🏆 打倒${m.name}！金幣雨 ×${WIN_REWARD.gold + bonus} · 築塔 +${WIN_REWARD.dock} · 已記入圖鑑`)
  g.setMood('jackpot', 2000)
  audio.jackpot()
}

export const useAdventure = create<AdvState>()((set, get) => {
  const hurt = (dmg: number, text: string, kind: FloatText['kind']) => {
    const s = get()
    if (s.phase !== 'fight' || s.monHp <= 0) return false
    const monHp = Math.max(0, s.monHp - dmg)
    set({ monHp, monHitId: s.monHitId + 1, floats: pushFloat(s.floats, text, kind), ...(monHp <= 0 ? { phase: 'win' as const, phaseT: 0 } : {}) })
    if (monHp <= 0) payWin(s.bossN)
    return true
  }
  return {
    dist: 0,
    shown: 0,
    bossN: 0,
    phase: 'run',
    phaseT: 0,
    monHp: 0,
    monMax: 0,
    slashT: 0,
    slashId: 0,
    hopId: 0,
    critId: 0,
    monHitId: 0,
    smashId: 0,
    shieldBroken: false,
    magic: null,
    floats: [],

    tick: (dt) => {
      const s = get()
      const patch: Partial<AdvState> = {}
      if (s.slashT > 0) patch.slashT = Math.max(0, s.slashT - dt)
      const t = s.phaseT + dt
      switch (s.phase) {
        case 'run': {
          // 畫面里數緩動追上目標：只有收幣先會郁，冇收幣背景自然停
          const shown = s.shown + (s.dist - s.shown) * Math.min(1, dt * 5)
          patch.shown = Math.abs(s.dist - shown) < 0.02 ? s.dist : shown
          if (s.dist >= nextBossAt(s.bossN) && (patch.shown ?? s.shown) >= nextBossAt(s.bossN) - 0.05) {
            patch.shown = nextBossAt(s.bossN)
            patch.phase = 'alert'
            patch.phaseT = 0
            useGame.getState().markDex(monsterAt(s.bossN).id)
            audio.error()
          }
          break
        }
        case 'alert':
          if (t >= ALERT_TIME) {
            const max = monsterHp(s.bossN)
            Object.assign(patch, { phase: 'fight' as const, phaseT: 0, monHp: max, monMax: max, shieldBroken: false })
          } else patch.phaseT = t
          break
        case 'fight':
          patch.phaseT = t
          break
        case 'win':
          if (t >= WIN_TIME) Object.assign(patch, { phase: 'run' as const, phaseT: 0, bossN: s.bossN + 1, monHp: 0 })
          else patch.phaseT = t
          break
      }
      if (Object.keys(patch).length) set(patch)
    },

    addDist: (kind) => {
      const s = get()
      if (s.phase !== 'run') return
      set({ dist: Math.min(nextBossAt(s.bossN), s.dist + M_PER[kind]) })
    },

    attack: (lane, mult = 1) => {
      const s = get()
      if (s.phase !== 'fight' || s.monHp <= 0) {
        set({ hopId: s.hopId + 1 }) // 冇怪：勇者原地輕跳
        return
      }
      const crit = lane === 0
      const dmg = Math.ceil((crit ? 2 : 1) * mult * capeMul())
      set({ slashId: s.slashId + 1, slashT: SLASH_TIME, ...(crit ? { critId: s.critId + 1 } : {}) })
      hurt(dmg, crit ? `暴擊 -${dmg}` : `-${dmg}`, crit ? 'crit' : 'dmg')
    },

    bonusDamage: (n) => {
      hurt(Math.ceil(n * capeMul()), `金幣 -${Math.ceil(n * capeMul())}`, 'dmg')
    },

    orbAttack: (kind) => {
      const s = get()
      if (s.phase !== 'fight' || s.monHp <= 0) {
        // 冇魔物：元素珠蓄能，推進 3m（冇魔物都有用，唔會白白推落）
        if (s.phase === 'run') set({ dist: Math.min(nextBossAt(s.bossN), s.dist + 3) })
        return false
      }
      const mon = monsterAt(s.bossN)
      if (kind === 'dragon') {
        const dmg = Math.ceil(s.monMax * ULT_RATIO * capeMul())
        set({ shieldBroken: true, magic: { id: ++fid, el: 'all' } })
        hurt(dmg, `全屬性無雙必殺 -${dmg}`, 'ult')
        return true
      }
      const mul = elementMul(kind, mon.element)
      const dmg = Math.max(1, Math.ceil(Math.max(ORB_MIN, Math.round(s.monMax * ORB_RATIO)) * mul * capeMul()))
      set({ magic: { id: ++fid, el: kind }, ...(mul >= 3 ? { shieldBroken: true } : {}) })
      if (mul >= 3) {
        hurt(dmg, `3.0× 暴擊破盾！-${dmg}`, 'break')
        useGame.getState().grantReward({ gold: 3 }) // 震落額外 3 枚金幣
      } else if (mul < 1) hurt(dmg, `0.3× 屬性抵抗... -${dmg}`, 'resist')
      else hurt(dmg, `${ELEMENTS[kind].name}魔法 -${dmg}`, 'dmg')
      return true
    },

    smash: () => {
      const s = get()
      set({ smashId: s.smashId + 1 })
      const dmg = Math.ceil(Math.max(SMASH_MIN, Math.round(s.monMax * SMASH_RATIO)) * capeMul())
      hurt(dmg, `必殺 -${dmg}`, 'smash')
    },
  }
})

// 開發模式：方便喺 console / 自動化測試直接操作冒險狀態
if (import.meta.env.DEV) (window as unknown as { __adv: typeof useAdventure }).__adv = useAdventure
