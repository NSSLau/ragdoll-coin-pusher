import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { audio } from '../utils/AudioFX'
import { GAMES, type GameId } from '../data/games'
import { PRIZE_MAP, TICKET_CAP } from '../data/prizes'

export type View = 'lobby' | 'game'
export type Panel = 'none' | 'hub' | 'shop' | 'minigame'
export type ShopTab = 'exchange' | 'mine'
export type Mood = 'idle' | 'shoot' | 'win' | 'jackpot' | 'dizzy' | 'sleep'

export const START_CREDITS = 300
export const START_TICKETS = 3
export const TOWER_GOAL = 100 // 運氣值滿 100 先喺中間生成金幣高塔
const TICKET_EVERY_SHOTS = 100 // 每射 100 幣送 1 張小遊戲券

// 彩池：每注只注入約 6%（之前係 460%，所以太易爆）；中獎改為機率
const JP_BASE = { jp1: 20, jp2: 60, jp3: 150 }
const JP_GROW = { jp1: 0.01, jp2: 0.02, jp3: 0.03 } // 每射一幣累積
const JP_CHANCE = { 1: 0.12, 2: 0.15, 3: 0.03 } // 白金幣／金磚／塔倒 落咗之後中獎機率

export interface WinPop {
  id: number
  amount: number
}
export interface JackpotPop {
  id: number
  tier: 1 | 2 | 3
  amount: number
}
export interface BurstPop {
  id: number
  count: number
  level: 1 | 2 | 3
}

interface GameState {
  view: View
  panel: Panel
  shopTab: ShopTab
  activeGame: GameId | null

  credits: number
  totalWin: number
  shots: number
  tower: number // 運氣值 0..99，滿 100 疊塔
  gateHits: number // 累計射中缺口次數
  streak: number // 連中
  jp: { jp1: number; jp2: number; jp3: number }

  points: number // 積分（小遊戲／里程碑賺取，用嚟換獎品）
  tickets: number // 小遊戲券
  owned: Record<string, number> // 已擁有收藏品
  best: Partial<Record<GameId, number>>

  turbo: boolean
  muted: boolean
  mood: Mood
  winPop: WinPop | null
  jackpotPop: JackpotPop | null
  burstPop: BurstPop | null
  toast: { id: number; text: string } | null

  goGame: () => void
  goLobby: () => void
  setTurbo: (v: boolean) => void
  toggleMute: () => void
  showToast: (text: string) => void

  openPanel: (p: Panel, tab?: ShopTab) => void
  closePanel: () => void
  selectGame: (id: GameId) => void

  /** 射幣到達缺口：更新運氣值、連中、累計命中；返回需要觸發嘅獎勵 */
  gateResult: (hit: boolean, perfect: boolean, lane: -1 | 0 | 1) => { luckFull: boolean; ticket: boolean; bonus: boolean }

  /** 扣 1 幣、累積 JP */
  spend: () => { ok: boolean; towerReady: boolean }
  collect: (value: number) => void
  awardJackpot: (tier: 1 | 2 | 3) => void
  /** 擲機率；中咗就派彩並返回 true */
  tryJackpot: (tier: 1 | 2 | 3) => boolean
  refill: () => void
  /** 射幣失敗（引擎冇位）退返 1 幣 */
  refund: () => void
  setMood: (m: Mood, holdMs?: number) => void
  clearJackpot: () => void

  addPoints: (n: number) => void
  addTicket: (n: number, silent?: boolean) => void
  consumeTicket: () => boolean
  finishGame: (id: GameId, score: number) => number
  buyPrize: (id: string) => { ok: boolean; msg: string }
  setBurst: (count: number, level: 1 | 2 | 3) => void
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
      panel: 'none',
      shopTab: 'exchange',
      activeGame: null,

      credits: START_CREDITS,
      totalWin: 0,
      shots: 0,
      tower: 0,
      gateHits: 0,
      streak: 0,
      jp: { ...JP_BASE },

      points: 0,
      tickets: START_TICKETS,
      owned: {},
      best: {},

      turbo: false,
      muted: false,
      mood: 'idle',
      winPop: null,
      jackpotPop: null,
      burstPop: null,
      toast: null,

