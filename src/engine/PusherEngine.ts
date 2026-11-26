import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { getAtlas, makeRepeatTexture, makeSpriteTexture } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  常數                                                                */
/* ------------------------------------------------------------------ */
export type CoinKind = 'gold' | 'platinum' | 'bar'

export const COIN_VALUE: Record<CoinKind, number> = { gold: 1, platinum: 5, bar: 20 }

const COIN_R = 0.32 // 幣半徑
const COIN_H = 0.12 // 幣厚度
const STACK_STEP = COIN_H + 0.004 // 疊塔每層高度

const FLOOR_Z0 = -5.4 // 檯面後端
const FLOOR_Z1 = 3.3 // 檯面前端（吞幣邊）
const WALL_X = 3.0 // 側牆中心（內側 2.85）
const KILL_Y = -0.9 // 跌落吞幣溝嘅判定高度

// ---- 兩層結構（同真機一樣） ----
// 上層：會前後郁嘅推板（頂面高 DECK_TOP）；銀仔落喺度。
// 固定擋板喺推板上方：推板縮返時刮住銀仔，銀仔跌落下層，推板前進再將下層幣堆推向前緣。
// ---- 前緣：下斜坡（幣自然滑落，唔會喺邊緣卡住）+ 中間派彩口 / 兩側邊溝 ----
const LIP_LEN = 0.7
const LIP_ANGLE = 0.35
const FLAT_END = FLOOR_Z1 - LIP_LEN // 平台去到呢度，之後斜落
const PAY_HALF = 1.4 // |x| <= 1.5 先派彩；兩側係邊溝（落邊溝唔計分，同真機一樣）

const DECK_TOP = 0.55
const DECK_HALF_DEPTH = 1.3
const DECK_CENTER = -1.5 // 推板前緣擺動中心
const DECK_STROKE = 1.1 // 前緣擺幅（-2.6 ~ -0.4）
const SCRAPER_Z = -2.45 // 背板位置（同時係推板縮返時刮幣嘅擋板）

// ---- 第一身射幣：背板有個左右移動嘅缺口，射中就掉落金幣，射唔中就跌返落推板 ----
const BOARD_TOP = 3.0
const GATE_Y0 = 1.35 // 缺口行下緣
const GATE_Y1 = 2.25 // 缺口行上緣
const GATE_HALF = 0.7 // 缺口半闊
const GATE_AMP = 1.9 // 缺口左右擺幅
const GATE_W = 1.3 // 缺口擺動角速度 (rad/s)
const GATE_TOL = GATE_HALF - 0.19 // 幣中心要喺呢個範圍內先算射入
const GATE_PERFECT = 0.2 // 正中
const FLIGHT_T = 0.6 // 飛行時間 (s)
const FLIGHT_G = 14
// 三條射擊線：左 / 中 / 右（槍口位置 + 缺口目標 X）
const LANES = [
  { mx: -2.5, mz: 3.7, tx: -1.5, reward: 1 }, // 左：易，獎勵少
  { mx: 0, mz: 3.9, tx: 0, reward: 2 }, // 中：難，獎勵多
  { mx: 2.5, mz: 3.7, tx: 1.5, reward: 1 }, // 右
] as const
const MUZZLE_Y = 0.9
const GATE_COIN_Y = (GATE_Y0 + GATE_Y1) / 2

const FIXED_STEP = 1 / 60
const MAX_BODIES = 400
const PREFILL_COINS = 160
const PREFILL_TOWER_LAYERS = 15
export const TOWER_EVERY = 25
export const TOWER_LAYERS = 10
const TOWER_TOPPLE_COUNT = 12 // 同一棟塔跌出 12 隻幣 → JP3

const CAPACITY: Record<CoinKind, number> = { gold: 540, platinum: 80, bar: 50 }

export interface EngineEvents {
  onCollect(kind: CoinKind, value: number): void
  onJackpot(tier: 1 | 2 | 3): void
  onTowerSpawn(): void
  /** 射出嘅幣首次碰到檯面／幣堆 */
  onClink(): void
  /** 推板行到盡頭轉向 */
  onPusherTurn(): void
  /** 疊塔第 i 層落咗 */
  onStack(i: number): void
  /** 幣跌入兩側邊溝（唔派彩） */
  onGutter(): void
  /** 射幣到達背板：命中缺口與否 */
  onGate(hit: boolean, perfect: boolean, lane: -1 | 0 | 1): void
}

interface Item {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  clinked: boolean
  kind: CoinKind
  towerId: number
  /** 下一幀要同步矩陣 */
  sync: boolean
}

interface Effect {
  mesh: THREE.Mesh
  t: number
  life: number
  tick(e: Effect, k: number): void
}

