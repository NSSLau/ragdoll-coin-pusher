import type { SavedTable } from '../engine/PusherEngine'
import { nextBossAt, useAdventure } from '../adventure/adventureStore'

/** 檯面殘局 + 闖關進度存檔（localStorage）：退出重入唔會重新預鋪／塌塔刷幣 */
const KEY = 'rcp-table-v1'

interface Blob {
  table: SavedTable
  dist?: number
  bossN?: number
}

export function loadTable(): SavedTable | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const b = JSON.parse(raw) as Partial<Blob>
    const bossN = Math.floor(Number(b.bossN))
    const dist = Number(b.dist)
    if (Number.isFinite(bossN) && bossN >= 0 && bossN < 1e6 && Number.isFinite(dist) && dist >= 0) {
      const d = Math.min(dist, nextBossAt(bossN))
      useAdventure.setState({ bossN, dist: d, shown: d })
    }
    return b.table && b.table.v === 1 ? b.table : null
  } catch {
    return null
  }
}

export function saveTable(table: SavedTable) {
  try {
    const a = useAdventure.getState()
    const blob: Blob = { table, dist: a.dist, bossN: a.bossN }
    localStorage.setItem(KEY, JSON.stringify(blob))
  } catch {
    /* 私隱模式 / 容量滿：靜靜忽略 */
  }
}
