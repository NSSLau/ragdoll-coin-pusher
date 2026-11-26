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
 * 三葉草扭轉螺旋塔（Twisted Clover Helix）：50 枚。
 * 每層 3 枚金幣呈正三角形互鎖（外接圓半徑 R_T），共 16 層 = 48 枚；每往上一層整體旋轉 18°；
 * 最頂層 2 枚「皇冠」金幣左右對放 = 50 枚。底盤三點支撐，穩穩企得住，要推板撞擊先會倒。
 * 三枚同層相距 R_T·√3 = 0.62 > 幣直徑 0.54，唔會穿插。
 */
export const DOCK_COLS = [{ h: 50 }] as const
export const DOCK_COINS = 50
const CLOVER_R = 0.36
const CLOVER_TWIST = (18 * Math.PI) / 180
const CLOVER_LEVELS = 16
/** idx = 由底數起第幾枚（0 = 最底）；返回層（由底數起）同水平偏移 */
const cloverAt = (idx: number) => {
  if (idx >= CLOVER_LEVELS * 3) {
    const k = idx - CLOVER_LEVELS * 3
    const th = CLOVER_LEVELS * CLOVER_TWIST + k * Math.PI
    return { level: CLOVER_LEVELS, dx: 0.2 * Math.cos(th), dz: 0.2 * Math.sin(th) }
  }
  const level = Math.floor(idx / 3)
  const th = level * CLOVER_TWIST + (idx % 3) * ((Math.PI * 2) / 3)
  return { level, dx: CLOVER_R * Math.cos(th), dz: CLOVER_R * Math.sin(th) }
}
/** 逐枚加入次序 */
const BUILD_ORDER: Array<{ c: number; lvl: number }> = []
for (let i = 0; i < DOCK_COINS; i++) BUILD_ORDER.push({ c: 0, lvl: i })

export const DOCK_Z = 0.95 // 落點 Z（避開推板最前緣 -0.4）
export const DOCK_TOWER_X = 4.7 // 推塔起點 X（畫面外，右側牆之外）
export const DOCK_LAND_X = 1.5 // 推入推幣池後嘅落點 X
export const DOCK_GAP_HALF = 1.22 // 側牆閘門半闊（Z 方向）
const WALL_H = 0.62 // 側牆外觀高度（同 PusherEngine.WALL_VIS_H 一致）

