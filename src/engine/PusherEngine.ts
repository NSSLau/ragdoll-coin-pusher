import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { getAtlas, makeRepeatTexture, makeSpriteTexture } from '../utils/SpriteAtlas'
import {
  BOARD_TOP,
  FRONT_FACE_Z,
  GATE_COIN_Y,
  GEAR_Z,
  GearPortal,
  HOLE_KINDS,
  HOLE_PERFECT,
  HOLE_TOL,
  IRIS_PASS,
  LANE_TX,
  SCRAPER_Z,
  holePos,
  irisOpen,
} from './GearPortal'
import { DOCK_GAP_HALF, DOCK_Z, TowerDock, type DockPhase } from './TowerDock'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bumpTexture, velvetBumpCanvas } from './materials'
import { SpecialItems, type SpecialKind } from './SpecialItems'

export type { SpecialKind } from './SpecialItems'
export { DOCK_COINS } from './TowerDock'
export type { DockPhase } from './TowerDock'

/* ------------------------------------------------------------------ */
/*  常數                                                                */
/* ------------------------------------------------------------------ */
export type CoinKind = 'gold' | 'platinum' | 'bar'

export const COIN_VALUE: Record<CoinKind, number> = { gold: 1, platinum: 0, bar: 5 }

const COIN_R = 0.27 // 幣半徑（直徑 0.54，原 0.64 縮 ~15%）
const COIN_H = 0.065 // 幣厚度（原 0.12，減薄）
const STACK_STEP = COIN_H + 0.004 // 疊塔每層高度

const FLOOR_Z0 = -5.4 // 檯面後端
const FLOOR_Z1 = 3.3 // 檯面前端（吞幣邊）
const WALL_X = 3.0 // 側牆中心（內側 2.85）
const KILL_Y = -0.9 // 跌落吞幣溝嘅判定高度
const WALL_VIS_H = 0.62 // 側牆外觀高度（降低，鏡頭先睇得到右側築塔台；碰撞體仍然 1.6 高）

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
// ---- 第一身射幣：前後雙層擋板（見 GatePlates.ts）----
const FLIGHT_T = 0.6 // 飛行時間 (s)
const FLIGHT_G = 14
// 三條射擊線：左 / 中 / 右。槍口位置由 3D 炮台幾何推算（炮管朝向後板缺口，仰角 CANNON_PITCH）
const CANNON_PITCH = 0.46
const CANNON_LEN = 0.95
const CANNON_PIVOT_Y = 0.5
const CANNON_S = 0.78 // 炮台整體縮放
const CANNON_BASE = [
  { px: -1.95, pz: 3.45, reward: 2 }, // 左：易，獎勵少
  { px: 0, pz: 3.65, reward: 3 }, // 中：難，獎勵多
  { px: 1.95, pz: 3.45, reward: 2 }, // 右
] as const
const LANES = CANNON_BASE.map((b, i) => {
  const tx = LANE_TX[i]
  const yaw = Math.atan2(tx - b.px, b.pz - (SCRAPER_Z + 0.1))
  return {
    px: b.px,
    pz: b.pz,
    yaw,
    mx: b.px + Math.sin(yaw) * Math.cos(CANNON_PITCH) * CANNON_LEN * CANNON_S,
    mz: b.pz - Math.cos(yaw) * Math.cos(CANNON_PITCH) * CANNON_LEN * CANNON_S,
    tx,
    reward: b.reward,
  }
})
const GEAR_Z_END = GEAR_Z // 穿洞飛行終點（齒輪中層）
const SPAWN_Z = FRONT_FACE_Z + 0.35 // 穿過後 / 彈開後實體幣生成位置（齒輪前面）
const MUZZLE_Y = CANNON_S * (CANNON_PIVOT_Y + Math.sin(CANNON_PITCH) * CANNON_LEN)

const COIN_BIT = 0x0001
const GHOST_BIT = 0x0002
const GHOST_LIFE = 1.2 // 視覺彈跳幣壽命 (s)
const GHOST_BLINK_FROM = 0.75 // 呢個時間之後開始閃爍

const FIXED_STEP = 1 / 60
const LOOSE_CAP = 150 // 檯面散幣（唔計螺旋塔）上限：超過就壓縮最底層舊幣轉積分，防穿模 / Safari 記憶體爆滿
const MAX_BODIES = 270 // 連 100 枚螺旋塔計嘅硬上限
const PREFILL_COINS = 70
const PREFILL_TOWER_LAYERS = 6
const TOWER_TOPPLE_COUNT = 40 // 同一座螺旋塔跌出 40 隻幣 → JP3

const CAPACITY: Record<CoinKind, number> = { gold: 540, platinum: 80, bar: 50 }

/** 檯面殘局存檔：[kind, x,y,z, qx,qy,qz,qw, towerId] */
export type SavedCoin = [number, number, number, number, number, number, number, number, number]
export interface SavedTable {
  v: 1
  items: SavedCoin[]
}
const KINDS: CoinKind[] = ['gold', 'platinum', 'bar']

/** 穿過邊個機關：藍 / 金 / 紫能量環、中央光圈、空間折疊（1 變 3）；null = Miss */
export type GateKind = 'blue' | 'gold' | 'purple' | 'iris' | 'fold' | null

