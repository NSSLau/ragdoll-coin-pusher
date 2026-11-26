import type { SavedTable } from '../engine/PusherEngine'
import { useAdventure } from '../adventure/adventureStore'

/** 檯面殘局 + 闖關進度存檔（localStorage）：退出重入唔會重新預鋪／塌塔刷幣 */
const KEY = 'rcp-table-v1'

interface Blob {
  table: SavedTable
  stage: number
  wave: number
}

export function loadTable(): SavedTable | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const b = JSON.parse(raw) as Partial<Blob>
    if (b.stage && b.stage >= 1) {
      useAdventure.setState({ stage: Math.floor(b.stage), wave: Math.min(3, Math.max(0, Math.floor(b.wave ?? 0))) })
    }
    return b.table && b.table.v === 1 ? b.table : null
  } catch {
    return null
  }
}

export function saveTable(table: SavedTable) {
  try {
    const a = useAdventure.getState()
    const blob: Blob = { table, stage: a.stage, wave: a.wave }
    localStorage.setItem(KEY, JSON.stringify(blob))
  } catch {
    /* 私隱模式 / 容量滿：靜靜忽略 */
  }
}
