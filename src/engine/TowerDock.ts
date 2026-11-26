import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { makeRepeatTexture } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  側方築塔台（右上角獨立小視窗 PiP 展示）                                  */
/*  1. 升降機構：每加一枚，新幣由最底層推入，將整柱已疊起嘅幣「由底向上頂高一格」    */
/*  2. 疊滿 DOCK_COINS 枚 → 小視窗出口閘門開、塔陣滑出 → 主機台右側牆閘門升起，     */
/*     推臂帶住塔陣由畫面外平滑推入推幣池中央                                  */
/*  3. 推到落點後變成真實物理幣，推臂縮返，繼續築下一座                        */
/*  PiP 內容放喺獨立 group（`pip`），由 PusherScene 用另一個鏡頭渲染到小視窗      */
/* ------------------------------------------------------------------ */

/**
 * 對稱「五柱十字」金幣塔陣：中柱最高（10 層），東西南北四柱遞減（各 7 層），共 38 枚。
 * x = 推動方向（朝池中央），z = 橫向。四柱間距 0.72（> 幣直徑 0.64）。
 */
export const DOCK_COLS = [
  { x: 0, z: 0, h: 10 },
  { x: -0.72, z: 0, h: 7 },
  { x: 0.72, z: 0, h: 7 },
  { x: 0, z: -0.72, h: 7 },
  { x: 0, z: 0.72, h: 7 },
] as const
export const DOCK_COINS = DOCK_COLS.reduce((a, c) => a + c.h, 0)
const MAX_H = Math.max(...DOCK_COLS.map((c) => c.h))
/** 逐層落幣次序：每層由後柱到前柱輪流加 */
const BUILD_ORDER: Array<{ c: number; lvl: number }> = []
for (let lvl = 0; lvl < MAX_H; lvl++) DOCK_COLS.forEach((col, c) => lvl < col.h && BUILD_ORDER.push({ c, lvl }))

export const DOCK_Z = 0.95 // 落點 Z（避開推板最前緣 -0.4）
export const DOCK_TOWER_X = 4.7 // 推塔起點 X（畫面外，右側牆之外）
export const DOCK_LAND_X = 1.5 // 推入推幣池後嘅落點 X
export const DOCK_GAP_HALF = 1.22 // 側牆閘門半闊（Z 方向）
const WALL_H = 0.62 // 側牆外觀高度（同 PusherEngine.WALL_VIS_H 一致）

const COIN_R = 0.32
const COIN_H = 0.12
const STACK_STEP = COIN_H + 0.004
const TOWER_R = COIN_R + 0.02
const ARM_T = 0.2
const ARM_OFF = 0.72 + 0.32 + 0.02 + 0.04 + 0.1 // 推臂中心喺塔陣中心後面幾遠（貼住最後一柱）
const ARM_H = 2.05
const ARM_HALF_Z = 1.18
const LAYER_GAP = 0.3 // 每枚落塔間隔 (s)
const LIFT_T = 0.28 // 升降頂高動畫 (s)
const DOOR_T = 0.55
const DOOR_LIFT = 0.8
const PUSH_T = 3.2
const PIP_OUT = 0.28 // 推塔進度頭 28% 係喺小視窗滑出
const RETRACT_T = 1.5
const HOLD_T = 0.5

// PiP 小視窗佈局（世界單位）
const PIP_FLOOR = 0.3
export const PIP_ASPECT = 1.15 // 高 / 闊

export type DockPhase = 'build' | 'door' | 'push' | 'retract'

export interface DockEvents {
  onLayer(i: number): void
  onPush(): void
  onLand(): void
  onChange(layers: number, phase: DockPhase): void
}

