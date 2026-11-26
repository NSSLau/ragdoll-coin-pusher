import * as THREE from 'three'
import { makeRepeatTexture } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  前後雙層機械擋板                                                     */
/*  後板：固定不動，開 3 個正方形缺口（左 / 中 / 右 = 三條射擊線）            */
/*  前板：貼住後板外側（玩家側），左右來回滑動，只有 1 個同尺寸正方形窗口        */
/*  硬幣只有喺「前板窗口 × 後板缺口」重疊位夠闊先穿得過，其餘即撞板 Miss        */
/* ------------------------------------------------------------------ */

export const SCRAPER_Z = -2.45 // 後板位置（同時係推板縮返時刮幣嘅擋板）
export const BOARD_TOP = 3.0

/** 正方形窗口邊長（前板窗口 = 後板缺口，完全同尺寸） */
export const GATE_S = 1.25
export const GATE_HALF = GATE_S / 2
export const GATE_Y0 = 1.8 - GATE_S / 2 // 窗口下緣（中心固定 1.8）
export const GATE_Y1 = GATE_Y0 + GATE_S // 窗口上緣
export const GATE_COIN_Y = (GATE_Y0 + GATE_Y1) / 2
/** 三個後板缺口中心 X（左 / 中 / 右） */
export const LANE_TX = [-1.5, 0, 1.5] as const

export const GATE_AMP = 1.9 // 前板窗口左右擺幅
export const GATE_W = 1.05 // 前板擺動角速度 (rad/s)

/** 硬幣直徑：重疊位至少要有一隻幣咁闊先過得到 */
const COIN_DIAMETER = 0.64
/** 重疊區要比幣直徑再闊 0.29（左右各約 0.145 餘地）先算穿得過；唔夠即撞板彈開 */
export const GATE_TOL = GATE_S - COIN_DIAMETER - 0.29
export const GATE_PERFECT = 0.1 // 幾乎完全對正

/** 前板窗口中心 X（時間 t 秒）：平滑正弦來回 */
export const gateXAt = (t: number) => Math.sin(t * GATE_W) * GATE_AMP

/** 前板：窗口上下各有一條實心框條，令前板係一塊完整嘅「帶孔板」 */
const FRAME_H = 0.22
const FRONT_T = 0.06 // 前板厚度（薄啲，減少視差錯位）
const REAR_T = 0.2 // 後板厚度
/** 前板外面（玩家側）嘅 Z：射幣飛到呢度即撞板／穿窗 */
export const FRONT_FACE_Z = SCRAPER_Z + REAR_T / 2 + FRONT_T
const STRIPE_UNIT = 0.5 // 前板條紋：每對紅白嘅闊度（固定，唔會被拉伸）
const PLATE_EDGE = 2.85 // 前板伸入兩端滑槽
const RAIL_EDGE = 2.9 // 軌道半闊

/** 馬戲團紅白條紋貼圖（一對紅白，帶頂底金線）— 暫用程式佔位，之後可換 plate 貼圖 */
function circusStripeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#fff6ec'
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#d4162f'
  g.fillRect(0, 0, 64, 64)
  const sh = g.createLinearGradient(0, 0, 0, 64)
  sh.addColorStop(0, 'rgba(255,255,255,0.35)')
  sh.addColorStop(0.5, 'rgba(255,255,255,0)')
  sh.addColorStop(1, 'rgba(0,0,0,0.3)')
  g.fillStyle = sh
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#f2c14e'
  g.fillRect(0, 0, 128, 5)
  g.fillRect(0, 59, 128, 5)
  return c
}

interface Ctx {
  std: (map: THREE.Texture | null, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  track: <T extends { dispose(): void }>(o: T) => T
  wallCanvas: HTMLCanvasElement
  /** 後板下半塊底邊高度（高過推板頂面少少） */
  yLow: number
}

interface MovingPiece {
  mesh: THREE.Mesh
  tex: THREE.Texture
}

export class GatePlates {
  readonly group = new THREE.Group()
  private glow: THREE.Mesh
  private left: MovingPiece
  private right: MovingPiece
  private top: MovingPiece
  private bottom: MovingPiece
  private frontFrame = new THREE.Group()

