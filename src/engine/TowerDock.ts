import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { makeRepeatTexture } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  側方築塔台 Side Tower Dock                                          */
/*  1. 金幣一片一片喺機台右側「編織」疊高（唔係一次過出現）                    */
/*  2. 疊滿 DOCK_COINS 枚 → 側牆閘門升起 → 機械推臂將整座塔平滑推入推幣池     */
/*  3. 推到落點後塔變成真實物理幣，推臂縮返，繼續築下一座                      */
/* ------------------------------------------------------------------ */

/** 3 柱並排階梯式塔陣（z 為相對柱位、h 為層數）：14 + 12 + 10 = 36 枚 */
export const DOCK_COLS = [
  { z: -0.7, h: 14 },
  { z: 0, h: 12 },
  { z: 0.7, h: 10 },
] as const
export const DOCK_COINS = DOCK_COLS.reduce((a, c) => a + c.h, 0)
const MAX_H = Math.max(...DOCK_COLS.map((c) => c.h))
/** 逐層編織嘅落幣次序：每層由後柱到前柱輪流加 */
const BUILD_ORDER: Array<{ c: number; lvl: number }> = []
for (let lvl = 0; lvl < MAX_H; lvl++) DOCK_COLS.forEach((col, c) => lvl < col.h && BUILD_ORDER.push({ c, lvl }))

export const DOCK_Z = 0.95 // 築塔台 / 落點 Z（塔陣最後一柱 -0.0 起，避開推板最前緣 -0.4）
export const DOCK_TOWER_X = 3.52 // 塔喺築塔台嘅 X
export const DOCK_LAND_X = 1.5 // 推入推幣池後嘅落點 X
export const DOCK_GAP_HALF = 1.22 // 側牆閘門半闊（Z 方向）
const WALL_H = 0.62 // 側牆外觀高度（同 PusherEngine.WALL_VIS_H 一致）

const COIN_R = 0.32
const COIN_H = 0.12
const STACK_STEP = COIN_H + 0.004
const TOWER_R = COIN_R + 0.02 // 推動時嘅塔碰撞半徑
const ARM_T = 0.2 // 推臂厚度
const ARM_H = 2.05
const ARM_HALF_Z = 1.18 // 加寬推臂：一次推走整個塔陣
const ARM_REST_X = DOCK_TOWER_X + TOWER_R + 0.04 + ARM_T / 2
const LAYER_GAP = 0.2 // 每層落塔間隔 (s)
const LAYER_ANIM = 0.4 // 每片幣編織入位動畫 (s)
const DOOR_T = 0.55
const DOOR_LIFT = 0.8
const PUSH_T = 3.0
const RETRACT_T = 1.5
const HOLD_T = 0.55
const LAMPS = 12 // 進度燈：每粒代表 3 枚 // 疊滿後停頓，等最後一片入位

export type DockPhase = 'build' | 'door' | 'push' | 'retract'

export interface DockEvents {
  /** 第 i 層（0 起）落咗 */
  onLayer(i: number): void
  /** 開始推塔入池（閘門開啟） */
  onPush(): void
  /** 塔推到落點、變成真實物理幣 */
  onLand(): void
  /** 層數 / 階段變咗（俾 HUD 顯示） */
  onChange(layers: number, phase: DockPhase): void
}

interface Ctx {
  group: THREE.Group
  world: RAPIER.World
  std: (map: THREE.Texture | null, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  track: <T extends { dispose(): void }>(o: T) => T
  floorCanvas: HTMLCanvasElement
  wallCanvas: HTMLCanvasElement
  coinGeo: THREE.BufferGeometry
  coinMat: THREE.Material | THREE.Material[]
  wallX: number
  events: DockEvents
  surfaceY(x: number, z: number): number
  /** 塔陣落地：每柱由各自 baseY 起逐層生成真實幣 */
  spawnTower(columns: Array<{ x: number; z: number; baseY: number; offsets: Array<{ dx: number; dz: number; yaw: number }> }>): void
}

interface Layer {
  mesh: THREE.Mesh
  born: number
  side: 1 | -1
  col: number
  lvl: number
  dx: number
  dz: number
  yaw: number
}

const smooth = (k: number) => k * k * (3 - 2 * k)
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const easeOutBack = (k: number) => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2)
}

