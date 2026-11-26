import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

/* ------------------------------------------------------------------ */
/*  特殊道具：由上方掉落、混入金幣池，被推落前方派彩槽先觸發額外獎勵            */
/*  暫用程式幾何體佔位（之後可換成正式貼圖 / 模型）                             */
/*  - gacha 神秘扭蛋球：隨機獎勵（抽獎券 / 積分 / 運氣值）                       */
/*  - gem   皇家寶石：大量積分 + 金幣                                         */
/*  - bell  貓咪鈴鐺：運氣值暴漲 + 加速側方築塔                                 */
/* ------------------------------------------------------------------ */

export type SpecialKind = 'gacha' | 'gem' | 'bell'
export const SPECIAL_MAX = 5 // 池內同時存在上限
const DROP_DELAY = 0.6 // 預警魔法陣亮起後幾耐落
const DROP_Y = 3.4

export const SPECIAL_NAME: Record<SpecialKind, string> = {
  gacha: '神秘扭蛋球',
  gem: '皇家寶石',
  bell: '貓咪鈴鐺',
}

interface Bounds {
  killY: number
  frontZ: number
  payHalf: number
  wallX: number
  backZ: number
}

interface Ctx {
  group: THREE.Group
  world: RAPIER.World
  track: <T extends { dispose(): void }>(o: T) => T
  bounds: Bounds
  /** 落點預警（魔法陣） */
  onTelegraph(x: number, z: number): void
  /** 道具真正生成（掉落一刻） */
  onSpawn(kind: SpecialKind): void
  /** 推落派彩槽 */
  onPaid(kind: SpecialKind): void
  /** 跌入邊溝／出界：冇獎勵 */
  onLost(kind: SpecialKind): void
}

interface Special {
  kind: SpecialKind
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  obj: THREE.Object3D
}

interface Pending {
  t: number
  kind: SpecialKind
  x: number
  z: number
}

export class SpecialItems {
  private ctx: Ctx
  private items: Special[] = []
  private pending: Pending[] = []
  private models: Record<SpecialKind, () => THREE.Object3D>