  constructor(ctx: Ctx) {
    const { std, track, wallCanvas, yLow } = ctx
    const bw = RAIL_EDGE * 2

    /* ---------- 後板（固定）：實心板 + 3 個正方形缺口 ---------- */
    const rearTex = (w: number) => track(makeRepeatTexture(wallCanvas, Math.max(0.2, w / 0.72), 1))
    const rearMat = (w: number) => track(std(rearTex(w)))
    // 缺口行嘅實心柱用深紫色：金光缺口先夠對比，玩家一眼睇到邊度穿得過
    const darkMat = std(null, { color: '#3a1456', roughness: 0.7, metalness: 0.15 })
    const rear = (x0: number, x1: number, y0: number, y1: number, dark = false) => {
      const w = x1 - x0
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, y1 - y0, REAR_T)), dark ? darkMat : rearMat(w))
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, SCRAPER_Z)
      this.group.add(m)
    }
    rear(-RAIL_EDGE, RAIL_EDGE, yLow, GATE_Y0 - FRAME_H) // 下半塊（兼做刮幣擋板）
    rear(-RAIL_EDGE, RAIL_EDGE, GATE_Y1 + FRAME_H, BOARD_TOP) // 上半塊
    // 缺口行：窗口之間嘅實心柱（上下框條位置亦封實，同前板重疊）
    rear(-RAIL_EDGE, LANE_TX[0] - GATE_HALF, GATE_Y0 - FRAME_H, GATE_Y1 + FRAME_H)
    rear(LANE_TX[0] + GATE_HALF, LANE_TX[1] - GATE_HALF, GATE_Y0 - FRAME_H, GATE_Y1 + FRAME_H)
    rear(LANE_TX[1] + GATE_HALF, LANE_TX[2] - GATE_HALF, GATE_Y0 - FRAME_H, GATE_Y1 + FRAME_H)
    rear(LANE_TX[2] + GATE_HALF, RAIL_EDGE, GATE_Y0 - FRAME_H, GATE_Y1 + FRAME_H)
    // 窗口上下封條（缺口行上下框條位置，窗口範圍內）
    for (const tx of LANE_TX) {
      rear(tx - GATE_HALF, tx + GATE_HALF, GATE_Y0 - FRAME_H, GATE_Y0)
      rear(tx - GATE_HALF, tx + GATE_HALF, GATE_Y1, GATE_Y1 + FRAME_H)
    }

    // 缺口後面嘅暖光（睇到缺口喺邊）
    this.glow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(bw, GATE_S)),
      track(new THREE.MeshBasicMaterial({ color: '#ffcf5a' })),
    )
    this.glow.position.set(0, GATE_COIN_Y, SCRAPER_Z - REAR_T / 2 - 0.02)
    this.group.add(this.glow)

    // 後板 3 個缺口嘅金邊框（固定）
    const trimMat = std(null, { color: '#f2c14e', metalness: 0.7, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.5 })
    const tbV = track(new THREE.BoxGeometry(0.07, GATE_S + 0.14, 0.12))
    const tbH = track(new THREE.BoxGeometry(GATE_S + 0.14, 0.07, 0.12))
    for (const tx of LANE_TX) {
      for (const sx of [-1, 1]) {
        const v = new THREE.Mesh(tbV, trimMat)
        v.position.set(tx + sx * (GATE_HALF + 0.035), GATE_COIN_Y, SCRAPER_Z - 0.04)
        this.group.add(v)
      }
      for (const sy of [-1, 1]) {
        const h = new THREE.Mesh(tbH, trimMat)
        h.position.set(tx, GATE_COIN_Y + sy * (GATE_HALF + 0.035), SCRAPER_Z - 0.04)
        this.group.add(h)
      }
    }

    /* ---------- 前板（移動）：4 塊件拼成帶方孔嘅板，條紋貼圖錨定喺板上 ---------- */
    const stripe = circusStripeCanvas()
    const mkPiece = (h: number, y: number): MovingPiece => {
      const tex = track(makeRepeatTexture(stripe, 1, 1))
      const mat = track(std(tex, { roughness: 0.45, metalness: 0.1, emissive: '#3a0a14', emissiveIntensity: 0.35 }))
      const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(1, h, FRONT_T)), mat)
      mesh.position.set(0, y, SCRAPER_Z + REAR_T / 2 + FRONT_T / 2)
      this.group.add(mesh)
      return { mesh, tex }
    }
    this.left = mkPiece(GATE_S, GATE_COIN_Y)
    this.right = mkPiece(GATE_S, GATE_COIN_Y)
    this.top = mkPiece(FRAME_H, GATE_Y1 + FRAME_H / 2)
    this.bottom = mkPiece(FRAME_H, GATE_Y0 - FRAME_H / 2)

    // 前板窗口金邊（跟住窗口郁）
    const fz = SCRAPER_Z + REAR_T / 2 + FRONT_T + 0.01
    const fV = track(new THREE.BoxGeometry(0.07, GATE_S + 0.14, 0.06))
    const fH = track(new THREE.BoxGeometry(GATE_S + 0.14, 0.07, 0.06))
    for (const sx of [-1, 1]) {
      const v = new THREE.Mesh(fV, trimMat)
      v.position.set(sx * (GATE_HALF + 0.035), GATE_COIN_Y, fz)
      this.frontFrame.add(v)
    }
    for (const sy of [-1, 1]) {
      const h = new THREE.Mesh(fH, trimMat)
      h.position.set(0, GATE_COIN_Y + sy * (GATE_HALF + 0.035), fz)
      this.frontFrame.add(h)
    }
    this.group.add(this.frontFrame)

    /* ---------- 射擊線指示：後板缺口上方嘅金色箭咀（前板遮住缺口時都知邊條線喺邊） ---------- */
    const arrowGeo = track(new THREE.ConeGeometry(0.14, 0.22, 4))
    const arrowMat = std(null, { color: '#ffd34d', metalness: 0.5, roughness: 0.3, emissive: '#ff9b2e', emissiveIntensity: 0.9 })
    for (const tx of LANE_TX) {
      const arrow = new THREE.Mesh(arrowGeo, arrowMat)
      arrow.rotation.x = Math.PI
      arrow.rotation.y = Math.PI / 4
      arrow.position.set(tx, GATE_Y1 + FRAME_H + 0.3, SCRAPER_Z + 0.12)
      this.group.add(arrow)
    }

    /* ---------- 滑軌 + 螺絲 + 兩端滑槽 ---------- */
    const railMat = std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.28, emissive: '#6a3a00', emissiveIntensity: 0.45 })
    const railGeo = track(new THREE.BoxGeometry(bw, 0.09, 0.3))
    const boltGeo = track(new THREE.SphereGeometry(0.045, 8, 6))
    const boltMat = std(null, { color: '#fff1b8', metalness: 0.9, roughness: 0.2 })
    for (const [ry, dir] of [
      [GATE_Y0 - FRAME_H - 0.045, -1],
      [GATE_Y1 + FRAME_H + 0.045, 1],
    ] as const) {
      const rail = new THREE.Mesh(railGeo, railMat)
      rail.position.set(0, ry, SCRAPER_Z + 0.04)
      this.group.add(rail)
      for (let bx = -bw / 2 + 0.25; bx < bw / 2; bx += 0.5) {
        const bolt = new THREE.Mesh(boltGeo, boltMat)
        bolt.position.set(bx, ry + dir * 0.02, SCRAPER_Z + 0.2)
        this.group.add(bolt)
      }
    }
    const slotMat = std(null, { color: '#2a0a1a', roughness: 0.9 })
    const capGeo = track(new THREE.BoxGeometry(0.16, GATE_S + FRAME_H * 2 + 0.2, 0.42))
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(capGeo, slotMat)
      cap.position.set(sx * (bw / 2 - 0.02), GATE_COIN_Y, SCRAPER_Z + 0.08)
      this.group.add(cap)
    }

    this.update(0, 0)
  }

  /** 前板窗口中心 gx；flash 0..1 缺口後暖光閃爍 */
  update(gx: number, flash: number) {
    const set = (p: MovingPiece, x0: number, x1: number) => {
      const w = Math.max(0.001, x1 - x0)
      p.mesh.scale.x = w
      p.mesh.position.x = (x0 + x1) / 2
      // 條紋錨定喺前板本身：隨板滑動，唔係拉伸
      p.tex.repeat.x = w / STRIPE_UNIT
      p.tex.offset.x = (x0 - gx) / STRIPE_UNIT
    }
    set(this.left, -PLATE_EDGE, gx - GATE_HALF)
    set(this.right, gx + GATE_HALF, PLATE_EDGE)
    set(this.top, -PLATE_EDGE, PLATE_EDGE)
    set(this.bottom, -PLATE_EDGE, PLATE_EDGE)
    this.frontFrame.position.x = gx
    ;(this.glow.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.62 + 0.38 * flash, 0.18 + 0.82 * flash)
  }
}
