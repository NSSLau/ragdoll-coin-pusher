import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { getSprite, type SpriteKey } from '../utils/SpriteAtlas'

/* ------------------------------------------------------------------ */
/*  檯面實體彩珠（帶貼圖 + 光暈嘅 3D 厚圓盤），由上方掉落、混入金幣池，             */
/*  被推落 65% 黃金正門先觸發效果：                                           */
/*  - fire / water / lightning：元素珠 → 對上方魔物施放元素魔法（有克制）         */
/*  - dragon：七星龍珠 → 機背燈陣 +1 盞；集滿 7 盞 SUPER FEVER                 */
/*  - mystery：彩虹神秘彩球 → 即開「彩虹命運轉盤」或「皇家猜大細」                */
/* ------------------------------------------------------------------ */

export type SpecialKind = 'fire' | 'water' | 'lightning' | 'mystery' | 'dragon'
export const ELEMENT_KINDS = ['fire', 'water', 'lightning'] as const
export const SPECIAL_MAX = 3 // 檯面同時最多 3 粒彩珠（含預警中）
const DROP_DELAY = 0.6 // 預警魔法陣亮起後幾耐落
const DROP_Y = 3.4
const ORB_R = 0.48
const ORB_H = 0.24

export const SPECIAL_NAME: Record<SpecialKind, string> = {
  fire: '火元素珠',
  water: '水元素珠',
  lightning: '雷元素珠',
  mystery: '彩虹神秘彩球',
  dragon: '七星龍珠',
}
export const SPECIAL_SPRITE: Record<SpecialKind, SpriteKey> = {
  fire: 'orb_fire',
  water: 'orb_water',
  lightning: 'orb_lightning',
  mystery: 'orb_mystery',
  dragon: 'trophy_dragon_medal',
}
export const SPECIAL_GLOW: Record<SpecialKind, string> = {
  fire: '#ff7a3d',
  water: '#4dc3ff',
  lightning: '#ffe14d',
  mystery: '#e0a8ff',
  dragon: '#ffb02e',
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
    const geo = track(new THREE.CylinderGeometry(ORB_R, ORB_R, ORB_H, 40, 1))
    const sideMat = track(new THREE.MeshStandardMaterial({ color: '#e8b84a', roughness: 0.25, metalness: 0.9, emissive: '#6a4200', emissiveIntensity: 0.4 }))
    // 光暈：徑向漸變（加色混合），每款彩珠一色
    const halo = (c: string) => {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 64
      const g = cv.getContext('2d') as CanvasRenderingContext2D
      const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32)
      gr.addColorStop(0, c)
      gr.addColorStop(0.45, c + '88')
      gr.addColorStop(1, c + '00')
      g.fillStyle = gr
      g.fillRect(0, 0, 64, 64)
      return track(new THREE.CanvasTexture(cv))
    }
    const models = {} as Record<SpecialKind, () => THREE.Object3D>
    for (const k of Object.keys(SPECIAL_SPRITE) as SpecialKind[]) {
      const tex = track(new THREE.CanvasTexture(getSprite(SPECIAL_SPRITE[k]).canvas))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      const capMat = track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.3, metalness: 0.15, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55 }))
      const haloMat = track(new THREE.SpriteMaterial({ map: halo(SPECIAL_GLOW[k]), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85 }))
      models[k] = () => {
        const g = new THREE.Group()
        g.add(new THREE.Mesh(geo, [sideMat, capMat, capMat]))
        const hs = new THREE.Sprite(haloMat)
        hs.scale.setScalar(2.4)
        hs.userData.halo = true
        g.add(hs)
        return g
      }
    }
    this.models = models
  }

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
      .setAngularDamping(1.6)
      .setCcdEnabled(true)
    const body = world.createRigidBody(desc)
    const cd = RAPIER.ColliderDesc.cylinder(ORB_H / 2, ORB_R).setFriction(0.6).setRestitution(0.1).setDensity(1.6)
    const collider = world.createCollider(cd, body)
    const obj = this.models[p.kind]()
    obj.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
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

  /** 光暈脈衝（引擎時間） */
  private t = 0

  update(dt: number) {
    this.t += dt
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
      // 光暈唔跟住盤面旋轉：永遠面向鏡頭（Sprite），按時間脈衝
      const h = it.obj.children.find((c) => c.userData.halo)
      if (h) h.scale.setScalar(2.3 + 0.3 * Math.sin(this.t * 4 + p.x * 3))
    }
  }

  dispose() {
    for (const it of this.items) this.ctx.group.remove(it.obj)
    this.items.length = 0
    this.pending.length = 0
  }
}