  constructor(ctx: Ctx) {
    this.ctx = ctx
    const { track } = ctx
    const mat = (p: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(p))

    // 神秘扭蛋球：粉紅上殼 + 青藍下殼 + 金腰帶
    const topGeo = track(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2))
    const botGeo = track(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2))
    const bandGeo = track(new THREE.CylinderGeometry(0.348, 0.348, 0.06, 24))
    const topMat = mat({ color: '#ff7ac8', roughness: 0.25, metalness: 0.15, side: THREE.DoubleSide, emissive: '#5a1038', emissiveIntensity: 0.3 })
    const botMat = mat({ color: '#5ee7ff', roughness: 0.25, metalness: 0.15, side: THREE.DoubleSide, emissive: '#0a4a5a', emissiveIntensity: 0.3 })
    const goldMat = mat({ color: '#f2c14e', roughness: 0.28, metalness: 0.85, emissive: '#7a4a00', emissiveIntensity: 0.5 })
    const starGeo = track(new THREE.OctahedronGeometry(0.1, 0))

    // 皇家寶石：拉長八面體
    const gemPts = [
      [0.34, 0, 0], [-0.34, 0, 0], [0, 0.46, 0], [0, -0.46, 0], [0, 0, 0.34], [0, 0, -0.34],
    ].flat()
    const gemGeo = track(new THREE.OctahedronGeometry(0.34, 0).scale(1, 1.35, 1))
    const gemMat = mat({ color: '#c58cff', roughness: 0.12, metalness: 0.3, flatShading: true, emissive: '#7a2cff', emissiveIntensity: 0.7 })
    this.gemHull = new Float32Array(gemPts)

    // 貓咪鈴鐺：金球 + 頂環 + 底縫
    const bellGeo = track(new THREE.SphereGeometry(0.28, 20, 14))
    const loopGeo = track(new THREE.TorusGeometry(0.075, 0.022, 8, 16))
    const slitGeo = track(new THREE.BoxGeometry(0.24, 0.03, 0.02))
    const slitMat = mat({ color: '#3a1a00', roughness: 0.8 })
    const bellMat = mat({ color: '#ffd34d', roughness: 0.2, metalness: 0.9, emissive: '#8a5200', emissiveIntensity: 0.55 })

    this.models = {
      gacha: () => {
        const g = new THREE.Group()
        g.add(new THREE.Mesh(topGeo, topMat), new THREE.Mesh(botGeo, botMat), new THREE.Mesh(bandGeo, goldMat))
        const star = new THREE.Mesh(starGeo, goldMat)
        star.position.set(0, 0.3, 0.14)
        g.add(star)
        return g
      },
      gem: () => new THREE.Mesh(gemGeo, gemMat),
      bell: () => {
        const g = new THREE.Group()
        g.add(new THREE.Mesh(bellGeo, bellMat))
        const loop = new THREE.Mesh(loopGeo, bellMat)
        loop.position.y = 0.3
        const slit = new THREE.Mesh(slitGeo, slitMat)
        slit.position.set(0, -0.12, 0.27)
        slit.rotation.x = 0.35
        g.add(loop, slit)
        return g
      },
    }
  }

  private gemHull: Float32Array

  get count() {
    return this.items.length + this.pending.length
  }

  /** 預約掉落：先亮魔法陣，DROP_DELAY 秒後由上方落下。池滿返回 false */
  drop(kind: SpecialKind, x?: number, z?: number): boolean {
    if (this.count >= SPECIAL_MAX) return false
    const px = x ?? (Math.random() * 2 - 1) * 1.4
    const pz = z ?? 0.1 + Math.random() * 1.1
    this.pending.push({ t: DROP_DELAY, kind, x: px, z: pz })
    this.ctx.onTelegraph(px, pz)
    return true
  }

  private spawn(p: Pending) {
    const { world, group } = this.ctx
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, DROP_Y, p.z)
      .setLinvel((Math.random() - 0.5) * 0.4, -1.5, (Math.random() - 0.5) * 0.4)
      .setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 })
      .setLinearDamping(0.3)
      .setAngularDamping(0.8)
      .setCcdEnabled(true)
    const body = world.createRigidBody(desc)
    let cd: RAPIER.ColliderDesc | null = null
    if (p.kind === 'gem') cd = RAPIER.ColliderDesc.convexHull(this.gemHull)
    cd ??= RAPIER.ColliderDesc.ball(p.kind === 'bell' ? 0.3 : 0.34)
    cd.setFriction(0.5).setRestitution(0.12).setDensity(1.4)
    const collider = world.createCollider(cd, body)
    const obj = this.models[p.kind]()
    group.add(obj)
    this.items.push({ kind: p.kind, body, collider, obj })
    this.ctx.onSpawn(p.kind)
  }

  private remove(i: number) {
    const it = this.items[i]
    this.ctx.group.remove(it.obj)
    this.ctx.world.removeRigidBody(it.body)
    this.items.splice(i, 1)
  }

  update(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt
      if (this.pending[i].t <= 0) {
        this.spawn(this.pending[i])
        this.pending.splice(i, 1)
      }
    }
    const b = this.ctx.bounds
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      const p = it.body.translation()
      const bad =
        !Number.isFinite(p.x + p.y + p.z) || Math.abs(p.x) > b.wallX + 0.6 || p.z < b.backZ - 0.6 || p.y > 7
      if (bad) {
        this.remove(i)
        this.ctx.onLost(it.kind)
        continue
      }
      if (p.y < b.killY) {
        const front = p.z > b.frontZ - 0.35 && Math.abs(p.x) < b.wallX
        const kind = it.kind
        this.remove(i)
        if (front && Math.abs(p.x) <= b.payHalf) this.ctx.onPaid(kind)
        else this.ctx.onLost(kind)
        continue
      }
      const q = it.body.rotation()
      it.obj.position.set(p.x, p.y, p.z)
      it.obj.quaternion.set(q.x, q.y, q.z, q.w)
    }
  }

  dispose() {
    for (const it of this.items) this.ctx.group.remove(it.obj)
    this.items.length = 0
    this.pending.length = 0
  }
}
