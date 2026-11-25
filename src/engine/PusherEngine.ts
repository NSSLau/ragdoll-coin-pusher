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

const FIXED_STEP = 1 / 60
const MAX_BODIES = 400
const PREFILL_COINS = 160
const PREFILL_TOWER_LAYERS = 15
export const TOWER_EVERY = 25
export const TOWER_LAYERS = 18
const TOWER_TOPPLE_COUNT = 12 // 同一棟塔跌出 12 隻幣 → JP3

const CAPACITY: Record<CoinKind, number> = { gold: 540, platinum: 80, bar: 50 }

export interface EngineEvents {
  onCollect(kind: CoinKind, value: number): void
  onJackpot(tier: 1 | 2 | 3): void
  onTowerSpawn(): void
}

interface Item {
  body: RAPIER.RigidBody
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
  private cannon!: THREE.Mesh
  private meshes = {} as Record<CoinKind, THREE.InstancedMesh>
  private items: Record<CoinKind, Item[]> = { gold: [], platinum: [], bar: [] }
  private effects: Effect[] = []
  private towerJobs: TowerJob[] = []
  private towerFall = new Map<number, number>()
  private towerPaid = new Set<number>()
  private nextTowerId = 1

  private acc = 0
  private simTime = 0
  private time = 0
  private recoil = 0

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