interface Ctx {
  group: THREE.Group
  world: RAPIER.World
  std: (map: THREE.Texture | null, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  track: <T extends { dispose(): void }>(o: T) => T
  wallCanvas: HTMLCanvasElement
  coinGeo: THREE.BufferGeometry
  coinMat: THREE.Material | THREE.Material[]
  wallX: number
  events: DockEvents
  surfaceY(x: number, z: number): number
  spawnTower(columns: Array<{ x: number; z: number; baseY: number; offsets: Array<{ dx: number; dz: number; yaw: number }> }>): void
}

interface Layer {
  mesh: THREE.Mesh // PiP 內嘅幣
  born: number
  col: number
  lvl: number // 喺該柱內第幾枚（0 = 最早）
  dx: number
  dz: number
  yaw: number
  curX: number
  curY: number
}

const smooth = (k: number) => k * k * (3 - 2 * k)
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

export class TowerDock {
  /** 主機台內嘅部件（側牆閘門、推臂、推動中嘅塔） */
  readonly group = new THREE.Group()
  /** 獨立小視窗內容（由 PusherScene 用另一個鏡頭渲染） */
  readonly pip = new THREE.Group()
  private ctx: Ctx
  private layers: Layer[] = []
  private pending = 0
  private layerTimer = 0.4
  private phase: DockPhase = 'build'
  private t = 0
  private clock = 0
  private towerX = DOCK_TOWER_X
  private armX = DOCK_TOWER_X + ARM_OFF
  private armBody: RAPIER.RigidBody
  private towerColliders: RAPIER.Collider[] = []
  private mainCoins: THREE.Mesh[] = []
  private mainCoinCfg: Array<{ col: number; lvl: number; dx: number; dz: number; yaw: number }> = []
  private arm: THREE.Mesh
  private door: THREE.Mesh
  private doorY = 0
  private pipCoins = new THREE.Group()
  private pipDoor: THREE.Mesh
  private feeders: THREE.Mesh[] = []
  private feedAt = [-9, -9, -9, -9, -9]
  private colCount = [0, 0, 0, 0, 0]
  private pipOpen = 0

  constructor(ctx: Ctx) {
    this.ctx = ctx
    const { std, track, wallCanvas, wallX } = ctx
    const gold = std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.28, emissive: '#6a3a00', emissiveIntensity: 0.45 })

    /* ---------- 主機台：側牆閘門 + 推臂 ---------- */
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

    this.arm = new THREE.Mesh(
      track(new THREE.BoxGeometry(ARM_T, ARM_H, ARM_HALF_Z * 2)),
      std(null, { color: '#ff9fd0', metalness: 0.6, roughness: 0.3, emissive: '#5a1038', emissiveIntensity: 0.35 }),
    )
    const armTrim = new THREE.Mesh(track(new THREE.BoxGeometry(ARM_T + 0.04, 0.08, ARM_HALF_Z * 2 + 0.04)), gold)
    armTrim.position.y = ARM_H / 2
    this.arm.add(armTrim)
    this.group.add(this.arm)