const COIN_R = 0.27
const COIN_H = 0.065
const STACK_STEP = COIN_H + 0.004
const TOWER_R = CLOVER_R + COIN_R + 0.03 // 推動時嘅塔碰撞半徑
const TOWER_H = 17 * STACK_STEP + 0.06
const PIP_SCALE = 1.5 // 塔矮（17 層），小視窗內放大睇清楚
const ARM_T = 0.2
const ARM_OFF = TOWER_R + 0.04 + 0.1 // 推臂中心喺塔中軸後面幾遠
const ARM_H = 2.05
const ARM_HALF_Z = 0.95
const LAYER_GAP = 0.14 // 每枚落塔間隔 (s)
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
  spawnTower(x: number, z: number, baseY: number, coins: Array<{ dx: number; dz: number; level: number; yaw: number }>): void
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
  curZ: number
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
  private feedAt = [-9, -9]
  private colCount = [0]
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
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 3.9, 0.2)), std(null, { color: '#5a2c8a', roughness: 0.9, transparent: true, opacity: 0.72 }))
    back.position.set(0, 1.2, -0.7)
    this.pip.add(back)
    const wallTex = track(makeRepeatTexture(wallCanvas, 2, 3))
    // 升降井：一條中央井 + 地台；兩個入幣推桿（A / B 股）喺幣組內，隨塔陣一齊滑出
    const shaft = new THREE.Mesh(track(new THREE.BoxGeometry(1.7, 3.5, 0.1)), std(null, { color: '#7a4ab0', roughness: 0.85, transparent: true, opacity: 0.5 }))
    shaft.position.set(0, 1.3, -0.55)
    this.pip.add(shaft)
    const base = new THREE.Mesh(track(new THREE.BoxGeometry(1.8, 0.16, 1.0)), gold)
    base.position.set(0, PIP_FLOOR - 0.08, -0.1)
    this.pip.add(base)
    for (let c = 0; c < 2; c++) {
      const feeder = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.5, COIN_H + 0.06, 0.5)),
        std(null, { color: '#ff7ac8', metalness: 0.6, roughness: 0.3, emissive: '#5a1038', emissiveIntensity: 0.4 }),
      )
      this.feeders.push(feeder)
      this.pipCoins.add(feeder)
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
    this.pipCoins.scale.setScalar(PIP_SCALE)
    this.pipCoins.position.y = PIP_FLOOR * (1 - PIP_SCALE)
    this.pip.add(this.pipCoins)
    // 小視窗獨立柔和補光：環境光 + 正面主光 + 暖色側光 + 逆光邊緣光，金幣塔隨時睇得清
    const l1 = new THREE.AmbientLight(0xffffff, 1.6)
    const l2 = new THREE.DirectionalLight(0xfff0d0, 2.6)
    l2.position.set(1.5, 4, 6)
    const l3 = new THREE.DirectionalLight(0xffb0e0, 1.1)
    l3.position.set(-3, 1.5, 4)
    const l4 = new THREE.DirectionalLight(0xa0d0ff, 1.0)
    l4.position.set(0, 3, -4)
    this.pip.add(l1, l2, l3, l4)

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

  /** 每幀更新外觀 */
  syncVisuals() {
    // PiP：每枚幣嘅目標高度 = 離底嘅格數（最新嗰枚最底，舊嘅被頂高）；螺旋相位跟層數轉，頂高時自然扭動
    const n = this.colCount[0]
    for (const l of this.layers) {
      const p = cloverAt(n - 1 - l.lvl) // 最新嗰枚喺最底，舊嘅被頂高；相位跟層數轉，頂高時自然扭動
      const ty = PIP_FLOOR + COIN_H / 2 + 0.01 + p.level * STACK_STEP
      const k = Math.min(1, (this.clock - l.born) / LIFT_T)
      const enter = k >= 1 ? 0 : 0.9 * (1 - smooth(k))
      l.curY += (ty - l.curY) * 0.35
      l.curX += (p.dx - enter - l.curX) * 0.4
      l.curZ += (p.dz - l.curZ) * 0.4
      l.mesh.position.set(l.curX, l.curY, l.curZ - 0.1)
      l.mesh.rotation.y = l.yaw
    }
    // 入幣推桿：每次加幣前伸再縮
    this.feeders.forEach((f, c) => {
      const a = Math.min(1, Math.max(0, (this.clock - this.feedAt[c]) / LIFT_T))
      const out = Math.sin(Math.PI * a)
      f.position.set(-0.95 + 0.5 * out, PIP_FLOOR + (COIN_H + 0.06) / 2, -0.1 + (c ? -0.2 : 0.2))
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
      m.position.set(this.towerX + c.dx, COIN_H / 2 + 0.01 + c.lvl * STACK_STEP, DOCK_Z + c.dz)
      m.rotation.y = c.yaw
    })
  }

  private addLayer() {
    const i = this.layers.length
    const { c, lvl } = BUILD_ORDER[i]
    const mesh = new THREE.Mesh(this.ctx.coinGeo, this.ctx.coinMat)
    this.pipCoins.add(mesh)
    this.colCount[0]++
    this.feedAt[i % 2] = this.clock
    this.layers.push({
      mesh,
      born: this.clock,
      col: c,
      lvl,
      dx: 0,
      dz: 0,
      yaw: (i * 0.9) % (Math.PI * 2),
      curX: -0.9,
      curY: PIP_FLOOR + COIN_H / 2,
      curZ: 0,
    })
    this.ctx.events.onLayer(i)
    this.emit()
  }

  /** 推塔開始：主機台生成推動中嘅塔（視覺）+ 物理碰撞柱 */
  private attachTower() {
    // 主機台推動中嘅塔：第 L 層（由底數起）按螺旋公式定位
    this.mainCoinCfg = this.layers.map((l) => {
      const o = cloverAt(DOCK_COINS - 1 - l.lvl)
      return { col: 0, lvl: o.level, dx: o.dx, dz: o.dz, yaw: l.yaw }
    })
    this.mainCoins = this.mainCoinCfg.map(() => {
      const m = new THREE.Mesh(this.ctx.coinGeo, this.ctx.coinMat)
      m.castShadow = true
      this.group.add(m)
      return m
    })
    // 單一高圓柱碰撞體包住整條螺旋塔，推開沿途幣堆
    this.towerColliders = [
      this.ctx.world.createCollider(
        RAPIER.ColliderDesc.cylinder(TOWER_H / 2, TOWER_R).setTranslation(-ARM_OFF, TOWER_H / 2 - ARM_H / 2, 0).setFriction(0.2),
        this.armBody,
      ),
    ]
    this.towerX = DOCK_TOWER_X
  }

  private land() {
    const { world, events } = this.ctx
    for (const c of this.towerColliders) world.removeCollider(c, true)
    this.towerColliders = []
    const coins = this.layers.map((l) => {
      const o = cloverAt(DOCK_COINS - 1 - l.lvl)
      return { dx: o.dx, dz: o.dz, level: o.level, yaw: l.yaw }
    })
    for (const m of this.mainCoins) this.group.remove(m)
    this.mainCoins = []
    for (const l of this.layers) this.pipCoins.remove(l.mesh)
    this.layers = []
    this.colCount = [0]
    this.ctx.spawnTower(DOCK_LAND_X, DOCK_Z, this.ctx.surfaceY(DOCK_LAND_X, DOCK_Z), coins)
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
