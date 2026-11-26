import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { audio } from '../utils/AudioFX'
import { GAMES, type GameId } from '../data/games'
import { PRIZE_MAP, TICKET_CAP } from '../data/prizes'
import type { DockPhase } from '../engine/TowerDock'
import type { SpecialKind } from '../engine/SpecialItems'
import { ACHS, COSTUMES, DAILY, EMPTY_STATS, TIERS, todayKey, type Stats } from '../data/progress'

export type View = 'lobby' | 'game'
export type Panel = 'none' | 'hub' | 'shop' | 'minigame' | 'branch' | 'nest'
export type ShopTab = 'exchange' | 'mine'
export type Mood = 'idle' | 'shoot' | 'win' | 'jackpot' | 'dizzy' | 'sleep'

export const START_CREDITS = 150
export const SHOT_COST = 2 // 射 1 枚硬幣消耗 2 金幣（派彩槽每枚只回 1 枚 → 盲射會蝕本）
export const CREDIT_CAP = 5000 // 持幣上限，溢出部分兌換為積分 + 小遊戲券
export const OVERFLOW_PER_POINT = 5 // 溢出幾多金幣 = 1 積分
export const FIRE_MODES = [1, 3, 5] as const
export type FireMode = (typeof FIRE_MODES)[number]
// 皇家金庫補給（破產救濟）
export const RELIEF_AMOUNT = 50
export const RELIEF_COOLDOWN = 10 * 60 * 1000
export const TASK_AMOUNT = 30
export const TASK_COOLDOWN = 3 * 60 * 1000
export const START_TICKETS = 4
export const TOWER_GOAL = 100 // 運氣值滿 100：掉落皇家寶石 + 側方築塔大幅加速
export const BAR_STREAK = 5 // 連續命中幾多次獎勵 1 塊金磚
// ---- 特殊道具掉落條件（掉入金幣池，推落派彩槽先有獎勵）----
export const GACHA_EVERY_HITS = 28 // 累計命中每 28 次 → 神秘扭蛋球 / 貓咪鈴鐺（二揀一）
export const SPECIAL_COOLDOWN_MS = 45000 // 距離上次分支小遊戲結束至少 45 秒先會再掉落
export const RAINBOW_STREAK = 10 // 連擊 10 / 20 … → 七彩彩虹貓球
// 運氣值滿 → 皇家寶石
// ---- 側方築塔進度（1 = 疊 1 枚金幣；塔陣共 36 枚）----
export const DOCK_FEED_HIT = 1
export const DOCK_FEED_PERFECT = 2
export const DOCK_FEED_LUCK = 15

// 彩池：每注只注入約 6%（之前係 460%，所以太易爆）；中獎改為機率
// 單一 Royal JP 大獎池
const JP_BASE = 100
const JP_GROW = 0.05 // 每射一幣累積
const JP_CHANCE = { 1: 0.05, 2: 0.06, 3: 0.05 } // 白金幣／金磚／塔倒 落咗之後中獎機率