export interface EngineEvents {
  onCollect(kind: CoinKind, value: number): void
  onJackpot(tier: 1 | 2 | 3): void
  /** 側方築塔台嘅塔推入推幣池、落地 */
  onTowerSpawn(): void
  /** 築塔台開始推塔入池（閘門開啟） */
  onDockPush(): void
  /** 築塔台層數 / 階段變咗 */
  onDockChange(layers: number, phase: DockPhase): void
  /** 特殊道具由上方掉落到推幣池 */
  onSpecialDrop(kind: SpecialKind): void
  /** 特殊道具被推落派彩槽 */
  onSpecial(kind: SpecialKind): void
  /** 特殊道具跌入邊溝／出界（冇獎勵） */
  onSpecialLost(kind: SpecialKind): void
  /** 射出嘅幣首次碰到檯面／幣堆 */
  onClink(): void
  /** 推板行到盡頭轉向 */
  onPusherTurn(): void
  /** 築塔台第 i 層落咗 */
  onStack(i: number): void
  /** 幣跌入兩側邊溝（唔派彩） */
  onGutter(): void
  /** 射幣到達背板：命中缺口與否 */
  /** mult：齊射發數（1 / 3 / 5），同一瞬間射出嘅幣只回報一次 */
  onGate(hit: boolean, perfect: boolean, lane: -1 | 0 | 1, mult: number, kind: GateKind): void
  /** 壓縮咗 n 枚舊幣（檯面上限保護）→ 轉積分 */
  onCompress(n: number): void
}

interface Item {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  clinked: boolean
  kind: CoinKind
  towerId: number
  /** 視覺彈跳幣（Miss 彈開）：出生時間；唔派彩，到時閃爍消失 */
  ghostBorn?: number
  /** 下一幀要同步矩陣 */
  sync: boolean
}

interface Effect {
  mesh: THREE.Mesh
  t: number
  life: number
  tick(e: Effect, k: number): void
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
  private portal!: GearPortal
  /** 三個能量環洞口共鳴充能到幾時（遊戲時間，秒） */
  private charge = [0, 0, 0]
  private dock!: TowerDock
  private coinShadows = true
  private bulbs: Array<{ mesh: THREE.Mesh; idx: number; side: number }> = []
  private bulbMats: THREE.Material[] = []
  private rain: Array<{ t: number; kind: CoinKind }> = []
  private saved: SavedTable | null = null
  private cannons: Array<{ barrel: THREE.Group; kick: number }> = []
  /** 渲染時間（秒）／鏡頭微震（開炮時） */
  get timeNow() {
    return this.time
  }
  get shake() {
    return this.cannons.reduce((a, c) => Math.max(a, c.kick), 0)
  }
  /** 時間縮放（特殊道具過場慢動作用） */
  timeScale = 1
  private specials!: SpecialItems
  private gateFlash = 0
  private flights: Array<{ mesh: THREE.Mesh; t: number; kind: CoinKind; lane: 0 | 1 | 2; aimX: number; aimY: number; endZ: number; leader: boolean; mult: number; off: number }> = []
  private flightGeo = {} as Record<CoinKind, THREE.BufferGeometry>
  private flightMat = {} as Record<CoinKind, THREE.Material | THREE.Material[]>
  private meshes = {} as Record<CoinKind, THREE.InstancedMesh>
  private items: Record<CoinKind, Item[]> = { gold: [], platinum: [], bar: [] }
  private effects: Effect[] = []
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
  private beamTex!: THREE.CanvasTexture

  private readonly _pos = new THREE.Vector3()
  private readonly _quat = new THREE.Quaternion()
  private readonly _euler = new THREE.Euler()
  private readonly _one = new THREE.Vector3(1, 1, 1)
  private readonly _zero = new THREE.Vector3(0.0001, 0.0001, 0.0001)
  private readonly _m = new THREE.Matrix4()
  private readonly _tint = new THREE.Color(1, 0.86, 0.74)
  private readonly _white = new THREE.Color(1, 1, 1)

  static async create(events: EngineEvents, saved?: SavedTable | null): Promise<PusherEngine> {
    await initRapier()
    const engine = new PusherEngine(events)
    engine.saved = saved ?? null
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
    this.buildSides()
    this.buildCoinMeshes()
    this.buildCannons()
    this.buildDock()
    this.buildSpecials()
    this.prefill()
    this.applyShadows(this.group)
  }