interface TowerJob {
  id: number
  x: number
  z: number
  baseY: number
  next: number
  layers: number
  timer: number
  yaw: number
}

let rapierReady: Promise<void> | null = null
const initRapier = () => (rapierReady ??= RAPIER.init())

/* ------------------------------------------------------------------ */
/*  PusherEngine：Rapier3D 剛體 + THREE.InstancedMesh                    */
/* ------------------------------------------------------------------ */
export class PusherEngine {
  /** 加入 R3F scene 嘅根節點 */
  readonly group = new THREE.Group()

  private events: EngineEvents
  private world!: RAPIER.World
  private pusher!: RAPIER.RigidBody
  private pusherMesh!: THREE.Mesh
  private gateL!: THREE.Mesh
  private gateR!: THREE.Mesh
  private gateGlow!: THREE.Mesh
  private gateFlash = 0
  private flights: Array<{ mesh: THREE.Mesh; t: number; kind: CoinKind; lane: 0 | 1 | 2 }> = []
  private flightGeo = {} as Record<CoinKind, THREE.BufferGeometry>
  private flightMat = {} as Record<CoinKind, THREE.Material | THREE.Material[]>
  private meshes = {} as Record<CoinKind, THREE.InstancedMesh>
  private items: Record<CoinKind, Item[]> = { gold: [], platinum: [], bar: [] }
  private effects: Effect[] = []
  private towerJobs: TowerJob[] = []
  private towerFall = new Map<number, number>()
  private towerPaid = new Set<number>()
  private nextTowerId = 1
  private eventQueue!: RAPIER.EventQueue
  private colliderItem = new Map<number, Item>()
  private lastDir = 1
  private awake = 0
  private payFlash = 0
  private flashMesh!: THREE.Mesh

  private acc = 0
  private simTime = 0
  private time = 0

  private disposables: Array<{ dispose(): void }> = []
  private magicTex!: THREE.CanvasTexture

  private readonly _pos = new THREE.Vector3()
  private readonly _quat = new THREE.Quaternion()
  private readonly _euler = new THREE.Euler()
  private readonly _one = new THREE.Vector3(1, 1, 1)
  private readonly _m = new THREE.Matrix4()
  private readonly _tint = new THREE.Color(1, 0.86, 0.74)
  private readonly _white = new THREE.Color(1, 1, 1)

  static async create(events: EngineEvents): Promise<PusherEngine> {
    await initRapier()
    const engine = new PusherEngine(events)
    engine.build()
    return engine
  }

  private constructor(events: EngineEvents) {
    this.events = events
  }