      goGame: () => set({ view: 'game', turbo: false, panel: 'none' }),
      goLobby: () => set({ view: 'lobby', turbo: false, panel: 'none' }),
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
        }, 2000)
      },

      openPanel: (panel, tab) => set((s) => ({ panel, turbo: false, shopTab: tab ?? s.shopTab })),
      closePanel: () => set({ panel: 'none', activeGame: null }),
      selectGame: (id) => set({ panel: 'minigame', activeGame: id }),

      spend: () => {
        const s = get()
        if (s.credits < 1) {
          s.setMood('dizzy', 1200)
          return { ok: false, towerReady: false }
        }
        const towerReady = false
        const shots = s.shots + 1
        set({
          credits: s.credits - 1,
          shots,
          jp: {
            jp1: s.jp.jp1 + JP_GROW.jp1,
            jp2: s.jp.jp2 + JP_GROW.jp2,
            jp3: s.jp.jp3 + JP_GROW.jp3,
          },
        })
        if (shots % TICKET_EVERY_SHOTS === 0) get().addTicket(1)
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
        get().addPoints([20, 50, 150][tier - 1])
        if (tier >= 2) get().addTicket(1)
        get().setMood('jackpot', 3200)
      },

      tryJackpot: (tier) => {
        if (Math.random() >= JP_CHANCE[tier]) return false
        get().awardJackpot(tier)
        return true
      },

      refill: () => set((s) => ({ credits: s.credits + 200 })),

      refund: () =>
        set((s) => ({
          credits: s.credits + 1,
          shots: Math.max(0, s.shots - 1),
        })),

      gateResult: (hit, perfect, lane) => {
        const s = get()
        // 中線難，運氣值多；兩側易，運氣值少
        const gain = lane === 0 ? (perfect ? 7 : 5) : perfect ? 4 : 3
        const luck = s.tower + (hit ? gain : 1)
        const luckFull = luck >= TOWER_GOAL
        if (!hit) {
          set({ streak: 0, tower: luckFull ? 0 : luck })
          return { luckFull, ticket: false, bonus: false }
        }
        const hits = s.gateHits + 1
        const streak = s.streak + 1
        set({ gateHits: hits, streak, tower: luckFull ? 0 : luck })
        // 每 3 次命中送 1 張小遊戲券；連中每 3 次 Bonus 掉落一陣金幣
        return { luckFull, ticket: hits % 3 === 0, bonus: streak % 3 === 0 }
      },

      setMood: (mood, holdMs = 0) => {
        clearTimeout(moodTimer)
        set({ mood })
        if (holdMs > 0) moodTimer = setTimeout(() => set({ mood: 'idle' }), holdMs)
      },

      clearJackpot: () => set({ jackpotPop: null }),

      addPoints: (n) => {
        if (n > 0) set((s) => ({ points: s.points + Math.floor(n) }))
      },

      addTicket: (n, silent) => {
        const before = get().tickets
        const next = Math.min(TICKET_CAP, before + n)
        if (next === before) return
        set({ tickets: next })
        if (!silent) {
          audio.ticket()
          get().showToast(`獲得小遊戲券 +${next - before} 🎟️`)
        }
      },

      consumeTicket: () => {
        if (get().tickets < 1) return false
        set((s) => ({ tickets: s.tickets - 1 }))
        return true
      },

      finishGame: (id, score) => {
        const pts = GAMES[id].toPoints(score)
        set((s) => ({
          points: s.points + pts,
          best: { ...s.best, [id]: Math.max(s.best[id] ?? 0, score) },
        }))
        return pts
      },

      buyPrize: (id) => {
        const prize = PRIZE_MAP[id]
        const s = get()
        if (!prize) return { ok: false, msg: '搵唔到呢件獎品' }
        if (prize.comingSoon) return { ok: false, msg: '即將開放' }
        if (s.points < prize.cost) return { ok: false, msg: `積分唔夠（仲差 ${prize.cost - s.points}）` }
        if (prize.kind === 'collectible') {
          if ((s.owned[id] ?? 0) >= (prize.limit ?? 1)) return { ok: false, msg: '你已經擁有呢件' }
          set({ points: s.points - prize.cost, owned: { ...s.owned, [id]: (s.owned[id] ?? 0) + 1 } })
        } else if (prize.kind === 'coins') {
          set({ points: s.points - prize.cost, credits: s.credits + (prize.amount ?? 0) })
        } else {
          if (s.tickets >= TICKET_CAP) return { ok: false, msg: `小遊戲券已滿（上限 ${TICKET_CAP}）` }
          set({
            points: s.points - prize.cost,
            tickets: Math.min(TICKET_CAP, s.tickets + (prize.amount ?? 0)),
          })
        }
        return { ok: true, msg: `已兌換「${prize.name}」` }
      },

      setBurst: (count, level) => set({ burstPop: { id: ++popId, count, level } }),
    }),
    {
      name: 'ragdoll-coin-pusher-v1',
      version: 2,
      // localStorage 唔可用（私隱模式等）時 createJSONStorage 會靜靜降級
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        credits: s.credits,
        totalWin: s.totalWin,
        shots: s.shots,
        tower: s.tower,
        gateHits: s.gateHits,
        jp: s.jp,
        muted: s.muted,
        points: s.points,
        tickets: s.tickets,
        owned: s.owned,
        best: s.best,
      }),
      // 存檔可能被改過 / 損壞：逐個欄位驗證
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>
        const jp = (p.jp ?? {}) as Partial<GameState['jp']>
        const owned: Record<string, number> = {}
        for (const [k, v] of Object.entries(p.owned ?? {})) {
          if (PRIZE_MAP[k] && typeof v === 'number' && Number.isInteger(v) && v > 0) owned[k] = v
        }
        const best: Partial<Record<GameId, number>> = {}
        for (const id of Object.keys(GAMES) as GameId[]) {
          const v = p.best?.[id]
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) best[id] = v
        }
        return {
          ...current,
          credits: num(p.credits, START_CREDITS),
          totalWin: num(p.totalWin, 0),
          shots: num(p.shots, 0),
          tower: Math.min(num(p.tower, 0), TOWER_GOAL - 1),
          gateHits: Math.floor(num(p.gateHits, 0)),
          jp: {
            // 舊版存檔嘅彩池（動輒幾百）超出新上限就重設
            jp1: Math.min(num(jp.jp1, JP_BASE.jp1, JP_BASE.jp1), JP_BASE.jp1 * 3) || JP_BASE.jp1,
            jp2: Math.min(num(jp.jp2, JP_BASE.jp2, JP_BASE.jp2), JP_BASE.jp2 * 3) || JP_BASE.jp2,
            jp3: Math.min(num(jp.jp3, JP_BASE.jp3, JP_BASE.jp3), JP_BASE.jp3 * 3) || JP_BASE.jp3,
          },
          muted: p.muted === true,
          points: Math.floor(num(p.points, 0)),
          tickets: Math.min(TICKET_CAP, Math.floor(num(p.tickets, START_TICKETS))),
          owned,
          best,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) audio.setMuted(state.muted)
      },
    },
  ),
)
