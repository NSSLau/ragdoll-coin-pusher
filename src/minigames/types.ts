export interface GameProps {
  /** 剩餘秒數（由外殼管理） */
  timeLeft: number
  duration: number
  score: number
  addScore: (n: number) => void
  /** 遊戲自己提早完結（例如輪盤已停） */
  finish: () => void
}