export class TowerDock {
  readonly group = new THREE.Group()
  private ctx: Ctx
  private layers: Layer[] = []
  private pending = 0
  private layerTimer = 0.4
  private phase: DockPhase = 'build'
  private t = 0
  private clock = 0
  private towerX = DOCK_TOWER_X
  private armX = ARM_REST_X
  private armBody: RAPIER.RigidBody
  private towerColliders: RAPIER.Collider[] = []
  private arm!: THREE.Mesh
  private piston!: THREE.Mesh
  private door!: THREE.Mesh
  private doorY = 0
  private lamps: THREE.Mesh[] = []
  private lampOn!: THREE.MeshStandardMaterial
  private lampOff!: THREE.MeshStandardMaterial
  private ringA!: THREE.Mesh
  private ringB!: THREE.Mesh
  private housingFrontX = 0

  constructor(ctx: Ctx) {
    this.ctx = ctx
    const { std, track, floorCanvas, wallCanvas, wallX } = ctx
    const gold = std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.28, emissive: '#6a3a00', emissiveIntensity: 0.45 })
    const plateW = 1.0
    const px0 = wallX + 0.15
    const px1 = px0 + plateW // 築塔台外緣

    // 台面：同檯面一樣高（頂面 y=0），紫絨
    const deckTex = track(makeRepeatTexture(floorCanvas, 0.9, 0.9))
    const deck = new THREE.Mesh(track(new THREE.BoxGeometry(plateW, 1.2, 2.8)), std(deckTex))
    deck.position.set((px0 + px1) / 2, -0.6, DOCK_Z)
    this.group.add(deck)
    // 台面金邊
    const edge = new THREE.Mesh(track(new THREE.BoxGeometry(plateW + 0.1, 0.06, 2.92)), gold)
    edge.position.set((px0 + px1) / 2, 0.005, DOCK_Z)
    this.group.add(edge)

    // 前後護欄（粉白條紋矮牆 + 金頂）
    const railTex = track(makeRepeatTexture(wallCanvas, 2, 1))
    const railMat = std(railTex)
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(track(new THREE.BoxGeometry(plateW, 0.5, 0.12)), railMat)
      rail.position.set((px0 + px1) / 2, 0.25, DOCK_Z + sz * 1.4)
      this.group.add(rail)
      const cap = new THREE.Mesh(track(new THREE.BoxGeometry(plateW + 0.04, 0.05, 0.16)), gold)
      cap.position.set((px0 + px1) / 2, 0.52, DOCK_Z + sz * 1.4)
      this.group.add(cap)
    }

    // 後方機械房（推臂活塞座）
    const housing = new THREE.Mesh(track(new THREE.BoxGeometry(0.4, 2.2, 2.8)), std(track(makeRepeatTexture(wallCanvas, 1.4, 1))))
    housing.position.set(px1 + 0.25, 1.1, DOCK_Z)
    this.housingFrontX = px1 + 0.05
    this.group.add(housing)
    const housingTop = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.08, 2.86)), gold)
    housingTop.position.set(px1 + 0.25, 2.22, DOCK_Z)
    this.group.add(housingTop)

    // 進度燈：12 粒，喺前護欄頂面一字排開（亮 = 已疊層數）
    this.lampOn = track(std(null, { color: '#ffe08a', emissive: '#ffb300', emissiveIntensity: 1.6, roughness: 0.3 }))
    this.lampOff = track(std(null, { color: '#4a2a3a', roughness: 0.6 }))
    const lampGeo = track(new THREE.SphereGeometry(0.036, 8, 6))
    for (let i = 0; i < LAMPS; i++) {
      const lamp = new THREE.Mesh(lampGeo, this.lampOff)
      lamp.position.set(px0 + 0.07 + i * ((plateW - 0.14) / (LAMPS - 1)), 0.58, DOCK_Z + 1.4)
      this.group.add(lamp)
      this.lamps.push(lamp)
    }

    // 側牆閘門（升起時露出缺口）+ 金拱框
    const doorW = DOCK_GAP_HALF * 2
    const doorTex = track(makeRepeatTexture(wallCanvas, 1.6, 1))
    this.door = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, WALL_H, doorW)), std(doorTex, { emissive: '#3a0a14', emissiveIntensity: 0.3 }))
    this.door.position.set(wallX, WALL_H / 2, DOCK_Z)
    this.group.add(this.door)
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, WALL_H + 0.1, 0.08)), gold)
      post.position.set(wallX, (WALL_H + 0.1) / 2, DOCK_Z + sz * (DOCK_GAP_HALF + 0.04))
      this.group.add(post)
    }
    const lintel = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.08, doorW + 0.16)), gold)
    lintel.position.set(wallX, WALL_H + 0.14, DOCK_Z)
    this.group.add(lintel)

    // 推臂：金屬板 + 活塞桿
    this.arm = new THREE.Mesh(
      track(new THREE.BoxGeometry(ARM_T, ARM_H, ARM_HALF_Z * 2)),
      std(null, { color: '#ff9fd0', metalness: 0.6, roughness: 0.3, emissive: '#5a1038', emissiveIntensity: 0.35 }),
    )
    this.group.add(this.arm)
    const armTrim = new THREE.Mesh(track(new THREE.BoxGeometry(ARM_T + 0.04, 0.08, ARM_HALF_Z * 2 + 0.04)), gold)
    armTrim.position.y = ARM_H / 2
    this.arm.add(armTrim)
    this.piston = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.07, 1, 12)), gold)
    this.piston.rotation.z = Math.PI / 2
    this.group.add(this.piston)

    // 編織絲線：兩個反向旋轉嘅金環圍住塔頂
    const ringGeo = track(new THREE.TorusGeometry(0.44, 0.014, 6, 36))
    const ringMat = track(new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.ringA = new THREE.Mesh(ringGeo, ringMat)
    this.ringB = new THREE.Mesh(ringGeo, ringMat)
    this.ringA.visible = this.ringB.visible = false
    this.group.add(this.ringA, this.ringB)

    // 推臂物理體（kinematic）：推動時帶住塔碰撞體，將推幣池嘅幣推開
    this.armBody = ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ARM_REST_X, ARM_H / 2, DOCK_Z),
    )
    ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(ARM_T / 2, ARM_H / 2, ARM_HALF_Z).setFriction(0.3), this.armBody)

    ctx.group.add(this.group)
    this.syncVisuals()
    this.emit()
  }

  get layerCount() {
    return this.layers.length
  }

  get currentPhase() {
    return this.phase
  }

  /** 加速築塔：units 層（可有小數，累積夠 1 先疊一層） */
  feed(units: number) {
    this.pending = Math.min(DOCK_COINS * 2, this.pending + units)
  }

  /** 固定步長推進（同物理一齊行，推臂先會平滑帶動幣堆） */
  step(dt: number) {
    this.clock += dt
    switch (this.phase) {
      case 'build': {
        this.layerTimer -= dt
        if (this.layers.length < DOCK_COINS && this.pending >= 1 && this.layerTimer <= 0) {
          this.pending -= 1
          this.addLayer()
          this.layerTimer = LAYER_GAP
        }
        if (this.layers.length >= DOCK_COINS) {
          const last = this.layers[this.layers.length - 1]
          if (this.clock - last.born >= LAYER_ANIM + HOLD_T) {
            this.phase = 'door'
            this.t = 0
            this.ctx.events.onPush()
            this.emit()
          }
        }
        break
      }
      case 'door': {
        this.t += dt
        this.doorY = smooth(Math.min(1, this.t / DOOR_T)) * DOOR_LIFT
        if (this.t >= DOOR_T) {
          this.phase = 'push'
          this.t = 0
          this.attachTowerCollider()
          this.emit()
        }
        break
      }
      case 'push': {
        this.t += dt
        const k = Math.min(1, this.t / PUSH_T)
        this.towerX = DOCK_TOWER_X + (DOCK_LAND_X - DOCK_TOWER_X) * easeInOut(k)
        this.armX = this.towerX + TOWER_R + 0.04 + ARM_T / 2
        if (k >= 1) this.land()
        break
      }
      case 'retract': {
        this.t += dt
        const k = Math.min(1, this.t / RETRACT_T)
        const landArm = DOCK_LAND_X + TOWER_R + 0.04 + ARM_T / 2
        this.armX = landArm + (ARM_REST_X - landArm) * easeInOut(k)
        // 推臂退到閘門外面先落閘
        const closeK = Math.max(0, (k - 0.65) / 0.35)
        this.doorY = DOOR_LIFT * (1 - smooth(Math.min(1, closeK)))
        if (k >= 1) {
          this.phase = 'build'
          this.doorY = 0
          this.layerTimer = 0.5
          this.emit()
        }
        break
      }
    }
    this.armBody.setNextKinematicTranslation({ x: this.armX, y: ARM_H / 2, z: DOCK_Z })
  }

  /** 每幀（render）更新外觀：編織入位動畫、推臂、閘門、進度燈 */
  syncVisuals() {
    const restY = (lvl: number) => COIN_H / 2 + 0.01 + lvl * STACK_STEP
    for (const l of this.layers) {
      const k = Math.min(1, Math.max(0, (this.clock - l.born) / LAYER_ANIM))
      const e = easeOutBack(k)
      // 編織：每枚由前 / 後（交替）橫掃入位，邊掃邊轉
      l.mesh.position.set(
        this.towerX + l.dx,
        restY(l.lvl) + 0.55 * (1 - k) * (1 - k),
        DOCK_Z + DOCK_COLS[l.col].z + l.dz + l.side * 0.95 * (1 - e),
      )
      l.mesh.rotation.y = l.yaw + l.side * (1 - k) * 2.4
      l.mesh.visible = k > 0
    }
    this.arm.position.set(this.armX, ARM_H / 2, DOCK_Z)
    // 活塞桿：由推臂背面伸去機械房前面（上下各一支）
    const pistonX0 = this.armX + ARM_T / 2
    const len = Math.max(0.05, this.housingFrontX - pistonX0)
    this.piston.scale.y = len
    this.piston.position.set(pistonX0 + len / 2, 1.0, DOCK_Z)
    this.door.position.y = WALL_H / 2 + this.doorY
    for (let i = 0; i < this.lamps.length; i++) this.lamps[i].material = i * 3 < this.layers.length ? this.lampOn : this.lampOff

    const building = this.phase === 'build' && this.layers.length > 0 && this.layers.length < DOCK_COINS
    this.ringA.visible = this.ringB.visible = building
    if (building) {
      const last = this.layers[this.layers.length - 1]
      const top = restY(last.lvl) + 0.12
      const z = DOCK_Z + DOCK_COLS[last.col].z
      this.ringA.position.set(DOCK_TOWER_X, top, z)
      this.ringB.position.set(DOCK_TOWER_X, top + 0.05, z)
      this.ringA.rotation.set(Math.PI / 2 + 0.45, 0, this.clock * 3.2)
      this.ringB.rotation.set(Math.PI / 2 - 0.45, 0, -this.clock * 2.6)
    }
  }

  private addLayer() {
    const i = this.layers.length
    const { c, lvl } = BUILD_ORDER[i]
    const mesh = new THREE.Mesh(this.ctx.coinGeo, this.ctx.coinMat)
    mesh.visible = false
    this.group.add(mesh)
    this.layers.push({
      mesh,
      born: this.clock,
      side: i % 2 === 0 ? 1 : -1,
      col: c,
      lvl,
      // 編織錯位：每層微微錯開，疊出織紋感
      dx: (lvl % 2 === 0 ? -1 : 1) * 0.035,
      dz: ((lvl % 3) - 1) * 0.025,
      yaw: (i * 0.9) % (Math.PI * 2),
    })
    this.ctx.events.onLayer(i)
    this.emit()
  }

  private attachTowerCollider() {
    const dx = -(ARM_T / 2 + 0.04 + TOWER_R)
    this.towerColliders = DOCK_COLS.map((col) => {
      const h = col.h * STACK_STEP + 0.06
      return this.ctx.world.createCollider(
        RAPIER.ColliderDesc.cylinder(h / 2, TOWER_R).setTranslation(dx, h / 2 - ARM_H / 2, col.z).setFriction(0.2),
        this.armBody,
      )
    })
  }

  private land() {
    const { world, events } = this.ctx
    for (const c of this.towerColliders) world.removeCollider(c, true)
    this.towerColliders = []
    const columns = DOCK_COLS.map((col, ci) => {
      const z = DOCK_Z + col.z
      return {
        x: DOCK_LAND_X,
        z,
        baseY: this.ctx.surfaceY(DOCK_LAND_X, z),
        offsets: this.layers
          .filter((l) => l.col === ci)
          .sort((a, b) => a.lvl - b.lvl)
          .map((l) => ({ dx: l.dx, dz: l.dz, yaw: l.yaw })),
      }
    })
    for (const l of this.layers) this.group.remove(l.mesh)
    this.layers = []
    this.ctx.spawnTower(columns)
    this.towerX = DOCK_TOWER_X
    this.phase = 'retract'
    this.t = 0
    events.onLand()
    this.emit()
  }

  private emit() {
    this.ctx.events.onChange(this.layers.length, this.phase)
  }
}