    this.armBody = ctx.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.armX, ARM_H / 2, DOCK_Z),
    )
    ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(ARM_T / 2, ARM_H / 2, ARM_HALF_Z).setFriction(0.3), this.armBody)

    /* ---------- PiP 小視窗：升降機構剖面 ---------- */
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 3.9, 0.2)), std(null, { color: '#2a0f3f', roughness: 0.9, transparent: true, opacity: 0.6 }))
    back.position.set(0, 1.2, -0.7)
    this.pip.add(back)
    const wallTex = track(makeRepeatTexture(wallCanvas, 2, 3))
    // 每柱一條升降井：兩側隔板 + 地台
    for (let c = 0; c < DOCK_COLS.length; c++) {
      const x = this.colX(c)
      const shaft = new THREE.Mesh(track(new THREE.BoxGeometry(0.72, 3.5, 0.1)), std(null, { color: '#3d1a58', roughness: 0.85, transparent: true, opacity: 0.55 }))
      shaft.position.set(x, 1.3, -0.55)
      this.pip.add(shaft)
      const base = new THREE.Mesh(track(new THREE.BoxGeometry(0.74, 0.16, 0.7)), gold)
      base.position.set(x, PIP_FLOOR - 0.08, -0.1)
      this.pip.add(base)
      // 底部入幣推桿（由左推入）
      const feeder = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.5, COIN_H + 0.06, 0.5)),
        std(null, { color: '#ff7ac8', metalness: 0.6, roughness: 0.3, emissive: '#5a1038', emissiveIntensity: 0.4 }),
      )
      this.feeders.push(feeder)
      this.pip.add(feeder)
    }
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 3.6, 0.9)), std(wallTex))
      post.position.set(sx * 1.72, 1.3, -0.2)
      this.pip.add(post)
    }
    const floor = new THREE.Mesh(track(new THREE.BoxGeometry(3.6, 0.3, 1.1)), gold)
    floor.position.set(0, PIP_FLOOR - 0.3, -0.1)
    this.pip.add(floor)
    // 右側出口閘門（塔陣滿咗先升起）
    this.pipDoor = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 3.3, 1.0)), std(wallTex, { emissive: '#3a0a14', emissiveIntensity: 0.3 }))
    this.pipDoor.position.set(1.72, 1.3, 0.2)
    this.pip.add(this.pipDoor)
    this.pip.add(this.pipCoins)
    const l1 = new THREE.AmbientLight(0xffffff, 1.1)
    const l2 = new THREE.DirectionalLight(0xfff0d0, 1.8)
    l2.position.set(1.5, 4, 5)
    this.pip.add(l1, l2)

    ctx.group.add(this.group)
    this.syncVisuals()
    this.emit()
  }

  get layerCount() {
    return this.layers.length
  }

  feed(units: number) {
    this.pending = Math.min(DOCK_COINS * 2, this.pending + units)
  }

  /** 固定步長推進（同物理一齊行） */
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
          if (this.clock - last.born >= LIFT_T + HOLD_T) {
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
        const k = smooth(Math.min(1, this.t / DOOR_T))
        this.doorY = k * DOOR_LIFT
        this.pipOpen = k
        if (this.t >= DOOR_T) {
          this.phase = 'push'
          this.t = 0
          this.attachTower()
          this.emit()
        }
        break
      }
      case 'push': {
        this.t += dt
        const k = Math.min(1, this.t / PUSH_T)
        this.towerX = DOCK_TOWER_X + (DOCK_LAND_X - DOCK_TOWER_X) * easeInOut(k)
        this.armX = this.towerX + ARM_OFF
        if (k >= 1) this.land()
        break
      }
      case 'retract': {
        this.t += dt
        const k = Math.min(1, this.t / RETRACT_T)
        const landArm = DOCK_LAND_X + ARM_OFF
        const restArm = DOCK_TOWER_X + ARM_OFF
        this.armX = landArm + (restArm - landArm) * easeInOut(k)
        const closeK = Math.max(0, (k - 0.65) / 0.35)
        this.doorY = DOOR_LIFT * (1 - smooth(Math.min(1, closeK)))
        this.pipOpen = 1 - smooth(Math.min(1, k * 1.5))
        if (k >= 1) {
          this.phase = 'build'
          this.doorY = 0
          this.pipOpen = 0
          this.layerTimer = 0.5
          this.emit()
        }
        break
      }
    }
    this.armBody.setNextKinematicTranslation({ x: this.armX, y: ARM_H / 2, z: DOCK_Z })
  }

  /** PiP 斜投影：x 加上深度偏移，十字塔陣喺小視窗內有前後層次 */
  private colX(c: number) {
    const col = DOCK_COLS[c]
    return col.x * 0.85 + col.z * 0.55
  }
  private colZ(c: number) {
    return DOCK_COLS[c].z * 0.5
  }

  /** 每幀更新外觀 */
  syncVisuals() {
    // PiP：每枚幣嘅目標高度 = 離底嘅格數（最新嗰枚最底，舊嘅被頂高）
    const n = this.colCount
    for (const l of this.layers) {
      const level = n[l.col] - 1 - l.lvl
      const ty = PIP_FLOOR + COIN_H / 2 + 0.01 + level * STACK_STEP
      const tx = this.colX(l.col) + l.dx
      const k = Math.min(1, (this.clock - l.born) / LIFT_T)
      l.curY += (ty - l.curY) * Math.min(1, 0.35)
      l.curX = k >= 1 ? tx : tx - 0.9 * (1 - smooth(k))
      l.mesh.position.set(l.curX, l.curY, l.dz - 0.1 + this.colZ(l.col))
      l.mesh.rotation.y = l.yaw
    }
    // 入幣推桿：每次加幣前伸再縮
    this.feeders.forEach((f, c) => {
      const a = Math.min(1, Math.max(0, (this.clock - this.feedAt[c]) / LIFT_T))
      const out = Math.sin(Math.PI * a)
      f.position.set(this.colX(c) - 0.78 + 0.5 * out, PIP_FLOOR + (COIN_H + 0.06) / 2, -0.1 + this.colZ(c))
    })
    // 塔陣滑出小視窗
    const pushK = this.phase === 'push' ? Math.min(1, this.t / PUSH_T / PIP_OUT) : this.phase === 'retract' ? 1 : 0
    this.pipCoins.position.x = easeInOut(pushK) * 4
    this.pipCoins.visible = this.phase !== 'retract'
    this.pipDoor.position.y = 1.3 + this.pipOpen * 3.1

    // 主機台：閘門、推臂、推動中嘅塔
    this.door.position.y = WALL_H / 2 + this.doorY
    this.arm.position.set(this.armX, ARM_H / 2, DOCK_Z)
    this.arm.visible = this.phase === 'push' || this.phase === 'retract'
    this.mainCoins.forEach((m, i) => {
      const c = this.mainCoinCfg[i]
      m.position.set(this.towerX + DOCK_COLS[c.col].x + c.dx, COIN_H / 2 + 0.01 + c.lvl * STACK_STEP, DOCK_Z + DOCK_COLS[c.col].z + c.dz)
      m.rotation.y = c.yaw
    })
  }

  private addLayer() {
    const i = this.layers.length
    const { c, lvl } = BUILD_ORDER[i]
    const mesh = new THREE.Mesh(this.ctx.coinGeo, this.ctx.coinMat)
    this.pipCoins.add(mesh)
    this.colCount[c]++
    this.feedAt[c] = this.clock
    this.layers.push({
      mesh,
      born: this.clock,
      col: c,
      lvl,
      dx: (lvl % 2 === 0 ? -1 : 1) * 0.03,
      dz: ((lvl % 3) - 1) * 0.025,
      yaw: (i * 0.9) % (Math.PI * 2),
      curX: 0,
      curY: PIP_FLOOR + COIN_H / 2,
    })
    this.ctx.events.onLayer(i)
    this.emit()
  }

  /** 推塔開始：主機台生成推動中嘅塔（視覺）+ 物理碰撞柱 */
  private attachTower() {
    this.mainCoinCfg = this.layers.map((l) => ({ col: l.col, lvl: l.lvl, dx: l.dx, dz: l.dz, yaw: l.yaw }))
    this.mainCoins = this.mainCoinCfg.map(() => {
      const m = new THREE.Mesh(this.ctx.coinGeo, this.ctx.coinMat)
      m.castShadow = true
      this.group.add(m)
      return m
    })
    this.towerColliders = DOCK_COLS.map((col) => {
      const h = col.h * STACK_STEP + 0.06
      return this.ctx.world.createCollider(
        RAPIER.ColliderDesc.cylinder(h / 2, TOWER_R).setTranslation(col.x - ARM_OFF, h / 2 - ARM_H / 2, col.z).setFriction(0.2),
        this.armBody,
      )
    })
    this.towerX = DOCK_TOWER_X
  }

  private land() {
    const { world, events } = this.ctx
    for (const c of this.towerColliders) world.removeCollider(c, true)
    this.towerColliders = []
    const columns = DOCK_COLS.map((col, ci) => {
      const z = DOCK_Z + col.z
      return {
        x: DOCK_LAND_X + col.x,
        z,
        baseY: this.ctx.surfaceY(DOCK_LAND_X + col.x, z),
        offsets: this.layers
          .filter((l) => l.col === ci)
          .sort((a, b) => a.lvl - b.lvl)
          .map((l) => ({ dx: l.dx, dz: l.dz, yaw: l.yaw })),
      }
    })
    for (const m of this.mainCoins) this.group.remove(m)
    this.mainCoins = []
    for (const l of this.layers) this.pipCoins.remove(l.mesh)
    this.layers = []
    this.colCount = [0, 0, 0, 0, 0]
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
