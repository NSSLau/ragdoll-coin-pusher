import { create } from 'zustand'
import type { SpriteKey } from '../utils/SpriteAtlas'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'

/**
 * 上方橫向闖關：布偶貓勇者行路打怪
 * - 射中缺口 = 揮劍（左右線 1 倍；中線 2 倍暴擊）
 * - 銀幣落派彩槽 = 回血；金磚落派彩槽 = 巨型貓爪必殺
 * - 怪物定時反擊；HP 歸零 → 暈眩 → 退回本關起點
 * - 每關 4 隻：發條老鼠 → 雜耍小丑 → 獨輪猴 → Boss 噴火獅子團長
 */

export type AdvPhase = 'walk' | 'fight' | 'dizzy' | 'clear'

interface MonsterDef {
  name: string
  sprite: SpriteKey
  hp: number // 第 1 關基礎血量
  atk: number // 第 1 關每次反擊傷害
  every: number // 反擊間隔 (s)
  flip?: boolean // 原圖面向右，要鏡像成面向勇者
  boss?: boolean
}

export const MONSTERS: MonsterDef[] = [
  { name: '發條老鼠', sprite: 'adv_mouse', hp: 5, atk: 2, every: 3.5, flip: true },
  { name: '雜耍小丑', sprite: 'adv_clown', hp: 8, atk: 3, every: 3.5 },
  { name: '獨輪車小猴', sprite: 'adv_monkey', hp: 11, atk: 3, every: 3 },
  { name: '噴火獅子團長', sprite: 'adv_lion', hp: 28, atk: 5, every: 3, boss: true },
]

export const HERO_MAX = 24
const WALK_TIME = 2.4 // 兩隻怪之間行幾耐 (s)
const DIZZY_TIME = 2.2
const CLEAR_TIME = 2.6
const HEAL_PER_COIN = 1
export const SLASH_TIME = 0.28
const SMASH_RATIO = 0.6 // 必殺：怪物最大血量 60%（最少 12）
const SMASH_MIN = 12

/** 關卡倍率：血量、攻擊、獎勵隨關卡提升 */
export const stageMul = (stage: number) => 1 + 0.5 * (stage - 1)
export const clearReward = (stage: number) => Math.round(40 * stageMul(stage))

export interface FloatText {
  id: number
  text: string
  kind: 'dmg' | 'crit' | 'heal' | 'smash' | 'hurt'
}

interface AdvState {
  stage: number
  wave: number // 0..3（3 = Boss）
  phase: AdvPhase
  phaseT: number
  heroHp: number
  monHp: number
  monMax: number
  atkT: number
  /** 揮劍幀剩餘時間 (s) */
  slashT: number
  /** 動畫觸發（id 變就重播） */
  slashId: number
  critId: number
  hurtId: number
  monHitId: number
  smashId: number
  floats: FloatText[]
  lastReward: number

  tick: (dt: number) => void
  attack: (lane: -1 | 0 | 1, mult?: number) => void
  heal: (n?: number) => void
  smash: () => void
}

let fid = 0

/** 打低 Boss：發通關金幣（之後接塌塔落幣雨 / 猜大細） */
function payClear(stage: number, amount: number) {
  const g = useGame.getState()
  g.collect(amount)
  g.addPoints(10 * stage)
  g.addTicket(1, true) // Boss 掉落 1 張小遊戲券
  g.addStat('boss')
  g.triggerRain() // 勝利落幣雨：15 金幣 + 3 銀幣
  g.showToast(`Stage ${stage} 通關！獎勵 ${amount} 金幣 + 小遊戲券 1 🏆`)
  g.setMood('jackpot', 2000)
  audio.jackpot()
}
const pushFloat = (floats: FloatText[], text: string, kind: FloatText['kind']) =>
  [...floats.slice(-5), { id: ++fid, text, kind }]

const monsterMax = (stage: number, wave: number) => Math.round(MONSTERS[wave].hp * stageMul(stage))

/** 擊倒當前怪物：Boss → 通關；否則行去下一隻 */
function defeat(s: AdvState): Partial<AdvState> {
  if (MONSTERS[s.wave].boss) {
    return { monHp: 0, phase: 'clear', phaseT: 0, lastReward: clearReward(s.stage) }
  }
  return { monHp: 0, phase: 'walk', phaseT: 0, wave: s.wave + 1 }
}