    this.buildTable()
    this.buildCoinMeshes()
    this.buildCannon()
    this.prefill()
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
    const floor = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(WALL_X * 2 + 0.3, 1.2, depth)),
      [darkMat, darkMat, floorMat, darkMat, grooveMat, darkMat],
    )
    floor.position.set(0, -0.6, zc)
    this.group.add(floor)

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
    this.pusherMesh = new THREE.Mesh(this.track(new THREE.BoxGeometry((WALL_X - 0.2) * 2, 0.7, 2.2)), [
      sideMat,
      sideMat,
      topMat,
      darkMat,
      sideMat,
      sideMat,
    ])
    this.group.add(this.pusherMesh)

    // 上方導軌（貓耳炮掛喺度）
    const rail = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(WALL_X * 2 + 0.3, 0.1, 0.1)),
      std(null, { color: '#f2c14e', metalness: 0.7, roughness: 0.3 }),
    )
    rail.position.set(0, 3.3, -2.0)
    this.group.add(rail)

    // 魔法陣貼圖共用
    this.magicTex = this.track(makeSpriteTexture(sprites.magic_circle.canvas))

    // 物理：檯面、牆、推板
    const W = this.world
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.6) => {
      const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z))
      W.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction), body)
    }
    fixed(WALL_X + 0.15, 0.6, depth / 2, 0, -0.6, zc)
    // 牆嘅碰撞體比外觀高（1.6），幣被推板擠高都唔會飛出檯面
    fixed(0.15, 0.8, depth / 2, -WALL_X, 0.8, zc)
    fixed(0.15, 0.8, depth / 2, WALL_X, 0.8, zc)
    fixed(WALL_X + 0.15, 1.2, 0.15, 0, 1.2, FLOOR_Z0 - 0.15)

    this.pusher = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.35, -3.4))
    W.createCollider(RAPIER.ColliderDesc.cuboid(WALL_X - 0.2, 0.35, 1.1).setFriction(0.25), this.pusher)
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

    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) {
      const m = this.meshes[kind]
      m.count = 0
      m.frustumCulled = false
      for (let i = 0; i < CAPACITY[kind]; i++) m.setColorAt(i, this._white)
      this.group.add(m)
      this.track(m)
    }
  }

  private buildCannon() {
    const { cat_cannon } = getAtlas().sprites
    const tex = this.track(makeSpriteTexture(cat_cannon.canvas))
    const w = 1.5
    this.cannon = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(w, (w * cat_cannon.height) / cat_cannon.width)),
      this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02 })),
    )
    this.cannon.rotation.x = -0.5
    this.cannon.position.set(0, 2.55, -1.7)
    this.group.add(this.cannon)
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
    this.world.createCollider(cd.setFriction(0.5).setRestitution(0.05).setDensity(kind === 'bar' ? 2.5 : 1), body)

    const item: Item = { body, kind, towerId: opts.towerId ?? 0, sync: true }
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

  /** 開局預鋪：160 幣 + 3 條金磚 + 1 棟 15 層塔 */
  private prefill() {
    const y0 = COIN_H / 2 + 0.002
    const layers: Array<{ cols: number; rows: number; ox: number; oz: number }> = [
      { cols: 8, rows: 8, ox: 0, oz: 0 },
      { cols: 7, rows: 7, ox: 0.34, oz: 0.343 },
      { cols: 8, rows: 8, ox: 0, oz: 0 },
    ]
    const dx = 0.68
    const dz = 0.686
    let placed = 0
    const identity = { x: 0, y: 0, z: 0, w: 1 }
    for (let li = 0; li < layers.length && placed < PREFILL_COINS; li++) {
      const L = layers[li]
      for (let r = 0; r < L.rows && placed < PREFILL_COINS; r++) {
        for (let c = 0; c < L.cols && placed < PREFILL_COINS; c++) {
          const x = -2.38 + L.ox + c * dx + (Math.random() - 0.5) * 0.05
          const z = -1.9 + L.oz + r * dz + (Math.random() - 0.5) * 0.05
          const y = y0 + li * STACK_STEP
          this._quat.setFromEuler(this._euler.set(0, Math.random() * Math.PI * 2, 0))
          const kind: CoinKind = Math.random() < 0.06 ? 'platinum' : 'gold'
          this.createItem(kind, { x, y, z }, this._quat, { sleeping: true })
          placed++
        }
      }
    }
    // 3 條金磚擺喺頂層
    const topY = y0 + 2 * STACK_STEP + COIN_H / 2
    for (const [x, z] of [[-1.7, 0.4], [0.4, 1.7], [1.9, -0.6]] as const) {
      this.createItem('bar', { x, y: topY + 0.14, z }, identity, { sleeping: true })
    }
    // 1 棟 15 層塔
    this.buildTowerInstant(1.1, 0.7, PREFILL_TOWER_LAYERS)
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
  /** 貓耳炮目前 X 位置（左右擺動） */
  get cannonX(): number {
    return Math.sin(this.time * 1.25) * 2.0
  }

  /** 射一隻幣，返回射出嘅種類 */
  shoot(): CoinKind | null {
    if (this.totalBodies() >= MAX_BODIES && !this.recycle()) return null
    const r = Math.random()
    let kind: CoinKind = r < 0.012 ? 'bar' : r < 0.05 ? 'platinum' : 'gold'
    if (this.items[kind].length >= CAPACITY[kind]) kind = 'gold'
    const x = this.cannonX
    this._quat.setFromEuler(
      this._euler.set((Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.9),
    )
    const item = this.createItem(
      kind,
      { x: x - 0.25, y: 2.3, z: -1.5 },
      this._quat,
      {
        vel: { x: (Math.random() - 0.5) * 0.7, y: -1.0, z: 4.6 + Math.random() * 0.9 },
        spin: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
        ccd: true,
      },
    )
    if (!item) return null
    this.recoil = 1
    return kind
  }

  /** 每 25 幣：魔法陣 + 逐層疊出 18 層高塔 */
  spawnTower() {
    const margin = 0.55
    const x = (Math.random() * 2 - 1) * (WALL_X - 0.15 - COIN_R - margin)
    const z = -0.2 + Math.random() * 1.8
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
    const zFront = -2.3 + 0.75 * Math.sin(t * 1.7)
    const zc = zFront - 1.1
    this.pusher.setNextKinematicTranslation({ x: 0, y: 0.35, z: zc })
    return zc
  }

  update(dt: number) {
    this.time += dt
    this.acc += Math.min(dt, 0.05)
    let steps = 0
    while (this.acc >= FIXED_STEP && steps < 3) {
      this.simTime += FIXED_STEP
      this.placePusher(this.simTime)
      this.world.step()
      this.acc -= FIXED_STEP
      steps++
    }

    // 推板 mesh
    const pt = this.pusher.translation()
    this.pusherMesh.position.set(pt.x, pt.y, pt.z)

    this.processTowerJobs(dt)
    this.syncMeshes()

    // 貓耳炮
    this.cannon.position.x = this.cannonX
    this.recoil = Math.max(0, this.recoil - dt * 8)
    this.cannon.position.y = 2.55 + this.recoil * 0.1
    this.cannon.scale.setScalar(1 + this.recoil * 0.08)

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
        job.next++
        job.timer += 0.035
      }
      if (job.next >= job.layers) this.towerJobs.splice(j, 1)
    }
  }

  private syncMeshes() {
    for (const kind of ['gold', 'platinum', 'bar'] as CoinKind[]) {
      const arr = this.items[kind]
      const mesh = this.meshes[kind]
      let dirty = false
      let fallen: Array<{ idx: number; legit: boolean }> | null = null

      for (let i = 0; i < arr.length; i++) {
        const it = arr[i]
        const sleeping = it.body.isSleeping()
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
          ;(fallen ??= []).push({ idx: i, legit: false })
          continue
        }
        if (p.y < KILL_Y) {
          // 只有喺前緣跌入吞幣溝先算贏分（防止幣由側面／後面跌出去都派彩）
          ;(fallen ??= []).push({ idx: i, legit: p.z > FLOOR_Z1 - 0.35 && Math.abs(p.x) < WALL_X })
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
          const { idx, legit } = fallen[k]
          if (legit) this.collect(arr[idx])
          this.removeItem(kind, idx)
        }
        dirty = true
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true
    }
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
    for (const e of this.effects) {
      this.group.remove(e.mesh)
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
    }
    this.effects.length = 0
    this.group.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.world.free()
  }
}