  /* ------------------------- 建構 ------------------------- */
  private build() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 })
    this.world.numSolverIterations = 8 // 解算器迭代數（防穿透 / 疊塔穩定）
    this.eventQueue = new RAPIER.EventQueue(true)

    this.buildTable()
    this.buildCoinMeshes()
    this.prefill()
  }

  /** 透明貼花材質（唔受光照，保持圖集原色） */
  private decalMat(canvas: HTMLCanvasElement) {
    const tex = this.track(makeSpriteTexture(canvas))
    return this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false }))
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o)
    return o
  }

  private buildTable() {
    const { tiles, sprites } = getAtlas()
    const std = (map: THREE.Texture | null, extra: THREE.MeshStandardMaterialParameters = {}) =>
      this.track(new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.08, ...extra }))

    const floorTex = this.track(makeRepeatTexture(tiles.floor, 3, 4.2))
    const wallTex = this.track(makeRepeatTexture(tiles.wall, 8, 1))
    const grooveTex = this.track(makeRepeatTexture(tiles.groove, 6, 1))
    const pusherTop = this.track(makeRepeatTexture(tiles.pusher, 3, 1))
    const pusherSide = this.track(makeRepeatTexture(tiles.pusher, 3, 0.35))

    const floorMat = std(floorTex)
    const wallMat = std(wallTex)
    const grooveMat = std(grooveTex, { roughness: 0.4, metalness: 0.25 })
    const darkMat = std(null, { color: '#2b1244' })

    const depth = FLOOR_Z1 - FLOOR_Z0 // 8.7
    const zc = (FLOOR_Z1 + FLOOR_Z0) / 2

    // 檯面（+x,-x,+y,-y,+z,-z）：頂面貓爪紫絨、前面紅金斜紋吞幣溝
    const flatDepth = FLAT_END - FLOOR_Z0
    const flatZc = (FLAT_END + FLOOR_Z0) / 2
    const floor = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(WALL_X * 2 + 0.3, 1.2, flatDepth)),
      [darkMat, darkMat, floorMat, darkMat, grooveMat, darkMat],
    )
    floor.position.set(0, -0.6, flatZc)
    this.group.add(floor)

    // 前緣下斜坡：中間金紅派彩口、兩側深色邊溝
    const rampLen = LIP_LEN / Math.cos(LIP_ANGLE)
    const rampW = WALL_X * 2 + 0.3
    const ramp = new THREE.Group()
    ramp.position.set(0, -0.17, FLAT_END + LIP_LEN / 2)
    ramp.rotation.x = LIP_ANGLE
    const payMat = std(grooveTex, { roughness: 0.35, metalness: 0.3, emissive: '#6a3a00', emissiveIntensity: 0.6 })
    const gutterTex = this.track(makeRepeatTexture(tiles.gutter, 2, 3))
    const gutterMat = std(gutterTex, { roughness: 0.8, color: '#c9a0a8' })
    const center = new THREE.Mesh(this.track(new THREE.BoxGeometry(PAY_HALF * 2, 0.1, rampLen)), payMat)
    ramp.add(center)
    const sideW = (rampW - PAY_HALF * 2) / 2
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(this.track(new THREE.BoxGeometry(sideW, 0.1, rampLen)), gutterMat)
      side.position.x = sx * (PAY_HALF + sideW / 2)
      ramp.add(side)
      // 邊溝蓋（✗）：貼喺邊溝斜坡上面
      const cover = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(sideW * 0.85, sideW * 0.85 * (sprites.gutter_cover.height / sprites.gutter_cover.width))),
        this.decalMat(sprites.gutter_cover.canvas),
      )
      cover.rotation.x = -Math.PI / 2
      cover.position.set(side.position.x, 0.07, 0)
      ramp.add(cover)
    }
    this.group.add(ramp)

    // 出幣槽：幣跌到呢度消失喺深色槽入面（睇得到跌落）
    const slotFront = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(rampW, 1.0, 0.2)),
      std(null, { color: '#1a0612', roughness: 0.7 }),
    )
    slotFront.position.set(0, -0.8, FLOOR_Z1 + 0.5)
    this.group.add(slotFront)
    // 出幣槽正面警示框貼圖
    const slotW = PAY_HALF * 2 + 0.8
    const slotDecal = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(slotW, slotW * (sprites.payout_slot.height / sprites.payout_slot.width))),
      this.decalMat(sprites.payout_slot.canvas),
    )
    slotDecal.position.set(0, -0.75, FLOOR_Z1 + 0.62)
    this.group.add(slotDecal)
    const slotLip = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(rampW, 0.08, 0.28)),
      std(null, { color: '#f2c14e', metalness: 0.7, roughness: 0.3 }),
    )
    slotLip.position.set(0, -0.28, FLOOR_Z1 + 0.5)
    this.group.add(slotLip)

    // 派彩閃光
    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PAY_HALF * 2 + 0.4, 1.4),
      new THREE.MeshBasicMaterial({
        color: '#ffd34d',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.flashMesh.rotation.x = -Math.PI / 2 + 0.2
    this.flashMesh.position.set(0, -0.2, FLOOR_Z1 + 0.15)
    this.group.add(this.flashMesh)

    // 側牆：粉白條紋
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, 1.0, depth)), wallMat)
      wall.position.set(sx * WALL_X, 0.5, zc)
      this.group.add(wall)
    }
    const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(WALL_X * 2 + 0.3, 1.8, 0.3)), wallMat)
    back.position.set(0, 0.9, FLOOR_Z0 - 0.15)
    this.group.add(back)

    // 推板：金雕花
    const topMat = std(pusherTop, { roughness: 0.35, metalness: 0.35 })
    const sideMat = std(pusherSide, { roughness: 0.35, metalness: 0.35 })
    this.pusherMesh = new THREE.Mesh(this.track(new THREE.BoxGeometry((WALL_X - 0.2) * 2, DECK_TOP, DECK_HALF_DEPTH * 2)), [
      sideMat,
      sideMat,
      topMat,
      darkMat,
      sideMat,
      sideMat,
    ])
    this.group.add(this.pusherMesh)

    // 背板：下半塊兼做擋板（推板縮返時刮落銀仔），中間一行係會左右移動嘅缺口
    const bw = (WALL_X - 0.1) * 2
    const yLow = DECK_TOP + 0.09
    const block = (y0: number, y1: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(bw, y1 - y0, 0.2)), mat)
      m.position.set(0, (y0 + y1) / 2, SCRAPER_Z)
      this.group.add(m)
    }
    block(yLow, GATE_Y0, wallMat)
    block(GATE_Y1, BOARD_TOP, wallMat)
    // 缺口後面嘅暖光（睇到缺口喺邊）
    this.gateGlow = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(bw, GATE_Y1 - GATE_Y0)),
      this.track(new THREE.MeshBasicMaterial({ color: '#ffcf5a' })),
    )
    this.gateGlow.position.set(0, GATE_COIN_Y, SCRAPER_Z - 0.12)
    this.group.add(this.gateGlow)
    // 兩塊會伸縮嘅擋板，夾住缺口
    const gateMat = std(wallTex, { color: '#ffd0e8', emissive: '#3a1030', emissiveIntensity: 0.4 })
    const gGeo = this.track(new THREE.BoxGeometry(1, GATE_Y1 - GATE_Y0, 0.2))
    this.gateL = new THREE.Mesh(gGeo, gateMat)
    this.gateR = new THREE.Mesh(gGeo, gateMat)
    this.gateL.position.set(0, GATE_COIN_Y, SCRAPER_Z)
    this.gateR.position.set(0, GATE_COIN_Y, SCRAPER_Z)
    this.group.add(this.gateL, this.gateR)
    // 缺口金邊（跟住缺口郁）
    const trimMat = std(null, { color: '#f2c14e', metalness: 0.7, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.5 })
    const trimGeo = this.track(new THREE.BoxGeometry(0.08, GATE_Y1 - GATE_Y0 + 0.1, 0.26))
    this.gateL.add(new THREE.Mesh(trimGeo, trimMat))
    this.gateR.add(new THREE.Mesh(trimGeo, trimMat))
    this.updateGate()

    // 魔法陣貼圖共用
    this.magicTex = this.track(makeSpriteTexture(sprites.magic_circle.canvas))

    // 物理：檯面、牆、推板
    const W = this.world
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.6, slippery = false) => {
      const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z))
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction)
      // 側牆零摩擦（取兩邊較細值）：貼牆嘅幣唔會被牆夾住，防止邊位卡幣
      if (slippery) cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      W.createCollider(cd, body)
    }
    fixed(WALL_X + 0.15, 0.6, flatDepth / 2, 0, -0.6, flatZc)
    {
      const q = { x: Math.sin(LIP_ANGLE / 2), y: 0, z: 0, w: Math.cos(LIP_ANGLE / 2) }
      const rb = W.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.17, FLAT_END + LIP_LEN / 2).setRotation(q),
      )
      W.createCollider(RAPIER.ColliderDesc.cuboid(WALL_X + 0.15, 0.05, rampLen / 2).setFriction(0.2), rb)
    }
    // 牆嘅碰撞體比外觀高（1.6），幣被推板擠高都唔會飛出檯面
    fixed(0.15, 0.8, depth / 2, -WALL_X, 0.8, zc, 0, true)
    fixed(0.15, 0.8, depth / 2, WALL_X, 0.8, zc, 0, true)
    fixed(WALL_X + 0.15, 1.2, 0.15, 0, 1.2, FLOOR_Z0 - 0.15)

    // 擋板：底邊高過推板頂面 0.09（細過一隻幣嘅厚度，幣過唔到，推板可以由下面滑過）
    // 背板碰撞體：全高實心（缺口只係判定，唔係真穿孔）
    fixed(WALL_X - 0.1, (BOARD_TOP - DECK_TOP - 0.09) / 2, 0.1, 0, (BOARD_TOP + DECK_TOP + 0.09) / 2, SCRAPER_Z)

    this.pusher = W.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, DECK_TOP / 2, DECK_CENTER - DECK_HALF_DEPTH),
    )
    W.createCollider(RAPIER.ColliderDesc.cuboid(WALL_X - 0.2, DECK_TOP / 2, DECK_HALF_DEPTH).setFriction(0.9), this.pusher)
    this.placePusher(0)
  }

  private buildCoinMeshes() {
    const { coinFaces } = getAtlas()
    const faceTex = (c: HTMLCanvasElement) => {
      const t = this.track(makeSpriteTexture(c))
      return t
    }
    const mk = (side: string, face: THREE.Texture) => {
      const sideMat = this.track(new THREE.MeshStandardMaterial({ color: side, metalness: 0.55, roughness: 0.32 }))
      const faceMat = this.track(new THREE.MeshStandardMaterial({ map: face, metalness: 0.25, roughness: 0.45 }))
      return [sideMat, faceMat, faceMat]
    }
    const cyl = this.track(new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 28))
    const box = this.track(new THREE.BoxGeometry(0.84, 0.26, 0.48))

    this.meshes.gold = new THREE.InstancedMesh(cyl, mk('#e9b52a', faceTex(coinFaces.gold)), CAPACITY.gold)
    this.meshes.platinum = new THREE.InstancedMesh(
      cyl,
      mk('#c9d3df', faceTex(coinFaces.platinum)),
      CAPACITY.platinum,
    )
    this.meshes.bar = new THREE.InstancedMesh(
      box,
      this.track(new THREE.MeshStandardMaterial({ color: '#f6c640', metalness: 0.6, roughness: 0.25 })),
      CAPACITY.bar,
    )

    this.flightGeo = { gold: cyl, platinum: cyl, bar: box }
    this.flightMat = { gold: this.meshes.gold.material, platinum: this.meshes.platinum.material, bar: this.meshes.bar.material }

    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) {
      const m = this.meshes[kind]
      m.count = 0
      m.frustumCulled = false
      for (let i = 0; i < CAPACITY[kind]; i++) m.setColorAt(i, this._white)
      this.group.add(m)
      this.track(m)
    }
  }

  /* ------------------------- 幣生成 ------------------------- */
  private createItem(
    kind: CoinKind,
    p: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number; w: number },
    opts: { vel?: { x: number; y: number; z: number }; spin?: { x: number; y: number; z: number }; towerId?: number; sleeping?: boolean; ccd?: boolean } = {},
  ): Item | null {
    const arr = this.items[kind]
    if (arr.length >= CAPACITY[kind]) return null

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(rot)
      .setCanSleep(true)
      .setLinearDamping(0.35)
      .setAngularDamping(0.7)
      .setSleeping(!!opts.sleeping)
      .setCcdEnabled(!!opts.ccd)
    if (opts.vel) desc.setLinvel(opts.vel.x, opts.vel.y, opts.vel.z)
    if (opts.spin) desc.setAngvel(opts.spin)
    const body = this.world.createRigidBody(desc)

    const cd =
      kind === 'bar'
        ? RAPIER.ColliderDesc.cuboid(0.42, 0.13, 0.24)
        : RAPIER.ColliderDesc.cylinder(COIN_H / 2, COIN_R)
    // 只有射出嘅幣先開碰撞事件（用嚟出「叮」聲），其餘唔開，慳性能
    cd.setFriction(0.5).setRestitution(0.05).setDensity(kind === 'bar' ? 2.5 : 1)
    if (opts.ccd) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    const collider = this.world.createCollider(cd, body)

    const item: Item = { body, collider, clinked: !opts.ccd, kind, towerId: opts.towerId ?? 0, sync: true }
    if (opts.ccd) this.colliderItem.set(collider.handle, item)
    arr.push(item)
    const mesh = this.meshes[kind]
    mesh.count = arr.length
    mesh.setColorAt(arr.length - 1, item.towerId ? this._tint : this._white)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return item
  }

  private removeItem(kind: CoinKind, index: number) {
    const arr = this.items[kind]
    const it = arr[index]
    this.colliderItem.delete(it.collider.handle)
    this.world.removeRigidBody(it.body)
    const last = arr.length - 1
    const mesh = this.meshes[kind]
    if (index !== last) {
      arr[index] = arr[last]
      arr[index].sync = true
      mesh.setColorAt(index, arr[index].towerId ? this._tint : this._white)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    arr.pop()
    mesh.count = arr.length
    if (arr.length) mesh.instanceMatrix.needsUpdate = true
  }

  private totalBodies() {
    return this.items.gold.length + this.items.platinum.length + this.items.bar.length
  }

  /** 超過上限時回收最舊嘅散幣（先揀已入睡嘅，再揀任何非塔幣） */
  private recycle(): boolean {
    const arr = this.items.gold
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].towerId && arr[i].body.isSleeping()) {
        this.removeItem('gold', i)
        return true
      }
    }
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].towerId) {
        this.removeItem('gold', i)
        return true
      }
    }
    return false
  }

  /** 開局預鋪：160 幣 + 3 條金磚 + 1 棟 15 層塔（鋪喺下層，推板前面） */
  private prefill() {
    const y0 = COIN_H / 2 + 0.002
    const Z_START = -0.9 // 推板最前緣 -0.4，預留少少空位
    const layers: Array<{ cols: number; rows: number; ox: number; oz: number }> = [
      { cols: 8, rows: 6, ox: 0, oz: 0 },
      { cols: 7, rows: 5, ox: 0.34, oz: 0.343 },
      { cols: 8, rows: 6, ox: 0, oz: 0 },
      { cols: 7, rows: 5, ox: 0.34, oz: 0.343 },
    ]
    const bars: Array<[number, number]> = [[-1.7, 1.0], [0.4, 1.9], [1.9, 0.3]]
    const dx = 0.68
    const dz = 0.686
    let placed = 0
    const identity = { x: 0, y: 0, z: 0, w: 1 }
    for (let li = 0; li < layers.length && placed < PREFILL_COINS; li++) {
      const L = layers[li]
      for (let r = 0; r < L.rows && placed < PREFILL_COINS; r++) {
        for (let c = 0; c < L.cols && placed < PREFILL_COINS; c++) {
          const x = -2.38 + L.ox + c * dx + (Math.random() - 0.5) * 0.05
          const z = Z_START + L.oz + r * dz + (Math.random() - 0.5) * 0.05
          // 第 4 層避開金磚位置
          if (li === 3 && bars.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 0.9)) continue
          const y = y0 + li * STACK_STEP
          this._quat.setFromEuler(this._euler.set(0, Math.random() * Math.PI * 2, 0))
          const kind: CoinKind = Math.random() < 0.06 ? 'platinum' : 'gold'
          this.createItem(kind, { x, y, z }, this._quat, { sleeping: true })
          placed++
        }
      }
    }
    // 3 條金磚擺喺第 4 層高度
    const topY = y0 + 2 * STACK_STEP + COIN_H / 2 + STACK_STEP
    for (const [x, z] of bars) {
      this.createItem('bar', { x, y: topY + 0.14, z }, identity, { sleeping: true })
    }
    // 1 棟 15 層塔
    this.buildTowerInstant(1.1, 1.5, PREFILL_TOWER_LAYERS)
  }

  private surfaceY(x: number, z: number): number {
    const ray = new RAPIER.Ray({ x, y: 6, z }, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(ray, 12, true)
    return hit ? 6 - hit.timeOfImpact : 0
  }

  private buildTowerInstant(x: number, z: number, layers: number) {
    const id = this.nextTowerId++
    const base = this.surfaceY(x, z)
    const yaw = Math.random() * Math.PI
    this._quat.setFromEuler(this._euler.set(0, yaw, 0))
    for (let i = 0; i < layers; i++) {
      this.createItem(
        'gold',
        { x, y: base + COIN_H / 2 + 0.01 + i * STACK_STEP, z },
        this._quat,
        { towerId: id, sleeping: true },
      )
    }
  }

  /* ------------------------- 公開 API ------------------------- */
  /** 缺口中心 X（左右擺動） */
  gateX(): number {
    return Math.sin(this.time * GATE_W) * GATE_AMP
  }

  private updateGate() {
    const x = this.gateX()
    const edge = WALL_X - 0.1
    const wl = Math.max(0.001, x - GATE_HALF + edge)
    const wr = Math.max(0.001, edge - (x + GATE_HALF))
    this.gateL.scale.x = wl
    this.gateL.position.x = -edge + wl / 2
    this.gateR.scale.x = wr
    this.gateR.position.x = edge - wr / 2
    // 金邊係子物件，要抵消父層嘅 x 縮放
    const lt = this.gateL.children[0]
    const rt = this.gateR.children[0]
    lt.scale.x = 1 / wl
    lt.position.x = 0.5
    rt.scale.x = 1 / wr
    rt.position.x = -0.5
  }

  /** 由玩家面前射一隻幣飛向背板缺口，返回射出嘅種類 */
  shoot(lane: -1 | 0 | 1 = 0): CoinKind | null {
    if (this.totalBodies() >= MAX_BODIES && !this.recycle()) return null
    // 平時射出嘅一定係普通幣；金磚改由「連續命中 5 次」獎勵（dropBar）
    const kind: CoinKind = 'gold'
    const mesh = new THREE.Mesh(this.flightGeo[kind], this.flightMat[kind])
    const li = (lane + 1) as 0 | 1 | 2
    mesh.position.set(LANES[li].mx, MUZZLE_Y, LANES[li].mz)
    this.group.add(mesh)
    this.flights.push({ mesh, t: 0, kind, lane: li })
    return kind
  }

  private updateFlights(dt: number) {
    const vy = (GATE_COIN_Y - MUZZLE_Y + 0.5 * FLIGHT_G * FLIGHT_T * FLIGHT_T) / FLIGHT_T
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]
      f.t += dt
      const k = Math.min(1, f.t / FLIGHT_T)
      const L = LANES[f.lane]
      f.mesh.position.set(
        L.mx + (L.tx - L.mx) * k,
        MUZZLE_Y + vy * f.t - 0.5 * FLIGHT_G * f.t * f.t,
        L.mz + (SCRAPER_Z + 0.1 - L.mz) * k,
      )
      f.mesh.rotation.set(Math.PI / 2 + f.t * 16, 0, 0) // 翻滾
      if (f.t >= FLIGHT_T) {
        this.group.remove(f.mesh)
        this.flights.splice(i, 1)
        this.resolveFlight(f.kind, f.lane)
      }
    }
  }

  /** 喺缺口後面、推台上方掉落一隻幣（x 為該射擊線嘅推台落點） */
  private dropAt(k: CoinKind, x: number, y: number, vz: number, vy2: number) {
    this._quat.setFromEuler(this._euler.set((Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.9))
    this.createItem(k, { x, y, z: SCRAPER_Z + 0.3 }, this._quat, {
      vel: { x: (Math.random() - 0.5) * 0.4, y: vy2, z: vz },
      spin: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
      ccd: true,
    })
  }

  /** 幣到達背板：射入移動缺口先掉落；撞中擋板即 Miss，幣直接消失（投幣已扣） */
  private resolveFlight(_kind: CoinKind, lane: 0 | 1 | 2) {
    const L = LANES[lane]
    const d = Math.abs(this.gateX() - L.tx)
    const hit = d <= GATE_TOL
    const perfect = d <= GATE_PERFECT
    if (hit) {
      // 左線 → 推台左側上方 1 枚；中線 → 正中央上方 2 枚；右線 → 推台右側上方 1 枚
      for (let n = 0; n < L.reward; n++) {
        const off = L.reward > 1 ? (n - (L.reward - 1) / 2) * 0.3 : 0
        this.dropAt('gold', L.tx + off, GATE_COIN_Y + n * 0.3, 0.6 + Math.random() * 0.8, -0.3)
      }
      this.gateFlash = 1
    }
    // Miss：唔生成任何幣
    this.events.onGate(hit, perfect, (lane - 1) as -1 | 0 | 1)
  }

  /** 連續命中 5 次獎勵：正中央掉落 1 塊金磚 */
  dropBar() {
    this.dropAt('bar', 0, GATE_COIN_Y, 0.6 + Math.random() * 0.6, -0.3)
    this.gateFlash = 1
  }

  /** 運氣值儲滿：魔法陣 + 逐層疊出 18 層高塔 */
  spawnTower() {
    const margin = 0.55
    const x = (Math.random() * 2 - 1) * Math.min(0.6, WALL_X - 0.15 - COIN_R - margin) // 喺中間生成
    const z = 0.3 + Math.random() * 0.8
    const id = this.nextTowerId++
    const baseY = this.surfaceY(x, z)

    this.towerJobs.push({
      id,
      x,
      z,
      baseY,
      next: 0,
      layers: TOWER_LAYERS,
      timer: 0.45, // 等魔法陣先亮
      yaw: Math.random() * Math.PI,
    })

    // 魔法陣
    const mat = new THREE.MeshBasicMaterial({
      map: this.magicTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, baseY + 0.04, z)
    this.group.add(mesh)
    this.effects.push({
      mesh,
      t: 0,
      life: 2.6,
      tick: (e, k) => {
        const rise = Math.min(1, k * 5)
        const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1
        ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = rise * fade
        e.mesh.scale.setScalar(0.4 + 0.6 * Math.min(1, k * 4))
        e.mesh.rotation.z += 0.04
      },
    })
    this.events.onTowerSpawn()
  }

  get bodyCount() {
    return this.totalBodies()
  }

  /* ------------------------- 每幀更新 ------------------------- */
  private placePusher(t: number) {
    const zFront = DECK_CENTER + DECK_STROKE * Math.sin(t * 1.7)
    const zc = zFront - DECK_HALF_DEPTH
    this.pusher.setNextKinematicTranslation({ x: 0, y: DECK_TOP / 2, z: zc })
    return zc
  }

  update(dt: number) {
    this.time += dt
    this.acc += Math.min(dt, 0.05)
    let steps = 0
    while (this.acc >= FIXED_STEP && steps < 3) {
      this.simTime += FIXED_STEP
      this.placePusher(this.simTime)
      this.world.step(this.eventQueue)
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return
        const it = this.colliderItem.get(h1) ?? this.colliderItem.get(h2)
        if (it && !it.clinked) {
          it.clinked = true
          it.collider.setActiveEvents(0)
          this.colliderItem.delete(it.collider.handle)
          this.events.onClink()
        }
      })
      const dir = Math.cos(this.simTime * 1.7) >= 0 ? 1 : -1
      if (dir !== this.lastDir) {
        this.lastDir = dir
        this.events.onPusherTurn()
      }
      this.acc -= FIXED_STEP
      steps++
    }

    // 推板 mesh
    const pt = this.pusher.translation()
    this.pusherMesh.position.set(pt.x, pt.y, pt.z)

    this.processTowerJobs(dt)
    this.syncMeshes()

    // 背板缺口 + 飛行中嘅幣
    this.updateGate()
    this.updateFlights(dt)
    this.gateFlash = Math.max(0, this.gateFlash - dt * 3)
    ;(this.gateGlow.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.81 + 0.19 * this.gateFlash, 0.35 + 0.65 * this.gateFlash)

    // 派彩閃光
    this.payFlash = Math.max(0, this.payFlash - dt * 3.5)
    ;(this.flashMesh.material as THREE.MeshBasicMaterial).opacity = this.payFlash * 0.22

    // 特效
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      e.t += dt
      const k = e.t / e.life
      if (k >= 1) {
        this.group.remove(e.mesh)
        e.mesh.geometry.dispose()
        ;(e.mesh.material as THREE.Material).dispose()
        this.effects.splice(i, 1)
        continue
      }
      e.tick(e, k)
    }
  }

  private processTowerJobs(dt: number) {
    for (let j = this.towerJobs.length - 1; j >= 0; j--) {
      const job = this.towerJobs[j]
      job.timer -= dt
      while (job.timer <= 0 && job.next < job.layers) {
        this._quat.setFromEuler(this._euler.set(0, job.yaw, 0))
        this.createItem(
          'gold',
          { x: job.x, y: job.baseY + COIN_H / 2 + 0.01 + job.next * STACK_STEP, z: job.z },
          this._quat,
          { towerId: job.id },
        )
        this.events.onStack(job.next)
        job.next++
        job.timer += 0.035
      }
      if (job.next >= job.layers) this.towerJobs.splice(j, 1)
    }
  }

  /** 推板速度 0..1（用嚟控制機械聲） */
  get pusherSpeed(): number {
    return Math.abs(Math.cos(this.simTime * 1.7))
  }

  /** 幣堆活動量 0..1（郁緊嘅幣愈多，磨擦聲愈大） */
  get activity(): number {
    return Math.min(1, this.awake / 45)
  }

  private syncMeshes() {
    let awake = 0
    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) {
      const arr = this.items[kind]
      const mesh = this.meshes[kind]
      let dirty = false
      let fallen: Array<{ idx: number; legit: boolean; gutter: boolean }> | null = null

      for (let i = 0; i < arr.length; i++) {
        const it = arr[i]
        const sleeping = it.body.isSleeping()
        if (!sleeping) awake++
        if (sleeping && !it.sync) continue
        it.sync = !sleeping // 入睡嗰一幀仍會同步一次
        const p = it.body.translation()
        // 異常：NaN / 飛出檯面範圍 → 靜靜移除，唔派彩
        const bad =
          !Number.isFinite(p.x + p.y + p.z) ||
          Math.abs(p.x) > WALL_X + 0.6 ||
          p.z < FLOOR_Z0 - 0.6 ||
          p.y > 6
        if (bad) {
          ;(fallen ??= []).push({ idx: i, legit: false, gutter: false })
          continue
        }
        if (p.y < KILL_Y) {
          // 只有喺前緣跌入吞幣溝先算贏分（防止幣由側面／後面跌出去都派彩）
          const front = p.z > FLOOR_Z1 - 0.35 && Math.abs(p.x) < WALL_X
          ;(fallen ??= []).push({ idx: i, legit: front && Math.abs(p.x) <= PAY_HALF, gutter: front && Math.abs(p.x) > PAY_HALF })
          continue
        }
        const q = it.body.rotation()
        this._pos.set(p.x, p.y, p.z)
        this._quat.set(q.x, q.y, q.z, q.w)
        this._m.compose(this._pos, this._quat, this._one)
        mesh.setMatrixAt(i, this._m)
        dirty = true
      }

      if (fallen) {
        // 由後往前移除，避免 swap-pop 打亂索引
        for (let k = fallen.length - 1; k >= 0; k--) {
          const { idx, legit, gutter } = fallen[k]
          if (legit) {
            this.collect(arr[idx])
            this.payFlash = 1
          } else if (gutter) this.events.onGutter()
          this.removeItem(kind, idx)
        }
        dirty = true
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true
    }
    this.awake = awake
  }

  private collect(it: Item) {
    const value = COIN_VALUE[it.kind]
    this.events.onCollect(it.kind, value)
    if (it.kind === 'platinum') this.events.onJackpot(1)
    else if (it.kind === 'bar') this.events.onJackpot(2)
    if (it.towerId) {
      const n = (this.towerFall.get(it.towerId) ?? 0) + 1
      this.towerFall.set(it.towerId, n)
      if (n >= TOWER_TOPPLE_COUNT && !this.towerPaid.has(it.towerId)) {
        this.towerPaid.add(it.towerId)
        this.events.onJackpot(3)
      }
    }
  }

  /* ------------------------- 清理 ------------------------- */
  dispose() {
    for (const f of this.flights) this.group.remove(f.mesh)
    this.flights.length = 0
    for (const e of this.effects) {
      this.group.remove(e.mesh)
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
    }
    this.effects.length = 0
    this.group.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.flashMesh.geometry.dispose()
    ;(this.flashMesh.material as THREE.Material).dispose()
    this.eventQueue.free()
    this.colliderItem.clear()
    this.world.free()
  }
}