function damage(s: AdvState, dmg: number, text: string, kind: FloatText['kind']): Partial<AdvState> {
  const monHp = Math.max(0, s.monHp - dmg)
  const base: Partial<AdvState> = { monHp, monHitId: s.monHitId + 1, floats: pushFloat(s.floats, text, kind) }
  return monHp <= 0 ? { ...base, ...defeat(s) } : base
}

export const useAdventure = create<AdvState>()((set, get) => ({
  stage: 1,
  wave: 0,
  phase: 'walk',
  phaseT: 0,
  heroHp: HERO_MAX,
  monHp: 0,
  monMax: 0,
  atkT: 0,
  slashT: 0,
  slashId: 0,
  critId: 0,
  hurtId: 0,
  monHitId: 0,
  smashId: 0,
  floats: [],
  lastReward: 0,

  tick: (dt) => {
    if (get().slashT > 0) set({ slashT: Math.max(0, get().slashT - dt) })
    const s = get()
    const t = s.phaseT + dt
    switch (s.phase) {
      case 'walk':
        if (t >= WALK_TIME) {
          const max = monsterMax(s.stage, s.wave)
          set({ phase: 'fight', phaseT: 0, monHp: max, monMax: max, atkT: 0 })
        } else set({ phaseT: t })
        return
      case 'fight': {
        const m = MONSTERS[s.wave]
        const atkT = s.atkT + dt
        if (atkT < m.every) {
          set({ phaseT: t, atkT })
          return
        }
        const dmg = Math.round(m.atk * stageMul(s.stage))
        const heroHp = Math.max(0, s.heroHp - dmg)
        set({
          phaseT: t,
          atkT: 0,
          heroHp,
          hurtId: s.hurtId + 1,
          floats: pushFloat(s.floats, `-${dmg}`, 'hurt'),
          ...(heroHp <= 0 ? { phase: 'dizzy' as const, phaseT: 0 } : {}),
        })
        return
      }
      case 'dizzy':
        // 暈低：退回本關起點、補滿血重新挑戰
        if (t >= DIZZY_TIME) set({ phase: 'walk', phaseT: 0, wave: 0, heroHp: HERO_MAX, monHp: 0 })
        else set({ phaseT: t })
        return
      case 'clear':
        if (t >= CLEAR_TIME) set({ phase: 'walk', phaseT: 0, wave: 0, stage: s.stage + 1, heroHp: HERO_MAX, monHp: 0 })
        else set({ phaseT: t })
        return
    }
  },

  attack: (lane, mult = 1) => {
    const s = get()
    if (s.phase !== 'fight' || s.monHp <= 0) return
    const crit = lane === 0
    const dmg = (crit ? 2 : 1) * mult
    set({
      slashId: s.slashId + 1,
      slashT: SLASH_TIME,
      ...(crit ? { critId: s.critId + 1 } : {}),
      ...damage(s, dmg, crit ? `暴擊 -${dmg}` : `-${dmg}`, crit ? 'crit' : 'dmg'),
    })
    if (get().phase === 'clear') payClear(s.stage, get().lastReward)
  },

  heal: (n = HEAL_PER_COIN) => {
    const s = get()
    if (s.phase === 'dizzy' || s.heroHp >= HERO_MAX) return
    set({ heroHp: Math.min(HERO_MAX, s.heroHp + n), floats: pushFloat(s.floats, `+${n}`, 'heal') })
  },

  smash: () => {
    const s = get()
    if (s.phase !== 'fight' || s.monHp <= 0) {
      set({ smashId: s.smashId + 1 }) // 冇怪都照播貓爪動畫
      return
    }
    const dmg = Math.max(SMASH_MIN, Math.round(s.monMax * SMASH_RATIO))
    set({ smashId: s.smashId + 1, ...damage(s, dmg, `必殺 -${dmg}`, 'smash') })
    if (get().phase === 'clear') payClear(s.stage, get().lastReward)
  },
}))

// 開發模式：方便喺 console / 自動化測試直接操作闖關狀態
if (import.meta.env.DEV) (window as unknown as { __adv: typeof useAdventure }).__adv = useAdventure
