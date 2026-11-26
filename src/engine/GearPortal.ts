import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { makeRepeatTexture } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  3D 皇家星象齒輪 × 機械光圈魔術門（取代舊紅白擋板 + 三孔框）                    */
/*  - 外環：香檳金大齒輪順時針公轉，鑲 3 個發光能量環洞口（藍 / 金 / 紫粉）         */
/*  - 中央：6 片金色扇葉機械光圈，張開 → 停留 → 閉合，露出皇家星空傳送門            */
/*  - 左 / 右射擊線瞄準外環洞口經過嘅定位點；中線瞄準中央光圈                      */
/*  - 射入洞口 → 該洞口共鳴充能 5 秒；充能期內射入張開嘅光圈 = 空間折疊（1 變 3）   */
/* ------------------------------------------------------------------ */

export const SCRAPER_Z = -2.45 // 後方實心擋板（物理 + 刮幣）
export const BOARD_TOP = 3.0

export const GEAR_CY = 1.85
export const GATE_COIN_Y = GEAR_CY
export const HOLE_R = 0.52 // 能量環洞口半徑
export const IRIS_HOLE_R = 0.62 // 中央光圈洞口半徑
export const RING_R = IRIS_HOLE_R + HOLE_R + 0.1 // 洞口公轉半徑
export const GEAR_R = RING_R + HOLE_R + 0.22
/** 三條射擊線瞄準點 X（左 / 右 = 外環洞口經過嘅橫軸定位點，中 = 光圈） */
export const LANE_TX = [-RING_R, 0, RING_R] as const
export const GEAR_OMEGA = 0.45 // rad/s，順時針
/** 硬幣中心要落喺洞口中心呢個距離內先穿得過（洞口半徑 − 幣半徑 − 少少餘地） */
export const HOLE_TOL = 0.3 // 自動吸附：洞口中心 0.3 內射到就穿心而過
export const HOLE_PERFECT = 0.07
const HOLE_A0 = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]
export const HOLE_KINDS = ['blue', 'amber', 'purple'] as const
export type HoleKind = (typeof HOLE_KINDS)[number]
const HOLE_COLOR = ['#3aa0ff', '#ffc933', '#d65cff']

export const GEAR_Z = SCRAPER_Z + 0.1 + 0.03 + 0.07 // 齒輪中心 Z（喺後板前面，留真實間距）
const GEAR_T = 0.14
/** 齒輪前面（射幣撞板 / 穿洞嘅平面） */
export const FRONT_FACE_Z = GEAR_Z + GEAR_T / 2 + 0.02

/** 第 k 個洞口喺 t 秒嘅世界座標（順時針公轉） */
export function holePos(k: number, t: number) {
  const a = HOLE_A0[k] - GEAR_OMEGA * t
  return { x: Math.cos(a) * RING_R, y: GEAR_CY + Math.sin(a) * RING_R }
}

/** 中央光圈解鎖時長（秒）：射入外環洞口後解鎖 */
export const IRIS_UNLOCK_S = 6

interface Ctx {
  std: (map: THREE.Texture | null, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  track: <T extends { dispose(): void }>(o: T) => T
  /** 粉白金紋貼圖（圍欄 / 圍裙） */
  trimCanvas: HTMLCanvasElement
  yLow: number
}

function starCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const bg = g.createRadialGradient(256, 256, 20, 256, 256, 360)
  bg.addColorStop(0, '#3a1670')
  bg.addColorStop(1, '#0c0524')
  g.fillStyle = bg
  g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = Math.random() * 1.6 + 0.4
    g.fillStyle = `rgba(255,${230 + Math.random() * 25},${180 + Math.random() * 60},${0.5 + Math.random() * 0.5})`
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  // 星座連線
  g.strokeStyle = 'rgba(255,220,140,0.35)'
  g.lineWidth = 1
  for (let k = 0; k < 6; k++) {
    g.beginPath()
    let x = Math.random() * 512
    let y = Math.random() * 512
    g.moveTo(x, y)
    for (let j = 0; j < 4; j++) {
      x += (Math.random() - 0.5) * 120
      y += (Math.random() - 0.5) * 120
      g.lineTo(x, y)
      g.fillStyle = '#ffe9a8'
      g.fillRect(x - 2, y - 2, 4, 4)
    }
    g.stroke()
  }
  return c
}

function portalCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const bg = g.createRadialGradient(128, 128, 4, 128, 128, 128)
  bg.addColorStop(0, '#fffbe0')
  bg.addColorStop(0.18, '#b8ffd0')
  bg.addColorStop(0.5, '#10b860')
  bg.addColorStop(1, '#04361e')
  g.fillStyle = bg
  g.fillRect(0, 0, 256, 256)
  g.translate(128, 128)
  g.strokeStyle = 'rgba(255,214,90,0.85)'
  g.lineWidth = 2
  for (let a = 0; a < 5; a++) {
    g.beginPath()
    for (let r = 4; r < 120; r += 3) {
      const th = r * 0.09 + (a * Math.PI * 2) / 5
      const x = Math.cos(th) * r
      const y = Math.sin(th) * r
      if (r === 4) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(255,255,255,0.8)'
    g.fillRect((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 2, 2)
  }
  return c
}

export class GearPortal {
  readonly group = new THREE.Group()
  private gear = new THREE.Group()
  private blades: Array<{ mesh: THREE.Mesh; phi: number }> = []
  private holeGlass: THREE.Mesh[] = []
  private holeRims: THREE.Mesh[] = []
  private portal: THREE.Mesh
  private portalMat: THREE.MeshStandardMaterial
  private sights: THREE.Group[] = []
  private holeGroups: THREE.Group[] = []
  private holeFlash = [0, 0, 0]
  private irisRimMat!: THREE.MeshStandardMaterial
  private irisGlowMat!: THREE.MeshBasicMaterial
  private emblem!: THREE.Mesh
  private lockGroup!: THREE.Group
  private lockGlowMat!: THREE.MeshBasicMaterial
  private countBulbs: THREE.Mesh[] = []
  private bulbOff!: THREE.MeshStandardMaterial
  private bulbOn!: THREE.MeshStandardMaterial

  constructor(ctx: Ctx) {
    const { std, track, trimCanvas, yLow } = ctx
    const bw = 2.9 * 2
    const gold = std(null, { color: '#e9c46a', metalness: 0.85, roughness: 0.22, emissive: '#4a2800', emissiveIntensity: 0.2 })
    const champ = std(null, { color: '#f3e0a8', metalness: 0.85, roughness: 0.25, emissive: '#3a2a10', emissiveIntensity: 0.15 })

    /* ---------- 後方星空背板（實心，同物理擋板重疊） ---------- */
    const skyTex = track(new THREE.CanvasTexture(starCanvas()))
    skyTex.colorSpace = THREE.SRGBColorSpace
    const sky = new THREE.Mesh(
      track(new THREE.BoxGeometry(bw, BOARD_TOP - yLow, 0.2)),
      std(skyTex, { emissive: '#ffffff', emissiveMap: skyTex, emissiveIntensity: 0.55, roughness: 0.7 }),
    )
    sky.position.set(0, (BOARD_TOP + yLow) / 2, SCRAPER_Z)
    this.group.add(sky)

    /* ---------- 前圍裙（遮住齒輪下半，砌喺齒輪前面）+ 兩側立柱 + 頂樑 ---------- */
    const trimTex = track(makeRepeatTexture(trimCanvas, bw / 2.4, 1))
    const apronH = 0.98 - yLow
    const apron = new THREE.Mesh(track(new THREE.BoxGeometry(bw, apronH, 0.2)), std(trimTex))
    apron.position.set(0, yLow + apronH / 2, GEAR_Z - 0.02)
    this.group.add(apron)
    const apronCap = new THREE.Mesh(track(new RoundedBoxGeometry(bw + 0.1, 0.1, 0.3, 3, 0.04)), gold)
    apronCap.position.set(0, 0.98 + 0.03, GEAR_Z - 0.02)
    this.group.add(apronCap)
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(track(new RoundedBoxGeometry(0.22, BOARD_TOP - yLow + 0.1, 0.34, 3, 0.05)), gold)
      post.position.set(sx * (2.9 - 0.08), (BOARD_TOP + yLow) / 2, GEAR_Z - 0.02)
      this.group.add(post)
    }
    const beam = new THREE.Mesh(track(new RoundedBoxGeometry(bw + 0.1, 0.14, 0.34, 3, 0.05)), gold)
    beam.position.set(0, BOARD_TOP + 0.06, GEAR_Z - 0.02)
    this.group.add(beam)

    /* ---------- 大齒輪：28 齒 + 3 個能量環洞口 + 中央光圈孔 ---------- */
    const TEETH = 28
    const shape = new THREE.Shape()
    for (let i = 0; i < TEETH; i++) {
      const a0 = (i / TEETH) * Math.PI * 2
      const s = (Math.PI * 2) / TEETH
      const pts: Array<[number, number]> = [
        [a0, GEAR_R - 0.14],
        [a0 + s * 0.2, GEAR_R],
        [a0 + s * 0.45, GEAR_R],
        [a0 + s * 0.65, GEAR_R - 0.14],
      ]
      for (const [a, r] of pts) {
        const x = Math.cos(a) * r
        const y = Math.sin(a) * r
        if (i === 0 && a === a0) shape.moveTo(x, y)
        else shape.lineTo(x, y)
      }
    }
    shape.closePath()
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Path()
      h.absarc(Math.cos(HOLE_A0[k]) * RING_R, Math.sin(HOLE_A0[k]) * RING_R, HOLE_R, 0, Math.PI * 2, true)
      shape.holes.push(h)
    }
    const ih = new THREE.Path()
    ih.absarc(0, 0, IRIS_HOLE_R, 0, Math.PI * 2, true)
    shape.holes.push(ih)
    const gearGeo = track(new THREE.ExtrudeGeometry(shape, { depth: GEAR_T - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 40 }))
    gearGeo.translate(0, 0, -(GEAR_T - 0.04) / 2)
    const gearMesh = new THREE.Mesh(gearGeo, champ)
    this.gear.add(gearMesh)
    // 雕花：兩圈細環 + 外圈星形鉚釘
    for (const r of [GEAR_R - 0.3, RING_R + HOLE_R + 0.1]) {
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(r, 0.022, 8, 96)), gold)
      ring.position.z = GEAR_T / 2
      this.gear.add(ring)
    }
    const studGeo = track(new THREE.OctahedronGeometry(0.06))
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.11
      const stud = new THREE.Mesh(studGeo, gold)
      stud.position.set(Math.cos(a) * (GEAR_R - 0.18), Math.sin(a) * (GEAR_R - 0.18), GEAR_T / 2 + 0.02)
      stud.scale.set(1, 1, 0.6)
      this.gear.add(stud)
    }
    // 能量環：厚實香檳金 3D 圓環框 + 內側彩色發光環 + 半透明發光能量膜（藍 / 金 / 紫粉）
    const frameGeo = track(new RoundedBoxGeometry(0.01, 0.01, 0.01, 1, 0.004))
    void frameGeo
    const rimGeo = track(new THREE.TorusGeometry(HOLE_R + 0.04, 0.085, 16, 56))
    const bezelGeo = track(new THREE.TorusGeometry(HOLE_R + 0.15, 0.035, 12, 56))
    const innerGeo = track(new THREE.TorusGeometry(HOLE_R - 0.07, 0.03, 10, 48))
    const glassGeo = track(new THREE.CircleGeometry(HOLE_R - 0.06, 40))
    for (let k = 0; k < 3; k++) {
      const x = Math.cos(HOLE_A0[k]) * RING_R
      const y = Math.sin(HOLE_A0[k]) * RING_R
      const holeGroup = new THREE.Group()
      holeGroup.position.set(x, y, GEAR_T / 2)
      const frame = new THREE.Mesh(rimGeo, gold)
      const bezel = new THREE.Mesh(bezelGeo, champ)
      holeGroup.add(frame, bezel)
      const inner = new THREE.Mesh(innerGeo, std(null, { color: HOLE_COLOR[k], emissive: HOLE_COLOR[k], emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.3 }))
      inner.position.z = 0.01
      holeGroup.add(inner)
      this.holeRims.push(inner)
      const glass = new THREE.Mesh(
        glassGeo,
        track(new THREE.MeshBasicMaterial({ color: HOLE_COLOR[k], transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })),
      )
      glass.position.z = -0.04
      holeGroup.add(glass)
      this.holeGlass.push(glass)
      this.holeGroups.push(holeGroup)
      this.gear.add(holeGroup)
    }
    // 光圈孔外框：厚金環；張開時亮翠綠光環
    this.irisRimMat = std(null, { color: '#e9c46a', emissive: '#2cff8a', emissiveIntensity: 0, metalness: 0.85, roughness: 0.22 })
    const irisRim = new THREE.Mesh(track(new THREE.TorusGeometry(IRIS_HOLE_R + 0.05, 0.085, 16, 64)), this.irisRimMat)
    irisRim.position.z = GEAR_T / 2
    this.gear.add(irisRim)
    this.irisGlowMat = track(new THREE.MeshBasicMaterial({ color: '#3dffa0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    const irisGlow = new THREE.Mesh(track(new THREE.RingGeometry(IRIS_HOLE_R + 0.1, IRIS_HOLE_R + 0.42, 56)), this.irisGlowMat)
    irisGlow.position.z = GEAR_T / 2 + 0.03
    this.gear.add(irisGlow)
    this.gear.position.set(0, GEAR_CY, GEAR_Z)
    this.group.add(this.gear)

    /* ---------- 中央機械閘門：6 片實心暗金扇葉（閉合 = 盾牌；張開 = 完全縮入齒輪） ---------- */
    const bladeShape = new THREE.Shape()
    const span = Math.PI / 3 - 0.012
    bladeShape.moveTo(0, 0)
    bladeShape.absarc(0, 0, IRIS_HOLE_R + 0.05, -span / 2, span / 2, false)
    bladeShape.lineTo(0, 0)
    const bladeGeo = track(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }))
    const darkGold = std(null, { color: '#9a6a1c', metalness: 0.9, roughness: 0.3, emissive: '#2a1500', emissiveIntensity: 0.2 })
    const darkGold2 = std(null, { color: '#b8842a', metalness: 0.9, roughness: 0.3, emissive: '#2a1500', emissiveIntensity: 0.2 })
    for (let k = 0; k < 6; k++) {
      const phi = (k * Math.PI) / 3 + Math.PI / 6
      const blade = new THREE.Mesh(bladeGeo, k % 2 ? darkGold : darkGold2)
      this.group.add(blade)
      this.blades.push({ mesh: blade, phi })
    }
    // 閘門中心徽章（閉合時見到：金色貓爪星章；張開時跟葉片一齊縮細消失）
    this.emblem = new THREE.Mesh(track(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 24)), gold)
    this.emblem.rotation.x = Math.PI / 2
    this.group.add(this.emblem)
    // 鎖頭：閉合上鎖時喺盾牌前面（暗紅脈衝光）；解鎖張開時縮走
    this.lockGroup = new THREE.Group()
    const lockBody = new THREE.Mesh(track(new RoundedBoxGeometry(0.34, 0.26, 0.1, 3, 0.04)), gold)
    lockBody.position.y = -0.04
    const shackle = new THREE.Mesh(track(new THREE.TorusGeometry(0.1, 0.03, 10, 24, Math.PI)), gold)
    shackle.position.y = 0.09
    const keyhole = new THREE.Mesh(track(new THREE.CircleGeometry(0.035, 16)), track(new THREE.MeshBasicMaterial({ color: '#2a0a00' })))
    keyhole.position.set(0, -0.03, 0.052)
    this.lockGlowMat = track(new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }))
    const lockGlow = new THREE.Mesh(track(new THREE.CircleGeometry(0.34, 28)), this.lockGlowMat)
    lockGlow.position.z = -0.02
    this.lockGroup.add(lockBody, shackle, keyhole, lockGlow)
    this.group.add(this.lockGroup)
    // 解鎖倒數：12 粒翠綠燈泡圍住光圈，隨剩餘時間逐粒熄
    const bulbGeo = track(new THREE.SphereGeometry(0.05, 12, 10))
    const bOff = std(null, { color: '#2a3a30', metalness: 0.4, roughness: 0.5 })
    this.bulbOff = bOff
    this.bulbOn = std(null, { color: '#b8ffd0', emissive: '#2cff8a', emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.3 })
    for (let i = 0; i < 12; i++) {
      const a = Math.PI / 2 - (i / 12) * Math.PI * 2
      const m = new THREE.Mesh(bulbGeo, bOff)
      m.position.set(Math.cos(a) * (IRIS_HOLE_R + 0.3), GEAR_CY + Math.sin(a) * (IRIS_HOLE_R + 0.3), GEAR_Z + GEAR_T / 2 + 0.06)
      this.group.add(m)
      this.countBulbs.push(m)
    }
    // 傳送門：翠綠 + 金光漩渦（張開先見到）
    const pt = track(new THREE.CanvasTexture(portalCanvas()))
    pt.colorSpace = THREE.SRGBColorSpace
    this.portalMat = track(new THREE.MeshStandardMaterial({ map: pt, emissive: '#ffffff', emissiveMap: pt, emissiveIntensity: 0.9, roughness: 0.4 }))
    this.portal = new THREE.Mesh(track(new THREE.CircleGeometry(IRIS_HOLE_R, 48)), this.portalMat)
    this.portal.position.set(0, GEAR_CY, GEAR_Z - 0.03)
    this.group.add(this.portal)

    /* ---------- 瞄準準星：左 / 右射擊線定位點（洞口對正呢度嗰刻射） ---------- */
    const sightRing = track(new THREE.TorusGeometry(HOLE_R + 0.26, 0.028, 8, 56))
    const tickGeo = track(new THREE.BoxGeometry(0.05, 0.2, 0.05))
    const sightMat = std(null, { color: '#fff3b0', emissive: '#ffd34d', emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 })
    for (const tx of [LANE_TX[0], LANE_TX[2]]) {
      const g = new THREE.Group()
      g.position.set(tx, GEAR_CY, GEAR_Z + GEAR_T / 2 + 0.09)
      g.add(new THREE.Mesh(sightRing, sightMat))
      for (let i = 0; i < 4; i++) {
        const tk = new THREE.Mesh(tickGeo, sightMat)
        const a = (i * Math.PI) / 2
        tk.position.set(Math.cos(a) * (HOLE_R + 0.26), Math.sin(a) * (HOLE_R + 0.26), 0)
        tk.rotation.z = a + Math.PI / 2
        g.add(tk)
      }
      this.group.add(g)
      this.sights.push(g)
    }

    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && (m.material as THREE.Material).type !== 'MeshBasicMaterial') {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    this.update(0, [false, false, false], 0, 0, 0)
  }

  /** 第 k 個洞口被射中：穿環特效（環脹大 + 閃光） */
  flashHole(k: number) {
    if (k >= 0 && k < 3) this.holeFlash[k] = 1
  }

  /** t：遊戲時間；charged[k]：第 k 個洞口共鳴充能中；flash 0..1：命中閃光 */
  update(t: number, charged: boolean[], flash: number, o: number, unlockLeft: number) {
    this.gear.rotation.z = -GEAR_OMEGA * t
    for (let k = 0; k < 3; k++) {
      const on = charged[k]
      const pulse = on ? 0.6 + 0.4 * Math.sin(t * 8) : 0
      this.holeFlash[k] = Math.max(0, this.holeFlash[k] - 0.03)
      const f = this.holeFlash[k]
      ;(this.holeGlass[k].material as THREE.MeshBasicMaterial).opacity = 0.32 + (on ? 0.4 + 0.2 * pulse : 0) + f * 0.5
      ;(this.holeRims[k].material as THREE.MeshStandardMaterial).emissiveIntensity = (on ? 2.6 + pulse : 1.1) + f * 3
      this.holeGroups[k].scale.setScalar(1 + f * 0.14 + (on ? 0.02 * pulse : 0))
    }
    const anyCharged = charged.some(Boolean)
    const openOk = o >= 0.8 && unlockLeft > 0
    for (const b of this.blades) {
      const d = o * (IRIS_HOLE_R + 0.08)
      // 閘門葉片：閉合 = 實心盾牌；張開 = 沿徑向完全縮入齒輪厚度內（被齒輪前面遮住）
      b.mesh.position.set(Math.cos(b.phi) * d, GEAR_CY + Math.sin(b.phi) * d, GEAR_Z - 0.025)
      b.mesh.rotation.z = b.phi
    }
    this.emblem.position.set(0, GEAR_CY, GEAR_Z + 0.05)
    this.emblem.scale.setScalar(Math.max(0.001, 1 - o * 1.4))
    const lk = Math.max(0.001, 1 - o * 2)
    this.lockGroup.position.set(0, GEAR_CY, GEAR_Z + 0.14)
    this.lockGroup.scale.setScalar(lk)
    this.lockGlowMat.opacity = (0.22 + 0.18 * Math.sin(t * 5)) * lk
    const lit = Math.ceil((Math.max(0, unlockLeft) / IRIS_UNLOCK_S) * 12)
    this.countBulbs.forEach((m, i) => {
      m.material = i < lit ? this.bulbOn : this.bulbOff
    })
    // 綠燈：張開（可射入）→ 外圈翠綠光環亮；閉合 → 熄
    this.irisRimMat.emissiveIntensity = openOk ? 2.4 + 0.6 * Math.sin(t * 9) : o * 1.2
    this.irisGlowMat.opacity = openOk ? 0.5 + 0.2 * Math.sin(t * 9) : o * 0.25
    this.portal.rotation.z = t * 0.9
    this.portalMat.emissiveIntensity = (0.2 + 0.55 * o) * (anyCharged && o > 0.5 ? 1.6 + 0.4 * Math.sin(t * 10) : 1) + flash * 0.8
  }
}
