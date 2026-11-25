import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { audio } from '../utils/AudioFX'

export type View = 'lobby' | 'game'
export type Mood = 'idle' | 'shoot' | 'win' | 'jackpot' | 'dizzy' | 'sleep'

export const START_CREDITS = 300
export const TOWER_GOAL = 25

const JP_BASE = { jp1: 50, jp2: 200, jp3: 500 }
const JP_GROW = { jp1: 0.4, jp2: 1.2, jp3: 3 } // 每射一幣累積

export interface WinPop {
  id: number
  amount: number
}
export interface JackpotPop {
  id: number
  tier: 1 | 2 | 3
  amount: number
}

interface GameState {
  view: View
  credits: number
  totalWin: number
  shots: number
  tower: number // 0..24，滿 25 疊塔
  jp: { jp1: number; jp2: number; jp3: number }
  turbo: boolean
  muted: boolean
  mood: Mood
  winPop: WinPop | null
  jackpotPop: JackpotPop | null
  toast: { id: number; text: string } | null

  goGame: () => void
  goLobby: () => void
  setTurbo: (v: boolean) => void
  toggleMute: () => void
  showToast: (text: string) => void

  /** 扣 1 幣、累積 JP、加塔進度；返回 true 代表今次射完要疊塔 */
  spend: () => { ok: boolean; towerReady: boolean }
  collect: (value: number) => void
  awardJackpot: (tier: 1 | 2 | 3) => void
  refill: () => void
  /** 射幣失敗（引擎冇位）退返 1 幣 */
  refund: (towerWasReady: boolean) => void
  setMood: (m: Mood, holdMs?: number) => void
  clearJackpot: () => void
}

let moodTimer: ReturnType<typeof setTimeout> | undefined
let winTimer: ReturnType<typeof setTimeout> | undefined
let winBuffer = 0
let popId = 0

const num = (v: unknown, fallback: number, min = 0) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
    view: 'lobby',
    credits: START_CREDITS,
    totalWin: 0,
    shots: 0,
    tower: 0,
    jp: { ...JP_BASE },
    turbo: false,
    muted: false,
    mood: 'idle',
    winPop: null,
    jackpotPop: null,
    toast: null,

    goGame: () => set({ view: 'game', turbo: false }),
    goLobby: () => set({ view: 'lobby', turbo: false }),
    setTurbo: (v) => set({ turbo: v }),
    toggleMute: () => {
      const muted = !get().muted
      audio.setMuted(muted)
      set({ muted })
    },
    showToast: (text) => {
      const id = ++popId
      set({ toast: { id, text } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, 1800)
    },

    spend: () => {
      const s = get()
      if (s.credits < 1) {
        s.setMood('dizzy', 1200)
        return { ok: false, towerReady: false }
      }
      const nextTower = s.tower + 1
      const towerReady = nextTower >= TOWER_GOAL
      set({
        credits: s.credits - 1,
        shots: s.shots + 1,
        tower: towerReady ? 0 : nextTower,
        jp: {
          jp1: s.jp.jp1 + JP_GROW.jp1,
          jp2: s.jp.jp2 + JP_GROW.jp2,
          jp3: s.jp.jp3 + JP_GROW.jp3,
        },
      })
      if (get().mood === 'idle' || get().mood === 'sleep') get().setMood('shoot', 500)
      return { ok: true, towerReady }
    },

    collect: (value) => {
      set((s) => ({ credits: s.credits + value, totalWin: s.totalWin + value }))
      // 0.35 秒內嘅贏分合併做一個彈出
      winBuffer += value
      clearTimeout(winTimer)
      winTimer = setTimeout(() => {
        set({ winPop: { id: ++popId, amount: winBuffer } })
        if (winBuffer >= 8) get().setMood('win', 1400)
        winBuffer = 0
      }, 350)
    },

    awardJackpot: (tier) => {
      const key = (['jp1', 'jp2', 'jp3'] as const)[tier - 1]
      const amount = Math.floor(get().jp[key])
      set((s) => ({
        credits: s.credits + amount,
        totalWin: s.totalWin + amount,
        jp: { ...s.jp, [key]: JP_BASE[key] },
        jackpotPop: { id: ++popId, tier, amount },
      }))
      get().setMood('jackpot', 3200)
    },

    refill: () => set((s) => ({ credits: s.credits + 200 })),

  refund: (towerWasReady) =>
    set((s) => ({
      credits: s.credits + 1,
      shots: Math.max(0, s.shots - 1),
      tower: towerWasReady ? TOWER_GOAL - 1 : Math.max(0, s.tower - 1),
    })),

    setMood: (mood, holdMs = 0) => {
      clearTimeout(moodTimer)
      set({ mood })
      if (holdMs > 0) moodTimer = setTimeout(() => set({ mood: 'idle' }), holdMs)
    },

    clearJackpot: () => set({ jackpotPop: null }),
    }),
    {
      name: 'ragdoll-coin-pusher-v1',
      version: 1,
      // localStorage 唔可用（私隱模式等）時 createJSONStorage 會靜靜降級
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        credits: s.credits,
        totalWin: s.totalWin,
        shots: s.shots,
        tower: s.tower,
        jp: s.jp,
        muted: s.muted,
      }),
      // 存檔可能被改過 / 損壞：逐個欄位驗證
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>
        const jp = (p.jp ?? {}) as Partial<GameState['jp']>
        return {
          ...current,
          credits: num(p.credits, START_CREDITS),
          totalWin: num(p.totalWin, 0),
          shots: num(p.shots, 0),
          tower: Math.min(num(p.tower, 0), TOWER_GOAL - 1),
          jp: {
            jp1: num(jp.jp1, JP_BASE.jp1, JP_BASE.jp1),
            jp2: num(jp.jp2, JP_BASE.jp2, JP_BASE.jp2),
            jp3: num(jp.jp3, JP_BASE.jp3, JP_BASE.jp3),
          },
          muted: p.muted === true,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) audio.setMuted(state.muted)
      },
    },
  ),
)