  /** 機身可見 mesh 開動態陰影（半透明 / 發光特效 / 光板除外） */
  private applyShadows(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = m.material as THREE.Material | THREE.Material[]
      const first = Array.isArray(mat) ? mat[0] : mat
      const skip = first.transparent || first.type === 'MeshBasicMaterial' || (m.geometry as THREE.BufferGeometry).type === 'PlaneGeometry'
      m.castShadow = !skip
      m.receiveShadow = !(first.type === 'MeshBasicMaterial')
    })
  }

  /** 透明貼花材質（唔受光照，保持圖集原色） */
  private decalMat(canvas: HTMLCanvasElement) {
    const tex = this.track(makeSpriteTexture(canvas))
    return this.track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.6, metalness: 0.1 }))
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o)
    return o
  }

  private buildTable() {
    const { tiles, sprites } = getAtlas()
    const std = (map: THREE.Texture | null, extra: THREE.MeshStandardMaterialParameters = {}) =>
      this.track(new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.08, ...extra }))

    const floorTex = this.track(makeRepeatTexture(tiles.floor, 2, 2.6))
    const wallTex = this.track(makeRepeatTexture(tiles.wall, 8, 1))
    const grooveTex = this.track(makeRepeatTexture(tiles.groove, 6, 1))
    const pusherTop = this.track(makeRepeatTexture(tiles.pusher, 3, 1))
    const pusherSide = this.track(makeRepeatTexture(tiles.pusher, 3, 0.35))

    // 絨布：程式生成菱格車線凹凸 + sheen（天鵝絨光澤）
    const bumpCv = velvetBumpCanvas()
    const velvet = (map: THREE.Texture | null, rx: number, ry: number, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
      this.track(
        new THREE.MeshPhysicalMaterial({
          map,
          roughness: 0.92,
          metalness: 0,
          sheen: 1,
          sheenColor: new THREE.Color('#a060ff'),
          sheenRoughness: 0.45,
          bumpMap: this.track(bumpTexture(bumpCv, rx, ry)),
          bumpScale: 3,
          ...extra,
        }),
      )
    const floorMat = velvet(floorTex, 6, 8.4, { bumpScale: 0.6 })
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

    // 出幣槽：只留一條貼地金屬唇 + 低矮鏤空欄杆（玻璃感），睇得清金幣跌落派彩槽
    const slotLip = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(rampW, 0.06, 0.16)),
      std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.22 }),
    )
    slotLip.position.set(0, -0.62, FLOOR_Z1 + 0.62)
    this.group.add(slotLip)
    const glass = this.track(new THREE.MeshStandardMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.2 }))
    const railBar = new THREE.Mesh(this.track(new THREE.BoxGeometry(rampW, 0.04, 0.05)), std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.22 }))
    railBar.position.set(0, -0.36, FLOOR_Z1 + 0.62)
    this.group.add(railBar)
    const pane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(rampW, 0.26)), glass)
    pane.position.set(0, -0.49, FLOOR_Z1 + 0.62)
    this.group.add(pane)
    const postGeo = this.track(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8))
    const postMat = std(null, { color: '#f2c14e', metalness: 0.85, roughness: 0.22 })
    for (let px = -rampW / 2 + 0.1; px <= rampW / 2; px += 0.9) {
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(px, -0.5, FLOOR_Z1 + 0.62)
      this.group.add(post)
    }

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
    const wallZ0 = FLOOR_Z1 - depth
    const wallPiece = (sx: number, z0: number, z1: number) => {
      const len = z1 - z0
      const tex = this.track(makeRepeatTexture(tiles.wall, (8 * len) / depth, 1))
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, WALL_VIS_H, len)), std(tex))
      wall.position.set(sx * WALL_X, WALL_VIS_H / 2, (z0 + z1) / 2)
      this.group.add(wall)
    }
    wallPiece(-1, wallZ0, FLOOR_Z1)
    // 右側牆開閘門缺口（築塔台推臂將塔推入池）：外觀斷開，閘門由 TowerDock 升降；物理牆保持實心
    wallPiece(1, wallZ0, DOCK_Z - DOCK_GAP_HALF)
    wallPiece(1, DOCK_Z + DOCK_GAP_HALF, FLOOR_Z1)
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
    // 絨布前臉：深紅菱格絨面
    const velvetTex = this.track(makeRepeatTexture(tiles.quilt, 3, 0.45))
    ;(this.pusherMesh.material as THREE.Material[])[4] = velvet(velvetTex, 6, 1, { bumpScale: 0.5 })
    this.group.add(this.pusherMesh)
    // 立體金屬前緣（扁條 + 圓柱滾邊）
    const pw = (WALL_X - 0.2) * 2
    const metal = std(null, { color: '#ffd45e', metalness: 0.85, roughness: 0.22, emissive: '#7a4a00', emissiveIntensity: 0.4 })
    const lip = new THREE.Mesh(this.track(new THREE.BoxGeometry(pw, 0.1, 0.2)), metal)
    lip.position.set(0, DECK_TOP / 2 + 0.01, DECK_HALF_DEPTH - 0.1)
    const roll = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.075, 0.075, pw, 14)), metal)
    roll.rotation.z = Math.PI / 2
    roll.position.set(0, DECK_TOP / 2 + 0.02, DECK_HALF_DEPTH)
    this.pusherMesh.add(lip, roll)
    // 前緣陰影漸變（推板有層次）
    const shadowCv = document.createElement('canvas')
    shadowCv.width = 4
    shadowCv.height = 64
    const sg = shadowCv.getContext('2d') as CanvasRenderingContext2D
    const grad = sg.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, 'rgba(20,0,20,0)')
    grad.addColorStop(1, 'rgba(20,0,20,0.55)')
    sg.fillStyle = grad
    sg.fillRect(0, 0, 4, 64)
    const shadow = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(pw, 0.55)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(new THREE.CanvasTexture(shadowCv)), transparent: true, depthWrite: false })),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, DECK_TOP / 2 + 0.015, DECK_HALF_DEPTH - 0.42)
    this.pusherMesh.add(shadow)

    // 3D 皇家星象齒輪 × 機械光圈魔術門
    this.portal = new GearPortal({
      std,
      track: (o) => this.track(o),
      trimCanvas: tiles.rear,
      yLow: DECK_TOP + 0.09,
    })
    this.group.add(this.portal.group)
    this.updateGate()

    // 魔法陣貼圖共用
    this.magicTex = this.track(makeSpriteTexture(sprites.sp_magic_circle.canvas))
    this.beamTex = this.track(makeSpriteTexture(sprites.sp_drop_beam.canvas))

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
      const sideMat = this.track(new THREE.MeshStandardMaterial({ color: side, metalness: 0.85, roughness: 0.22 }))
      const faceMat = this.track(new THREE.MeshStandardMaterial({ map: face, metalness: 0.6, roughness: 0.3 }))
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
      this.track(new THREE.MeshStandardMaterial({ color: '#f6c640', metalness: 0.85, roughness: 0.22 })),
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
    opts: { vel?: { x: number; y: number; z: number }; spin?: { x: number; y: number; z: number }; towerId?: number; sleeping?: boolean; ccd?: boolean; ghost?: boolean } = {},
  ): Item | null {
    const arr = this.items[kind]
    if (arr.length >= CAPACITY[kind]) return null

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(rot)
      .setCanSleep(true)
      .setLinearDamping(0.45)
      .setAngularDamping(0.9)
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
    // 加重 + 加摩擦：巨塔推入池後唔會一推即散，靠後續推擠逐步傾斜、分批壓塌
    cd.setFriction(kind === 'bar' ? 1.1 : 0.85).setRestitution(0.03).setDensity(kind === 'bar' ? 7 : 5.2)
    if (opts.ccd) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    // 碰撞分組：視覺彈跳幣（bit 2）只同檯面／推板／牆碰撞，唔會撞開真幣；真幣（bit 1）唔理彈跳幣
    cd.setCollisionGroups(opts.ghost ? (GHOST_BIT << 16) | (0xffff & ~COIN_BIT) : (COIN_BIT << 16) | (0xffff & ~GHOST_BIT))
    const collider = this.world.createCollider(cd, body)

    const item: Item = { body, collider, clinked: !opts.ccd, kind, towerId: opts.towerId ?? 0, sync: true, ghostBorn: opts.ghost ? this.time : undefined }
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

  /** 散幣數量（唔計塔幣） */
  private looseBodies() {
    let n = 0
    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) for (const it of this.items[kind]) if (!it.towerId) n++
    return n
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
        this.events.onCompress(1)
        return true
      }
    }
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].towerId) {
        this.removeItem('gold', i)
        this.events.onCompress(1)
        return true
      }
    }
    return false
  }

  /** 開局預鋪：160 幣 + 3 條金磚 + 1 棟 15 層塔（鋪喺下層，推板前面） */
  /** 輸出檯面殘局（唔存視覺幣 / 特殊道具 / 推動中嘅塔） */
  serialize(): SavedTable {
    const r = (n: number) => Math.round(n * 1000) / 1000
    const items: SavedCoin[] = []
    KINDS.forEach((kind, ki) => {
      for (const it of this.items[kind]) {
        if (it.ghostBorn !== undefined) continue
        const p = it.body.translation()
        const q = it.body.rotation()
        if (!Number.isFinite(p.x + p.y + p.z)) continue
        items.push([ki, r(p.x), r(p.y), r(p.z), r(q.x), r(q.y), r(q.z), r(q.w), it.towerId])
      }
    })
    return { v: 1, items }
  }

  /** 還原存檔殘局；資料唔合理就返回 false（改用預鋪） */
  private restore(data: SavedTable): boolean {
    if (!data || data.v !== 1 || !Array.isArray(data.items) || data.items.length < 10 || data.items.length > MAX_BODIES + 50) return false
    const ids = new Map<number, number>()
    for (const c of data.items) {
      if (!Array.isArray(c) || c.length !== 9 || c.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return false
      const [ki, x, y, z, qx, qy, qz, qw, tid] = c
      if (!KINDS[ki] || Math.abs(x) > WALL_X || z < FLOOR_Z0 || z > FLOOR_Z1 || y < -0.5 || y > 5) continue
      let id = 0
      if (tid) {
        if (!ids.has(tid)) ids.set(tid, this.nextTowerId++)
        id = ids.get(tid) as number
      }
      this.createItem(KINDS[ki], { x, y, z }, { x: qx, y: qy, z: qz, w: qw }, { sleeping: true, towerId: id })
    }
    return this.totalBodies() >= 10
  }

  private prefill() {
    if (this.saved && this.restore(this.saved)) return
    const y0 = COIN_H / 2 + 0.002
    const Z_START = -0.9 // 推板最前緣 -0.4，預留少少空位
    const layers: Array<{ cols: number; rows: number; ox: number; oz: number }> = [
      { cols: 9, rows: 7, ox: 0, oz: 0 },
      { cols: 8, rows: 6, ox: 0.29, oz: 0.29 },
      { cols: 9, rows: 7, ox: 0, oz: 0 },
      { cols: 8, rows: 6, ox: 0.29, oz: 0.29 },
    ]
    const bars: Array<[number, number]> = [[-1.7, 1.0], [0.4, 1.9], [1.9, 0.3]]
    const dx = 0.58
    const dz = 0.58
    let placed = 0
    const identity = { x: 0, y: 0, z: 0, w: 1 }
    for (let li = 0; li < layers.length && placed < PREFILL_COINS; li++) {
      const L = layers[li]
      for (let r = 0; r < L.rows && placed < PREFILL_COINS; r++) {
        for (let c = 0; c < L.cols && placed < PREFILL_COINS; c++) {
          const x = -2.3 + L.ox + c * dx + (Math.random() - 0.5) * 0.05
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
  private updateGate() {
    this.portal.update(this.time, this.charge.map((c) => c > this.time), this.gateFlash)
  }

  /** 該射擊線喺 t 秒嘅命中判定：side 線 → 最近嘅能量環洞口；中線 → 光圈張開度 */
  private gateTest(lane: 0 | 1 | 2, t: number): { hit: boolean; perfect: boolean; kind: GateKind; hole: number; aimX: number; aimY: number } {
    const tx = LANES[lane].tx
    if (lane === 1) {
      const open = irisOpen(t)
      return { hit: open >= IRIS_PASS, perfect: open >= 0.98, kind: open >= IRIS_PASS ? 'iris' : null, hole: -1, aimX: 0, aimY: GATE_COIN_Y }
    }
    let best = -1
    let bd = 9
    for (let k = 0; k < 3; k++) {
      const p = holePos(k, t)
      const d = Math.hypot(p.x - tx, p.y - GATE_COIN_Y)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    const hit = bd <= HOLE_TOL
    const p = holePos(best, t)
    return { hit, perfect: bd <= HOLE_PERFECT, kind: hit ? HOLE_KINDS[best] : null, hole: best, aimX: hit ? p.x : tx, aimY: hit ? p.y : GATE_COIN_Y }
  }

  /** 由玩家面前射一隻幣飛向背板缺口，返回射出嘅種類 */
  shoot(lane: -1 | 0 | 1 = 0, delay = 0, opts: { off?: number; mult?: number; leader?: boolean } = {}): CoinKind | null {
    const off = opts.off ?? 0
    if (this.looseBodies() >= LOOSE_CAP && !this.recycle()) return null
    // 平時射出嘅一定係普通幣；金磚改由「連續命中 5 次」獎勵（dropBar）
    const kind: CoinKind = 'gold'
    const mesh = new THREE.Mesh(this.flightGeo[kind], this.flightMat[kind])
    const li = (lane + 1) as 0 | 1 | 2
    if (delay <= 0.2) this.cannons[li].kick = 1
    mesh.position.set(LANES[li].mx + off, MUZZLE_Y, LANES[li].mz)
    mesh.visible = delay <= 0
    mesh.castShadow = this.coinShadows
    this.group.add(mesh)
    // 預測飛到機關嗰刻嘅狀態：洞口 / 光圈夠位就瞄準洞口中心穿過去（自動吸附），否則瞄準定位點撞齒輪
    const g = this.gateTest(li, this.time + delay + FLIGHT_T)
    this.flights.push({
      mesh,
      t: -delay,
      kind,
      lane: li,
      aimX: g.aimX + off,
      aimY: g.aimY,
      leader: opts.leader ?? true,
      off,
      mult: opts.mult ?? 1,
      endZ: g.hit ? GEAR_Z_END : FRONT_FACE_Z + 0.06,
    })
    return kind
  }

  private updateFlights(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]
      const vy = (f.aimY - MUZZLE_Y + 0.5 * FLIGHT_G * FLIGHT_T * FLIGHT_T) / FLIGHT_T
      f.t += dt
      if (f.t < 0) continue // 多發：排隊中，未射出
      f.mesh.visible = true
      const k = Math.min(1, f.t / FLIGHT_T)
      const L = LANES[f.lane]
      f.mesh.position.set(
        L.mx + (f.aimX - L.mx) * k,
        MUZZLE_Y + vy * f.t - 0.5 * FLIGHT_G * f.t * f.t,
        L.mz + (f.endZ - L.mz) * k,
      )
      f.mesh.rotation.set(Math.PI / 2 + f.t * 16, 0, 0) // 翻滾
      if (f.t >= FLIGHT_T) {
        this.group.remove(f.mesh)
        this.flights.splice(i, 1)
        this.resolveFlight(f.lane, f.leader, f.mult, f.off)
      }
    }
  }

  /** 喺缺口後面、推台上方掉落一隻幣（x 為該射擊線嘅推台落點） */
  private dropAt(k: CoinKind, x: number, y: number, vz: number, vy2: number) {
    this._quat.setFromEuler(this._euler.set((Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.9))
    this.createItem(k, { x, y, z: SPAWN_Z }, this._quat, {
      vel: { x: (Math.random() - 0.5) * 0.4, y: vy2, z: vz },
      spin: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
      ccd: true,
    })
  }

  /** 幣到達機關：穿過洞口 / 光圈先掉落；撞中齒輪即 Miss，幣真實彈落推板／金幣池，留存做推幣 */
  private resolveFlight(lane: 0 | 1 | 2, leader: boolean, mult: number, soff: number) {
    const L = LANES[lane]
    const g = this.gateTest(lane, this.time)
    let kind: GateKind = g.kind
    // 共鳴充能：穿過能量環洞口 → 該洞口亮 5 秒；中線光圈喺充能期內張開 → 空間折疊
    if (g.hit && lane !== 1 && leader && g.hole >= 0) {
      this.charge[g.hole] = this.time + 5
      this.portal.flashHole(g.hole)
    }
    const charged = this.charge.some((c) => c > this.time)
    const fold = g.hit && lane === 1 && charged
    if (fold) kind = 'fold'
    if (g.hit) {
      const n = fold ? 3 : L.reward // 空間折疊：1 枚分裂成 3 枚實體金幣
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? (i - (n - 1) / 2) * 0.26 : 0
        // 齊射：各發按橫向偏移分開落點 + 高度錯開，落地前唔會互相擠撞
        this.dropAt('gold', L.tx + off + soff * 2.4, GATE_COIN_Y + i * 0.26 + Math.abs(soff) * 4, 0.6 + Math.random() * 0.8, fold ? 1.2 : -0.3)
      }
      this.gateFlash = 1
      if (fold && leader) this.charge = [0, 0, 0]
    } else {
      // Miss：撞中齒輪，幣變成真實物理幣向後彈開（朝玩家方向 +z）、左右輕微散射，跌返落推台
      const side = L.tx === 0 ? 0 : -Math.sign(L.tx) * 0.5
      this.bounceAt(
        L.tx + soff * 2.4 + (Math.random() - 0.5) * 0.1,
        GATE_COIN_Y + (Math.random() - 0.5) * 0.3 + Math.abs(soff) * 4,
        1.4 + Math.random() * 1.2,
        (Math.random() - 0.5) * 2.6 + side,
        1.6 + Math.random(),
      )
    }
    if (leader) this.events.onGate(g.hit, g.perfect, (lane - 1) as -1 | 0 | 1, mult, kind)
  }

  /** 未命中：硬幣由背板彈開，成為真實物理幣留低，跌返推板表面，隨推板伸縮被推向派彩槽 */
  private bounceAt(x: number, y: number, vz: number, vx: number, vy: number) {
    this._quat.setFromEuler(this._euler.set((Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.2))
    this.createItem('gold', { x, y, z: SPAWN_Z }, this._quat, {
      vel: { x: vx, y: vy, z: vz },
      spin: { x: (Math.random() - 0.5) * 18, y: (Math.random() - 0.5) * 18, z: (Math.random() - 0.5) * 18 },
      ccd: true,
    })
    this.events.onClink()
  }

  /** 連擊獎勵：喺指定射擊線落額外銀幣 */
  dropLaneCoins(lane: -1 | 0 | 1, n: number) {
    const L = LANES[(lane + 1) as 0 | 1 | 2]
    for (let i = 0; i < n; i++) this.dropAt('gold', L.tx + (i - (n - 1) / 2) * 0.3, GATE_COIN_Y + 0.5 + i * 0.3, 0.6 + Math.random() * 0.8, -0.3)
    this.gateFlash = 1
  }

  /** 連續命中 5 次獎勵：正中央掉落 1 塊金磚 */
  dropBar() {
    this.dropAt('bar', 0, GATE_COIN_Y, 0.6 + Math.random() * 0.6, -0.3)
    this.gateFlash = 1
  }

  /** 築塔台小視窗內容（PusherScene 用獨立鏡頭渲染） */
  get dockPip(): THREE.Group {
    return this.dock.pip
  }

  /** 加速側方築塔：units 層（可有小數） */
  feedDock(units: number) {
    this.dock.feed(units)
  }

  /** 特殊道具由上方掉落到推幣池（先亮魔法陣預警）。池內已滿返回 false */
  dropSpecial(kind: SpecialKind): boolean {
    return this.specials.drop(kind)
  }

  /** 三座立體皇家馬戲團炮台（機身前緣）：金屬底座 + 粉紅炮管 + 金環 + 貓耳，開炮有後座力 */
  /** 兩側立體半透明玻璃護欄（頂鑲金邊）+ 金色立柱 + 3D 發光金球跑馬燈 */
  private buildSides() {
    const std = (p: THREE.MeshStandardMaterialParameters) => this.track(new THREE.MeshStandardMaterial(p))
    const gold = std({ color: '#f2c14e', metalness: 0.85, roughness: 0.22, emissive: '#4a2800', emissiveIntensity: 0.2 })
    const glass = this.track(
      new THREE.MeshPhysicalMaterial({
        color: '#cfeaff',
        transparent: true,
        opacity: 0.16,
        roughness: 0.04,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 2.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    const bulbOff = std({ color: '#6a4a10', emissive: '#ffb300', emissiveIntensity: 0.15, metalness: 0.6, roughness: 0.3 })
    const bulbMid = std({ color: '#ffd34d', emissive: '#ffb300', emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.25 })
    const bulbOn = std({ color: '#fff3b0', emissive: '#ffe066', emissiveIntensity: 2.4, metalness: 0.3, roughness: 0.2 })
    this.bulbMats = [bulbOff, bulbMid, bulbOn]
    const bulbGeo = this.track(new THREE.SphereGeometry(0.075, 16, 12))
    const postGeo = this.track(new THREE.CylinderGeometry(0.075, 0.09, 1.2, 16))
    const capGeo = this.track(new THREE.SphereGeometry(0.11, 16, 12))
    const GH = 0.95 // 玻璃高度
    const z0 = FLOOR_Z1 - (FLOOR_Z1 - FLOOR_Z0) + 0.1
    const z1 = FLOOR_Z1 - 0.1
    for (const sx of [-1, 1]) {
      const segs: Array<[number, number]> = sx < 0 ? [[z0, z1]] : [[z0, DOCK_Z - DOCK_GAP_HALF - 0.05], [DOCK_Z + DOCK_GAP_HALF + 0.05, z1]]
      for (const [a, b] of segs) {
        const len = b - a
        const pane = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.04, GH, len)), glass)
        pane.position.set(sx * WALL_X, WALL_VIS_H + GH / 2, (a + b) / 2)
        this.group.add(pane)
        const rail = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.13, 0.09, len, 3, 0.03)), gold)
        rail.position.set(sx * WALL_X, WALL_VIS_H + GH + 0.045, (a + b) / 2)
        this.group.add(rail)
        for (const pz of [a, b]) {
          const post = new THREE.Mesh(postGeo, gold)
          post.position.set(sx * WALL_X, WALL_VIS_H + 0.55, pz)
          const cap = new THREE.Mesh(capGeo, gold)
          cap.position.set(sx * WALL_X, WALL_VIS_H + 1.18, pz)
          this.group.add(post, cap)
        }
        // 跑馬燈泡：沿頂軌一排
        for (let z = a + 0.3; z < b - 0.15; z += 0.5) {
          const bulb = new THREE.Mesh(bulbGeo, bulbOff)
          bulb.position.set(sx * WALL_X, WALL_VIS_H + GH + 0.14, z)
          this.group.add(bulb)
          this.bulbs.push({ mesh: bulb, idx: this.bulbs.length, side: sx })
        }
      }
    }
  }

  private buildCannons() {
    // 高光金屬 + 清漆：香檳金 / 深紅皇家條紋塗裝（有環境反射時更似真金屬）
    const phys = (p: THREE.MeshPhysicalMaterialParameters) => this.track(new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.4, ...p }))
    const gold = phys({ color: '#e9c46a', metalness: 0.85, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15 })
    const champ = phys({ color: '#f3e0a8', metalness: 0.95, roughness: 0.22, clearcoat: 0.5 })
    const red = phys({ color: '#a8102c', metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 })
    const pink = red
    const cream = champ
    const dark = phys({ color: '#14060c', metalness: 0.4, roughness: 0.45 })
    const baseGeo = this.track(new THREE.CylinderGeometry(0.4, 0.5, 0.34, 32))
    const stripeGeo = this.track(new THREE.CylinderGeometry(0.43, 0.53, 0.1, 32))
    const domeGeo = this.track(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2))
    const barrelGeo = this.track(new THREE.CylinderGeometry(0.17, 0.21, CANNON_LEN, 28))
    const ringGeo = this.track(new THREE.TorusGeometry(0.19, 0.04, 12, 28))
    const collarGeo = this.track(new THREE.TorusGeometry(0.17, 0.06, 12, 28))
    const muzzleGeo = this.track(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20))
    const earGeo = this.track(new THREE.ConeGeometry(0.1, 0.2, 3))
    for (const L of LANES) {
      const g = new THREE.Group()
      g.position.set(L.px, 0, L.pz)
      g.scale.setScalar(CANNON_S)
      const base = new THREE.Mesh(baseGeo, cream)
      base.position.y = 0.17
      const stripe = new THREE.Mesh(stripeGeo, red)
      stripe.position.y = 0.2
      const dome = new THREE.Mesh(domeGeo, gold)
      dome.position.y = 0.34
      const stripe2 = new THREE.Mesh(stripeGeo, gold)
      stripe2.position.y = 0.06
      stripe2.scale.set(1.02, 0.55, 1.02)
      g.add(base, stripe, stripe2, dome)
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(earGeo, pink)
        ear.position.set(sx * 0.3, 0.52, 0.02)
        ear.rotation.z = -sx * 0.3
        g.add(ear)
      }
      // 炮管樞軸（Y→X 次序：先轉向、再仰起）
      const pivot = new THREE.Group()
      pivot.position.set(0, CANNON_PIVOT_Y - 0.0, 0)
      pivot.rotation.order = 'YXZ'
      pivot.rotation.set(CANNON_PITCH, -L.yaw, 0)
      const barrel = new THREE.Group()
      const tube = new THREE.Mesh(barrelGeo, pink)
      tube.rotation.x = Math.PI / 2
      tube.position.z = -CANNON_LEN / 2
      barrel.add(tube)
      for (const t of [0.12, 0.3, 0.55, 0.78]) {
        const ring = new THREE.Mesh(ringGeo, t === 0.3 || t === 0.78 ? champ : gold)
        ring.position.z = -CANNON_LEN * t
        barrel.add(ring)
      }
      const collar = new THREE.Mesh(collarGeo, gold)
      collar.position.z = -CANNON_LEN
      barrel.add(collar)
      const mouth = new THREE.Mesh(muzzleGeo, dark)
      mouth.rotation.x = Math.PI / 2
      mouth.position.z = -CANNON_LEN - 0.005
      barrel.add(mouth)
      pivot.add(barrel)
      g.add(pivot)
      this.group.add(g)
      this.cannons.push({ barrel, kick: 0 })
    }
  }

  private buildDock() {
    this.dock = new TowerDock({
      group: this.group,
      world: this.world,
      std: (map, extra = {}) => this.track(new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.08, ...extra })),
      track: (o) => this.track(o),
      wallCanvas: getAtlas().tiles.wall,
      coinGeo: this.flightGeo.gold,
      coinMat: this.flightMat.gold,
      wallX: WALL_X,
      events: {
        onLayer: (i) => this.events.onStack(i),
        onPush: () => this.events.onDockPush(),
        onLand: () => {
          this.magicCircle(1.5, DOCK_Z, 3.4)
          this.events.onTowerSpawn()
        },
        onChange: (layers, phase) => this.events.onDockChange(layers, phase),
      },
      surfaceY: (x, z) => this.surfaceY(x, z),
      spawnTower: (x, z, baseY, coins) => this.spawnDockTower(x, z, baseY, coins),
    })
  }

  /** 推入池嘅 DNA 螺旋塔落地：100 枚變成真實物理幣（靠重量同摩擦逐步傾斜、倒塌成金幣海嘯） */
  private spawnDockTower(cx: number, cz: number, baseY: number, coins: Array<{ dx: number; dz: number; level: number; yaw: number }>) {
    while (this.totalBodies() + coins.length > MAX_BODIES && this.recycle()) { /* 騰位：壓縮舊幣轉積分 */ }
    const id = this.nextTowerId++
    for (const c of coins) {
      this._quat.setFromEuler(this._euler.set(0, c.yaw, 0))
      this.createItem('gold', { x: cx + c.dx, y: baseY + COIN_H / 2 + 0.01 + c.level * STACK_STEP, z: cz + c.dz }, this._quat, { towerId: id })
    }
  }

  private buildSpecials() {
    this.specials = new SpecialItems({
      group: this.group,
      world: this.world,
      track: (o) => this.track(o),
      bounds: { killY: KILL_Y, frontZ: FLOOR_Z1, payHalf: PAY_HALF, wallX: WALL_X, backZ: FLOOR_Z0 },
      onTelegraph: (x, z) => {
        this.magicCircle(x, z, 1.6)
        this.dropBeam(x, z)
      },
      onSpawn: (kind) => this.events.onSpecialDrop(kind),
      onPaid: (kind) => {
        this.payFlash = 1
        this.events.onSpecial(kind)
      },
      onLost: (kind) => this.events.onSpecialLost(kind),
    })
  }

  /** 特殊道具掉落預警光柱（sp_drop_beam，豎立 billboard，淡入再淡出） */
  private dropBeam(x: number, z: number) {
    const baseY = this.surfaceY(x, z)
    const mat = new THREE.MeshBasicMaterial({ map: this.beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.74), mat)
    mesh.position.set(x, baseY + 0.9, z)
    this.group.add(mesh)
    this.effects.push({
      mesh,
      t: 0,
      life: 1.5,
      tick: (e, k) => {
        ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * 4) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1)
        e.mesh.scale.set(1, 0.6 + 0.4 * Math.min(1, k * 3), 1)
      },
    })
  }

  /** Boss 勝利落幣雨：由上方逐枚落 gold 15 + platinum 3（打亂次序） */
  coinRain(gold = 15, platinum = 3) {
    const list: CoinKind[] = [...Array(gold).fill('gold'), ...Array(platinum).fill('platinum')]
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    list.forEach((kind, i) => this.rain.push({ t: 0.1 + i * 0.12, kind }))
  }

  private updateRain(dt: number) {
    for (let i = this.rain.length - 1; i >= 0; i--) {
      const r = this.rain[i]
      r.t -= dt
      if (r.t > 0) continue
      this.rain.splice(i, 1)
      if (this.looseBodies() >= LOOSE_CAP && !this.recycle()) continue
      this._quat.setFromEuler(this._euler.set(Math.random() * 3, Math.random() * 6, Math.random() * 3))
      this.createItem(r.kind, { x: (Math.random() * 2 - 1) * 2.1, y: 3.4 + Math.random() * 0.6, z: -0.1 + Math.random() * 2.4 }, this._quat, {
        vel: { x: 0, y: -2, z: 0 },
        spin: { x: Math.random() * 8, y: Math.random() * 8, z: Math.random() * 8 },
      })
    }
  }

  /** 魔法陣特效（落點預警 / 塔落地） */
  private magicCircle(x: number, z: number, size: number) {
    const baseY = this.surfaceY(x, z)
    const mat = new THREE.MeshBasicMaterial({
      map: this.magicTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, baseY + 0.04, z)
    this.group.add(mesh)
    this.effects.push({
      mesh,
      t: 0,
      life: 1.4,
      tick: (e, k) => {
        const rise = Math.min(1, k * 5)
        const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1
        ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = rise * fade
        e.mesh.scale.setScalar(0.4 + 0.6 * Math.min(1, k * 4))
        e.mesh.rotation.z += 0.04
      },
    })
  }

  /** 場上（含預約掉落）特殊道具數量 */
  get specialCount(): number {
    return this.specials.count
  }

  /** 畫質：金幣（散幣 / 金磚 / 飛行中）投影開關 */
  setCoinShadows(on: boolean) {
    this.coinShadows = on
    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) this.meshes[kind].castShadow = on
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

  update(rawDt: number) {
    const dt = rawDt * this.timeScale
    this.time += dt
    this.acc += Math.min(dt, 0.05)
    let steps = 0
    while (this.acc >= FIXED_STEP && steps < 3) {
      this.simTime += FIXED_STEP
      this.placePusher(this.simTime)
      this.dock.step(FIXED_STEP)
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

    this.updateRain(dt)
    if (this.looseBodies() > LOOSE_CAP + 12) this.recycle() // 散幣超上限：逐枚壓縮最底層舊幣（每幀一枚，唔卡）
    {
      // 跑馬燈：每 4 粒一組依序追逐（左右對稱）
      const step = Math.floor(this.time * 9)
      for (const b of this.bulbs) {
        const d = (((b.idx - step) % 4) + 4) % 4
        b.mesh.material = this.bulbMats[d === 0 ? 2 : d === 1 ? 1 : 0]
      }
    }
    this.syncMeshes()
    this.dock.syncVisuals()
    this.specials.update(dt)

    // 雙層擋板 + 飛行中嘅幣
    this.updateFlights(dt)
    for (const c of this.cannons) {
      c.kick = Math.max(0, c.kick - dt * 5)
      c.barrel.position.z = c.kick * c.kick * 0.3 // 開炮後座力（炮管縮後再彈返）
    }
    this.gateFlash = Math.max(0, this.gateFlash - dt * 3)
    this.updateGate()

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

  /** 測試用：視覺彈跳幣 / 全部金幣數量 */
  debugCounts() {
    const g = this.items.gold
    return { ghosts: g.filter((i) => i.ghostBorn !== undefined).length, gold: g.length }
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
        let scale = 1
        if (it.ghostBorn !== undefined) {
          // 視覺彈跳幣：到時移除；最後一段閃爍（縮放 0/1 切換）
          const age = this.time - it.ghostBorn
          if (age >= GHOST_LIFE) {
            ;(fallen ??= []).push({ idx: i, legit: false, gutter: false })
            continue
          }
          if (age >= GHOST_BLINK_FROM && Math.floor(age * 18) % 2 === 0) scale = 0
          it.sync = true
        } else if (sleeping && !it.sync) continue
        if (it.ghostBorn === undefined) it.sync = !sleeping // 入睡嗰一幀仍會同步一次
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
          const real = it.ghostBorn === undefined // 視覺彈跳幣唔派彩
          ;(fallen ??= []).push({ idx: i, legit: real && front && Math.abs(p.x) <= PAY_HALF, gutter: real && front && Math.abs(p.x) > PAY_HALF })
          continue
        }
        const q = it.body.rotation()
        this._pos.set(p.x, p.y, p.z)
        this._quat.set(q.x, q.y, q.z, q.w)
        this._m.compose(this._pos, this._quat, scale === 1 ? this._one : this._zero)
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
    this.specials.dispose()
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
