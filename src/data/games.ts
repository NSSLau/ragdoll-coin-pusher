export type GameId = 'whack' | 'wheel' | 'gacha'

export interface GameDef {
  id: GameId
  name: string
  emoji: string
  tagline: string
  rules: string
  /** 一局幾多秒（急迫感只喺局內） */
  duration: number
  /** 每局消耗小遊戲券 */
  cost: number
  /** 分數 → 積分（有保底，輸都唔會得 0） */
  toPoints: (score: number) => number
  /** 結算畫面文字 */
  resultText: (score: number) => string
}

export const GAMES: Record<GameId, GameDef> = {
  whack: {
    id: 'whack',
    name: '貓爪急擊',
    emoji: '🐾',
    tagline: '20 秒，見到貓仔就撳！',
    rules: '貓仔會喺 9 個洞隨機彈出，快手撳佢。金色貓 30 分；連續命中有連擊加成。',
    duration: 20,
    cost: 2,
    toPoints: (s) => 5 + Math.round(s / 5),
    resultText: (s) => `總分 ${s}`,
  },
  wheel: {
    id: 'wheel',
    name: '幸運輪盤',
    emoji: '🎡',
    tagline: '7 秒內撳停，睇邊格！',
    rules: '輪盤會越轉越快又慢，撳「停」令佢停落。指針指住嘅格就係積分。7 秒內唔撳會自動停。',
    duration: 7,
    cost: 3,
    toPoints: (s) => s,
    resultText: (s) => `轉到 ${s} 積分格`,
  },
  gacha: {
    id: 'gacha',
    name: '扭蛋狂搖',
    emoji: '🥚',
    tagline: '8 秒狂撳，搖出金扭蛋！',
    rules: '用盡力連撳扭蛋機搖晃，搖滿 40 下開金扭蛋。搖得越多，扭蛋越高級。',
    duration: 8,
    cost: 5,
    toPoints: (s) => (s >= 40 ? 80 : s >= 28 ? 50 : s >= 16 ? 30 : 15),
    resultText: (s) =>
      `搖咗 ${s} 下 · ${s >= 40 ? '🥇 金扭蛋' : s >= 28 ? '🥈 銀扭蛋' : s >= 16 ? '🥉 銅扭蛋' : '🥚 普通扭蛋'}`,
  },
}

export const GAME_LIST: GameDef[] = [GAMES.whack, GAMES.wheel, GAMES.gacha]