/** 分支小遊戲 / 補給結算用嘅獎勵包 */
export interface Reward {
  credits?: number
  points?: number
  tickets?: number
  luck?: number
  /** 加速築塔（枚金幣） */
  dock?: number
}
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
  jp: number // Royal JP 大獎池

  points: number // 積分（小遊戲／里程碑賺取，用嚟換獎品）
  tickets: number // 小遊戲券
  owned: Record<string, number> // 已擁有收藏品
  best: Partial<Record<GameId, number>>

  stats: Stats
  daily: { date: string; hits: number; collected: number; branch: number; claimed: boolean[] }
  ach: Record<string, number>
  costumes: Record<string, boolean>
  fireMode: FireMode
  branch: SpecialKind | null
  branchId: number
  branchQueue: SpecialKind[]
  /** 分支小遊戲結算後要引擎執行嘅效果（恢復推幣後由機台消化） */
  fx: { dock: number; gem: boolean }
  reliefAt: number
  taskAt: number
  muted: boolean
  mood: Mood
  winPop: WinPop | null
  jackpotPop: JackpotPop | null
  burstPop: BurstPop | null
  toast: { id: number; text: string } | null
  /** 側方築塔台狀態（引擎回報，唔存檔） */
  dock: { layers: number; phase: DockPhase }

  goGame: () => void
  goLobby: () => void
  cycleFireMode: () => void
  toggleMute: () => void
  showToast: (text: string) => void

  openPanel: (p: Panel, tab?: ShopTab) => void
  closePanel: () => void
  selectGame: (id: GameId) => void

  /** 射幣到達缺口：更新運氣值、連中、累計命中；返回需要觸發嘅獎勵 */
  gateResult: (hit: boolean, perfect: boolean, lane: -1 | 0 | 1, mult?: number) => { luckFull: boolean; ticket: boolean; bonus: boolean }

  /** 扣 1 幣、累積 JP */
  spend: (n?: number) => { ok: boolean }
  /** 加金幣（受持幣上限約束，溢出轉積分 + 小遊戲券） */
  addCredits: (n: number) => void
  collect: (value: number) => void
  awardJackpot: (tier: 1 | 2 | 3) => void
  /** 擲機率；中咗就派彩並返回 true */
  tryJackpot: (tier: 1 | 2 | 3) => boolean
  /** 射幣失敗（引擎冇位）退返 n 枚嘅幣 */
  refund: (n?: number) => void
  claimRelief: () => { ok: boolean; msg: string }
  claimTask: () => { ok: boolean; msg: string }
  openBranch: (kind: SpecialKind) => void
  closeBranch: () => void
  grantReward: (r: Reward) => void
  takeFx: () => { dock: number; gem: boolean }
  setMood: (m: Mood, holdMs?: number) => void
  clearJackpot: () => void

  addPoints: (n: number) => void
  addTicket: (n: number, silent?: boolean) => void
  consumeTicket: (n?: number) => boolean
  finishGame: (id: GameId, score: number) => number
  buyPrize: (id: string) => { ok: boolean; msg: string }
  setBurst: (count: number, level: 1 | 2 | 3) => void
  setDock: (layers: number, phase: DockPhase) => void
  addStat: (key: keyof Stats, n?: number) => void
  claimDaily: (i: number) => void
  claimAch: (id: string) => void
  buyCostume: (id: string) => void
  /** 運氣值增加；返回係咪滿咗（滿咗自動歸零） */
  addLuck: (n: number) => boolean
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
      jp: JP_BASE,

      points: 0,
      tickets: START_TICKETS,
      owned: {},
      best: {},

      stats: { ...EMPTY_STATS },
      daily: { date: todayKey(), hits: 0, collected: 0, branch: 0, claimed: [false, false, false] },
      ach: {},
      costumes: {},
      fireMode: 1,
      branch: null,
      branchId: 0,
      branchQueue: [],
      fx: { dock: 0, gem: false },
      reliefAt: 0,
      taskAt: 0,
      muted: false,
      mood: 'idle',
      winPop: null,
      jackpotPop: null,
      burstPop: null,
      toast: null,
      dock: { layers: 0, phase: 'build' },

      goGame: () => set({ view: 'game', panel: 'none' }),
      goLobby: () => set({ view: 'lobby', panel: 'none' }),
      cycleFireMode: () =>
        set((s) => ({ fireMode: FIRE_MODES[(FIRE_MODES.indexOf(s.fireMode) + 1) % FIRE_MODES.length] })),
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

      openPanel: (panel, tab) => set((s) => ({ panel, shopTab: tab ?? s.shopTab })),
      closePanel: () => set({ panel: 'none', activeGame: null }),
      selectGame: (id) => set({ panel: 'minigame', activeGame: id }),

      spend: (n = 1) => {
        const s = get()
        const cost = n * SHOT_COST
        if (s.credits < cost) {
          s.setMood('dizzy', 1200)
          return { ok: false }
        }
        const shots = s.shots + n
        set({
          credits: s.credits - cost,
          shots,
          jp: s.jp + JP_GROW * n,
        })
        if (get().mood === 'idle' || get().mood === 'sleep') get().setMood('shoot', 500)
        return { ok: true }
      },

      addCredits: (n) => {
        if (n <= 0) return
        const s = get()
        const next = s.credits + n
        if (next <= CREDIT_CAP) {
          set({ credits: next })
          return
        }
        const over = next - CREDIT_CAP
        const pts = Math.floor(over / OVERFLOW_PER_POINT)
        set({ credits: CREDIT_CAP, points: s.points + pts })
        get().showToast(`金幣已達上限 ${CREDIT_CAP}！溢出轉為 積分 +${pts}`)
      },

      collect: (value) => {
        get().addCredits(value)
        set((s) => ({ totalWin: s.totalWin + value }))
        get().addStat('collected', value)
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
        const amount = Math.floor(get().jp)
        get().addCredits(amount)
        set((s) => ({
          totalWin: s.totalWin + amount,
          jp: JP_BASE,
          jackpotPop: { id: ++popId, tier, amount },
        }))
        get().addStat('jackpots')
        get().addPoints([20, 50, 150][tier - 1])
        if (tier >= 2) get().addTicket(1)
        get().setMood('jackpot', 3200)
      },

      tryJackpot: (tier) => {
        if (Math.random() >= JP_CHANCE[tier]) return false
        get().awardJackpot(tier)
        return true
      },

      refund: (n = 1) =>
        set((s) => ({
          credits: s.credits + n * SHOT_COST,
          shots: Math.max(0, s.shots - n),
        })),

      claimRelief: () => {
        const s = get()
        const wait = s.reliefAt + RELIEF_COOLDOWN - Date.now()
        if (wait > 0) return { ok: false, msg: `金庫補給冷卻中（仲有 ${Math.ceil(wait / 1000)} 秒）` }
        set({ reliefAt: Date.now() })
        get().addCredits(RELIEF_AMOUNT)
        return { ok: true, msg: `領取皇家金庫補給 +${RELIEF_AMOUNT} 金幣` }
      },

      claimTask: () => {
        const s = get()
        const wait = s.taskAt + TASK_COOLDOWN - Date.now()
        if (wait > 0) return { ok: false, msg: `任務冷卻中（仲有 ${Math.ceil(wait / 1000)} 秒）` }
        set({ taskAt: Date.now() })
        get().addCredits(TASK_AMOUNT)
        return { ok: true, msg: `任務完成！救濟金 +${TASK_AMOUNT} 金幣` }
      },

      openBranch: (kind) => {
        const s = get()
        if (s.panel === 'branch') set({ branchQueue: [...s.branchQueue, kind] })
        else set({ panel: 'branch', branch: kind, branchId: ++popId })
      },

      closeBranch: () => {
        const q = get().branchQueue
        if (q.length) set({ branch: q[0], branchQueue: q.slice(1), branchId: ++popId })
        else set({ panel: 'none', branch: null })
      },

      grantReward: (r) => {
        const g = get()
        if (r.credits) {
          g.addCredits(r.credits)
          set((s) => ({ totalWin: s.totalWin + (r.credits ?? 0) }))
        }
        if (r.points) g.addPoints(r.points)
        if (r.tickets) g.addTicket(r.tickets, true)
        let gem = false
        if (r.luck) gem = g.addLuck(r.luck)
        if (r.dock || gem) set((s) => ({ fx: { dock: s.fx.dock + (r.dock ?? 0), gem: s.fx.gem || gem } }))
      },

      takeFx: () => {
        const fx = get().fx
        if (fx.dock || fx.gem) set({ fx: { dock: 0, gem: false } })
        return fx
      },

      gateResult: (hit, perfect, lane, mult = 1) => {
        const s = get()
        if (!hit) {
          // Miss：連中歸零，運氣值唔加
          set({ streak: 0 })
          return { luckFull: false, ticket: false, bonus: false }
        }
        // 中線難，運氣值多；兩側易，運氣值少
        const base = lane === 0 ? (perfect ? 7 : 5) : perfect ? 4 : 3
        // 連擊 3 次起運氣條累積加快：3 連 ×1.5、4 連 ×1.75、5 連或以上 ×2
        const nextStreak = s.streak + 1
        const mul = nextStreak >= 5 ? 2 : nextStreak === 4 ? 1.75 : nextStreak === 3 ? 1.5 : 1
        const luck = s.tower + Math.round(base * mul * mult)
        const luckFull = luck >= TOWER_GOAL
        const hits = s.gateHits + 1
        const streak = s.streak + 1
        set({ gateHits: hits, streak, tower: luckFull ? 0 : luck })
        get().addStat('hits')
        // 連續命中每 5 次獎勵 1 塊金磚（唔再免費派券）
        return { luckFull, ticket: false, bonus: streak % BAR_STREAK === 0 }
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

      consumeTicket: (n = 1) => {
        if (get().tickets < n) return false
        set((s) => ({ tickets: s.tickets - n }))
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
          set({ points: s.points - prize.cost })
          get().addCredits(prize.amount ?? 0)
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

      setDock: (layers, phase) => set({ dock: { layers, phase } }),

      addStat: (key, n = 1) => {
        const s = get()
        const today = todayKey()
        const d = s.daily.date === today ? s.daily : { date: today, hits: 0, collected: 0, branch: 0, claimed: [false, false, false] }
        const dk = key === 'hits' || key === 'collected' || key === 'branch' ? key : null
        set({
          stats: { ...s.stats, [key]: s.stats[key] + n },
          daily: dk ? { ...d, [dk]: d[dk] + n } : d,
        })
      },

      claimDaily: (i) => {
        const s = get()
        const def = DAILY[i]
        if (!def || s.daily.date !== todayKey() || s.daily.claimed[i] || s.daily[def.key] < def.goal) return
        const claimed = [...s.daily.claimed]
        claimed[i] = true
        set({ daily: { ...s.daily, claimed } })
        get().grantReward(def.reward)
        get().showToast(`每日任務完成：${def.name}`)
      },

      claimAch: (id) => {
        const s = get()
        const def = ACHS.find((a) => a.id === id)
        if (!def) return
        const have = def.tiers.filter((t) => s.stats[def.key] >= t).length
        const done = s.ach[id] ?? 0
        if (have <= done) return
        const t = TIERS[done]
        set({ ach: { ...s.ach, [id]: done + 1 } })
        get().grantReward({ points: t.points, tickets: t.tickets })
        get().showToast(`成就達成：${def.name} · ${t.name}階`)
      },

      buyCostume: (id) => {
        const def = COSTUMES.find((c) => c.id === id)
        const s = get()
        if (!def || s.costumes[id]) return
        if (!get().consumeTicket(def.cost)) {
          get().showToast(`小遊戲券唔夠（需要 ${def.cost} 張）`)
          return
        }
        set({ costumes: { ...s.costumes, [id]: true } })
        get().showToast(`已獲得「${def.name}」`)
      },

      addLuck: (n) => {
        const luck = get().tower + Math.round(n)
        const full = luck >= TOWER_GOAL
        set({ tower: full ? 0 : luck })
        return full
      },
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
        reliefAt: s.reliefAt,
        taskAt: s.taskAt,
        stats: s.stats,
        daily: s.daily,
        ach: s.ach,
        costumes: s.costumes,
      }),
      // 存檔可能被改過 / 損壞：逐個欄位驗證
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>
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
          credits: Math.min(CREDIT_CAP, num(p.credits, START_CREDITS)),
          stats: {
            hits: Math.floor(num(p.stats?.hits, 0)),
            collected: Math.floor(num(p.stats?.collected, 0)),
            jackpots: Math.floor(num(p.stats?.jackpots, 0)),
            boss: Math.floor(num(p.stats?.boss, 0)),
            branch: Math.floor(num(p.stats?.branch, 0)),
          },
          daily:
            p.daily && p.daily.date === todayKey() && Array.isArray(p.daily.claimed)
              ? {
                  date: p.daily.date,
                  hits: num(p.daily.hits, 0),
                  collected: num(p.daily.collected, 0),
                  branch: num(p.daily.branch, 0),
                  claimed: [0, 1, 2].map((i) => p.daily?.claimed?.[i] === true),
                }
              : { date: todayKey(), hits: 0, collected: 0, branch: 0, claimed: [false, false, false] },
          ach: Object.fromEntries(ACHS.map((a) => [a.id, Math.min(4, Math.floor(num(p.ach?.[a.id], 0)))])),
          costumes: Object.fromEntries(COSTUMES.filter((c) => p.costumes?.[c.id] === true).map((c) => [c.id, true])),
          reliefAt: num(p.reliefAt, 0),
          taskAt: num(p.taskAt, 0),
          totalWin: num(p.totalWin, 0),
          shots: num(p.shots, 0),
          tower: Math.min(num(p.tower, 0), TOWER_GOAL - 1),
          gateHits: Math.floor(num(p.gateHits, 0)),
          // 舊版存檔 jp 係物件，或超出新上限就重設
          jp: typeof p.jp === 'number' ? Math.min(num(p.jp, JP_BASE, JP_BASE), JP_BASE * 3) : JP_BASE,
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

// 開發模式：方便喺 console / 自動化測試直接操作遊戲狀態
if (import.meta.env.DEV) (window as unknown as { __game: typeof useGame }).__game = useGame
