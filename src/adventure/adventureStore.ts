import { create } from 'zustand'
import type { SpriteKey } from '../utils/SpriteAtlas'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'

/**
 * 上方橫向冒險（4 層視差）：
 * - 冇無限刷怪：只有金幣被推過 65% 黃金正門先會前進（銀幣 +1m、金幣 +3m、金磚 +5m）
 * - 每 100m 停低背景、響警報，出現 1 隻稀有怪 / Boss（每 5 次出 1 隻 Boss 獅子團長）
 * - 戰鬥期間唔計里數：射擊命中、金幣推落正門都會打傷害，冇反擊（唔會令玩家蝕底）
 * - 打倒獎勵：20 枚稀有金幣雨（每枚 +5）+ 小遊戲券 ×3 + 築塔進度 +15
 */

export type AdvPhase = 'run' | 'alert' | 'fight' | 'win'

export interface MonsterDef {
  name: string
  sprite: SpriteKey
  flip?: boolean
  boss?: boolean
}

export const RARE_MONSTERS: MonsterDef[] = [
  { name: '發條老鼠王', sprite: 'adv_mouse', flip: true },
  { name: '雜耍小丑', sprite: 'adv_clown' },
  { name: '獨輪車小猴', sprite: 'adv_monkey' },
]
export const BOSS_MONSTER: MonsterDef = { name: '噴火獅子團長', sprite: 'adv_lion', boss: true }

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
export const WIN_REWARD = { gold: 20, tickets: 3, dock: 15 }

/** 第 n 隻（0 起）係咪 Boss */
export const isBossAt = (n: number) => (n + 1) % BOSS_BOSS_EVERY === 0
export const monsterAt = (n: number): MonsterDef => (isBossAt(n) ? BOSS_MONSTER : RARE_MONSTERS[n % RARE_MONSTERS.length])
export const monsterHp = (n: number) => Math.round((14 + 5 * n) * (isBossAt(n) ? 2 : 1))
export const nextBossAt = (n: number) => (n + 1) * BOSS_EVERY_M

export interface FloatText {
  id: number
  text: string
  kind: 'dmg' | 'crit' | 'smash'
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
  floats: FloatText[]

  tick: (dt: number) => void
  /** 金幣被推落正門：前進里數 */
  addDist: (kind: 'silver' | 'gold' | 'bar') => void
  attack: (lane: -1 | 0 | 1, mult?: number) => void
  bonusDamage: (n: number) => void
  smash: () => void
}

let fid = 0
const pushFloat = (floats: FloatText[], text: string, kind: FloatText['kind']) => [...floats.slice(-5), { id: ++fid, text, kind }]
const capeMul = () => (useGame.getState().equipped.includes('pet_cape_royal') ? 1.2 : 1)

function payWin(n: number) {
  const g = useGame.getState()
  g.grantReward(WIN_REWARD) // 稀有金幣雨 20 枚 + 券 + 築塔
  g.addStat('boss')
  g.showToast(`🏆 打倒${monsterAt(n).name}！金幣雨 ×${WIN_REWARD.gold} · 券 +${WIN_REWARD.tickets} · 築塔 +${WIN_REWARD.dock}`)
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
            audio.error()
          }
          break
        }
        case 'alert':
          if (t >= ALERT_TIME) {
            const max = monsterHp(s.bossN)
            Object.assign(patch, { phase: 'fight' as const, phaseT: 0, monHp: max, monMax: max })
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
