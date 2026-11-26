import * as THREE from 'three'

/* ------------------------------------------------------------------ */
/*  素材路徑：全部走 import.meta.env.BASE_URL，GitHub Pages 子路徑先會正常  */
/* ------------------------------------------------------------------ */
export const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/${name}.jpeg`

export const BG_LOBBY = assetUrl('lobby-bg-universal')
export const BG_TABLET = assetUrl('tablet-ambient-backdrop')
export const CABINET_FRAME = assetUrl('cabinet-frame-9x16')
export const BG_MINIGAME = assetUrl('minigame-bg-9x16')
export const BG_SHOP = assetUrl('shop-bg-9x16') // 留待寵物房使用

const ATLAS_FILES = {
  atlas1: assetUrl('ragdoll-atlas-1'),
  atlas2: assetUrl('ragdoll-atlas-2'),
  atlas3: assetUrl('ragdoll-atlas-3'),
  atlas5: assetUrl('ragdoll-atlas-5'),
  lobby: assetUrl('lobby-assets-atlas'),
  // 機台無縫材質（machine-textures-2x2 切成四張 512）
  tileFloor: assetUrl('tiles/tile_floor'),
  tileRear: assetUrl('tiles/tile_rear'),
  tileFront: assetUrl('tiles/tile_front'),
  tileQuilt: assetUrl('tiles/tile_quilt'),
} as const
type AtlasId = keyof typeof ATLAS_FILES

/* ------------------------------------------------------------------ */
/*  精靈圖鍵名（由左至右、由上至下）                                      */
/* ------------------------------------------------------------------ */
const ATLAS1_KEYS = [
  'cat_cheer', 'cat_bow', 'cat_royal', 'cat_devil',
  'coin_paw', 'ball_blue', 'ball_gold_wing', 'gem_paw',
  'wheel', 'btn_paw_pink', 'frame_cat_ear', 'taiyaki',
  'fx_star', 'fx_hearts', 'crown', 'fx_boom',
] as const

const ATLAS2_KEYS = [
  'cat_sleep', 'cat_wizard', 'cat_rocket', 'cat_dizzy',
  'gold_bar', 'yarn', 'coin_platinum', 'chest',
  'panel_cat', 'bell_bow', 'btn_bolt', 'coin_stack',
  'comet_coin', 'rainbow_ring', 'coin_burst', 'ball_teal',
] as const

// atlas3 第 1 行係 3D 貼圖（另行處理），所以由第 2 行開始
const ATLAS3_KEYS = [
  'frame_pink', 'card_frame', 'ribbon_red', 'frame_gold_ribbon',
  'gacha_ball', 'cat_cannon', 'canister', 'key_paw',
  'btn_ok', 'btn_fire', 'progress_bar', 'magic_circle',
] as const

// 大廳圖集：牌匾同綠掣跨格，用自訂矩形切；其餘按 4x4 格
const LOBBY_CELL_KEYS = [
  'badge_ragdoll', 'badge_forest', 'badge_ocean', 'badge_space',
  'badge_pudding', null, null, 'lock',
  'icon_book', 'icon_trophy', 'icon_puzzle', 'icon_bag',
  'icon_gear', 'icon_sound', 'icon_arrow', 'icon_sun',
] as const
const LOBBY_CUSTOM = ['plaque', 'btn_start'] as const

// 由 scripts/slice_atlases.py 切好、已去背嘅透明 PNG（public/assets/sprites/<key>.png）
const PNG_SPRITES = [
  // branch-games-atlas：齊射按鈕 + 分支小遊戲
  'bg_mode1', 'bg_mode3', 'bg_mode5', 'bg_star',
  'bg_egg_bronze', 'bg_egg_silver', 'bg_egg_gold', 'bg_egg_open',
  'bg_wheel', 'bg_hub', 'bg_stand', 'bg_chest',
  'bg_card_back', 'bg_card_face', 'bg_high', 'bg_low',
  // special-items-atlas：特殊道具 / 獎勵圖示 / 巨型貓爪 / 布偶貓小窩立繪
  'sp_gacha_front', 'sp_gacha_side', 'sp_gacha_open', 'sp_rainbow_cat_ball',
  'sp_gem_front', 'sp_gem_side', 'sp_cat_bell', 'sp_fish_token',
  'sp_magic_circle', 'sp_reward_ticket', 'sp_reward_score', 'sp_reward_luck',
  'sp_drop_beam', 'adv_giant_paw', 'pet_cat_idle', 'pet_cat_happy',
  // ragdoll-atlas-4：射擊
  'cannon_mid', 'cannon_mid_fire', 'cannon_left', 'cannon_right', 'gate_board', 'gate_trim', 'gate_window',
  'fx_hit_star', 'payout_slot', 'gutter_cover', 'payout_beam', 'fx_slot_flash',
  'plaque_burst', 'plaque_ribbon', 'plaque_flags', 'plaque_shield',
  // minigames-atlas
  'mg_hole', 'mg_cat_pop', 'mg_cat_gold', 'mg_cat_hit', 'mg_wheel', 'mg_pointer', 'mg_hub', 'mg_flash',
  'mg_gacha', 'mg_egg_bronze', 'mg_egg_silver', 'mg_egg_gold', 'mg_egg_open', 'mg_num3', 'mg_num2', 'mg_num1',
  // ui-icons-atlas
  'ui_ticket', 'ui_star', 'ui_coin', 'ui_clover', 'ui_luck_frame', 'ui_luck_fill',
  'ui_jp_pink', 'ui_jp_cyan', 'ui_jp_gold', 'ui_flame', 'ui_target', 'ui_check', 'ui_gear', 'ui_sound', 'ui_crown', 'ui_wand',
  // adventure-pet-atlas：闖關（pet_* 切片留待寵物房先載入）
  'adv_hero_walk1', 'adv_hero_walk2', 'adv_hero_slash', 'adv_hero_dizzy', 'adv_mouse', 'adv_clown', 'adv_monkey', 'adv_lion',
] as const

export type SpriteKey =
  | (typeof ATLAS1_KEYS)[number]
  | (typeof ATLAS2_KEYS)[number]
  | (typeof ATLAS3_KEYS)[number]
  | Exclude<(typeof LOBBY_CELL_KEYS)[number], null>
  | (typeof LOBBY_CUSTOM)[number]
  | (typeof PNG_SPRITES)[number]

export interface Sprite {
  key: SpriteKey
  canvas: HTMLCanvasElement
  url: string
  width: number
  height: number
}

export interface AtlasStore {
  sprites: Record<SpriteKey, Sprite>
  /** 3D 無縫貼圖（floor 來自 atlas3，其餘來自 atlas5 嘅 2×2 方塊） */
  tiles: {
    floor: HTMLCanvasElement // 紫絨貓爪底板
    wall: HTMLCanvasElement // 粉白條紋側牆
    groove: HTMLCanvasElement // 金紅斜紋派彩斜坡 / 吞幣溝
    pusher: HTMLCanvasElement // 金雕花推板頂面
    gutter: HTMLCanvasElement // 深紅菱格邊溝斜坡
    rear: HTMLCanvasElement // 粉白金紋後固定板
    front: HTMLCanvasElement // 紅白馬戲團前移動擋板（8 對條紋 / 張）
    quilt: HTMLCanvasElement // 深紅菱格絨面（推板前牆）
  }
  /** 幣面（圓形裁切，直接貼圓柱頂底） */
  coinFaces: { gold: HTMLCanvasElement; platinum: HTMLCanvasElement }
}

/* ------------------------------------------------------------------ */
/*  去背：由四條外邊緣向內 BFS Flood-Fill（只清走同邊緣連通嘅白色）           */
/*  → 布偶貓白毛臉、胸口因為被深色外框包住，唔會被誤去除                      */
/* ------------------------------------------------------------------ */
export const WHITE_THRESHOLD = 235

export function floodFillKeyOut(img: ImageData, threshold = WHITE_THRESHOLD): void {
  const { width: w, height: h, data } = img
  const n = w * h
  const removed = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  const tryPush = (i: number) => {
    if (removed[i]) return
    const p = i * 4
    if (data[p] > threshold && data[p + 1] > threshold && data[p + 2] > threshold) {
      removed[i] = 1
      queue[tail++] = i
    }
  }

  // 種子：四條外邊緣
  for (let x = 0; x < w; x++) {
    tryPush(x)
    tryPush((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    tryPush(y * w)
    tryPush(y * w + w - 1)
  }

  // 4 鄰域擴散
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    if (x > 0) tryPush(i - 1)
    if (x < w - 1) tryPush(i + 1)
    if (y > 0) tryPush(i - w)
    if (y < h - 1) tryPush(i + w)
  }

  // 羽化：與透明區相鄰嘅保留像素（1px → alpha 150，2px → alpha 225）
  const ring = new Uint8Array(n) // 1 = 第一圈, 2 = 第二圈
  const touchesRemoved = (i: number, mask: Uint8Array, want: number) => {
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (mask[ny * w + nx] === want) return true
      }
    }
    return false
  }
  for (let i = 0; i < n; i++) {
    if (!removed[i] && touchesRemoved(i, removed, 1)) ring[i] = 1
  }
  for (let i = 0; i < n; i++) {
    if (!removed[i] && !ring[i] && touchesRemoved(i, ring, 1)) ring[i] = 2
  }

  for (let i = 0; i < n; i++) {
    const a = removed[i] ? 0 : ring[i] === 1 ? 150 : ring[i] === 2 ? 225 : 255
    data[i * 4 + 3] = a
  }
}

/* ------------------------------------------------------------------ */
/*  Canvas 小工具                                                       */
/* ------------------------------------------------------------------ */
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas 不可用')
  return ctx
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 鄰格物件滲入嚟（例如上一行綠掣底部）會喺格邊留下碎條：
 * 將 alpha 做連通分析，貼住格邊而又唔係最大嗰塊嘅，全部清走。
 */
function removeEdgeSpill(img: ImageData): void {
  const { width: w, height: h, data } = img
  const label = new Int32Array(w * h) // 0 = 未訪問
  const sizes: number[] = [0]
  const touches: boolean[] = [false]
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (label[start] || data[start * 4 + 3] <= 8) continue
    const id = sizes.length
    sizes.push(0)
    touches.push(false)
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const i = stack.pop() as number
      sizes[id]++
      const x = i % w
      const y = (i - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches[id] = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (!label[j] && data[j * 4 + 3] > 8) {
            label[j] = id
            stack.push(j)
          }
        }
      }
    }
  }
  let biggest = 1
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[biggest]) biggest = i
  for (let i = 0; i < w * h; i++) {
    const id = label[i]
    if (id && id !== biggest && touches[id]) data[i * 4 + 3] = 0
  }
}

/** 裁出 rect，做 flood-fill 去背，再按 alpha 範圍裁到貼身 */
function sliceKeyed(src: HTMLCanvasElement, r: Rect, dropEdgeSpill = false): HTMLCanvasElement {
  const sctx = ctx2d(src)
  const img = sctx.getImageData(r.x, r.y, r.w, r.h)
  floodFillKeyOut(img)
  if (dropEdgeSpill) removeEdgeSpill(img)

  // 貼身 bbox
  let minX = r.w
  let minY = r.h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (img.data[(y * r.w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    minX = 0
    minY = 0
    maxX = r.w - 1
    maxY = r.h - 1
  }
  const pad = 2
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(r.w - 1, maxX + pad)
  maxY = Math.min(r.h - 1, maxY + pad)

  const full = makeCanvas(r.w, r.h)
  ctx2d(full).putImageData(img, 0, 0)
  const out = makeCanvas(maxX - minX + 1, maxY - minY + 1)
  ctx2d(out).drawImage(full, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** 非白色內容嘅 bbox（用嚟搵 3D 貼圖方塊本體） */
function contentBBox(src: HTMLCanvasElement, r: Rect): Rect {
  const img = ctx2d(src).getImageData(r.x, r.y, r.w, r.h)
  let minX = r.w
  let minY = r.h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const p = (y * r.w + x) * 4
      const white =
        img.data[p] > WHITE_THRESHOLD && img.data[p + 1] > WHITE_THRESHOLD && img.data[p + 2] > WHITE_THRESHOLD
      if (!white) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return r
  return { x: r.x + minX, y: r.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** 3D 貼圖：由方塊本體向內裁 8%，避開白邊同圓角外框 */
export const TILE_INSET = 0.08
function sliceTile(src: HTMLCanvasElement, cell: Rect): HTMLCanvasElement {
  const body = contentBBox(src, cell)
  const ix = Math.round(body.w * TILE_INSET)
  const iy = Math.round(body.h * TILE_INSET)
  const r = { x: body.x + ix, y: body.y + iy, w: body.w - ix * 2, h: body.h - iy * 2 }
  const out = makeCanvas(r.w, r.h)
  ctx2d(out).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return out
}

/** 圓形幣面：以 (cx,cy,r)（相對格仔嘅比例）裁正方形，貼落 CylinderGeometry 頂底面 */
function sliceCoinFace(src: HTMLCanvasElement, cell: Rect, cx: number, cy: number, radius: number): HTMLCanvasElement {
  const size = Math.round(cell.w * radius * 2)
  const out = makeCanvas(256, 256)
  ctx2d(out).drawImage(
    src,
    cell.x + cell.w * cx - size / 2,
    cell.y + cell.h * cy - size / 2,
    size,
    size,
    0,
    0,
    256,
    256,
  )
  return out
}

/** 畫成 THREE 無縫重複貼圖 */
export function makeRepeatTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatX, repeatY)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

export function makeSpriteTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

/* ------------------------------------------------------------------ */
/*  載入                                                                */
/* ------------------------------------------------------------------ */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`圖片載入失敗：${url}`))
    img.src = url
  })
}

function toBlobUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob 失敗'))), 'image/png')
  })
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = makeCanvas(img.naturalWidth, img.naturalHeight)
  ctx2d(c).drawImage(img, 0, 0)
  return c
}

const cellRect = (img: HTMLCanvasElement, col: number, row: number): Rect => {
  const cw = img.width / 4
  const ch = img.height / 4
  return { x: Math.round(col * cw), y: Math.round(row * ch), w: Math.round(cw), h: Math.round(ch) }
}

let atlasPromise: Promise<AtlasStore> | null = null
let atlasStore: AtlasStore | null = null

export function loadAtlas(onProgress?: (done: number, total: number) => void): Promise<AtlasStore> {
  if (atlasPromise) return atlasPromise
  atlasPromise = (async () => {
    const ids = Object.keys(ATLAS_FILES) as AtlasId[]
    let done = 0
    const canvases = {} as Record<AtlasId, HTMLCanvasElement>
    await Promise.all(
      ids.map(async (id) => {
        canvases[id] = imageToCanvas(await loadImage(ATLAS_FILES[id]))
        onProgress?.(++done, ids.length)
      }),
    )

    const pending: Array<{ key: SpriteKey; canvas: HTMLCanvasElement }> = []

    const sliceGrid = (id: AtlasId, keys: readonly (string | null)[], rowOffset = 0, dropEdgeSpill = false) => {
      keys.forEach((key, i) => {
        if (!key) return
        const col = i % 4
        const row = Math.floor(i / 4) + rowOffset
        pending.push({
          key: key as SpriteKey,
          canvas: sliceKeyed(canvases[id], cellRect(canvases[id], col, row), dropEdgeSpill),
        })
      })
    }

    sliceGrid('atlas1', ATLAS1_KEYS)
    sliceGrid('atlas2', ATLAS2_KEYS)
    sliceGrid('atlas3', ATLAS3_KEYS, 1) // 第 1 行（Row 0）係 3D 貼圖，唔做去背
    sliceGrid('lobby', LOBBY_CELL_KEYS, 0, true)
    pending.push({ key: 'plaque', canvas: sliceKeyed(canvases.lobby, { x: 600, y: 545, w: 845, h: 335 }) })
    pending.push({ key: 'btn_start', canvas: sliceKeyed(canvases.lobby, { x: 695, y: 895, w: 690, h: 225 }) })

    const sprites = {} as Record<SpriteKey, Sprite>
    await Promise.all(
      PNG_SPRITES.map(async (key) => {
        const url = `${import.meta.env.BASE_URL}assets/sprites/${key}.png`
        const canvas = imageToCanvas(await loadImage(url))
        sprites[key] = { key, canvas, url, width: canvas.width, height: canvas.height }
      }),
    )
    await Promise.all(
      pending.map(async ({ key, canvas }) => {
        sprites[key] = { key, canvas, url: await toBlobUrl(canvas), width: canvas.width, height: canvas.height }
      }),
    )

    // atlas5：2×2 四張方塊（粉白條紋 / 金雕花 / 金紅斜紋 / 深紅菱格）
    const a5 = canvases.atlas5
    const q = (col: number, row: number): Rect => ({ x: (col * a5.width) / 2, y: (row * a5.height) / 2, w: a5.width / 2, h: a5.height / 2 })
    const tiles = {
      floor: canvases.tileFloor, // 紫絨星芒貓爪地板（新材質整張直用）
      wall: sliceTile(a5, q(0, 0)),
      pusher: sliceTile(a5, q(1, 0)),
      groove: sliceTile(a5, q(0, 1)),
      gutter: sliceTile(a5, q(1, 1)),
      rear: canvases.tileRear,
      front: canvases.tileFront,
      quilt: canvases.tileQuilt,
    }

    const a1 = canvases.atlas1
    const a2 = canvases.atlas2
    const coinFaces = {
      gold: sliceCoinFace(a1, cellRect(a1, 0, 1), 0.554, 0.537, 0.325),
      platinum: sliceCoinFace(a2, cellRect(a2, 2, 1), 0.505, 0.542, 0.33),
    }

    atlasStore = { sprites, tiles, coinFaces }
    return atlasStore
  })()
  return atlasPromise
}

export function getAtlas(): AtlasStore {
  if (!atlasStore) throw new Error('Atlas 未載入')
  return atlasStore
}

export function getSprite(key: SpriteKey): Sprite {
  return getAtlas().sprites[key]
}
