import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'

/* ------------------------------------------------------------------ */
/*  布偶貓小窩：3DS《寶可夢友友樂》風賽璐珞卡通描邊 3D                        */
/*  - MeshToonMaterial + 3 階色階 gradientMap（硬邊明暗）                     */
/*  - drei <Outlines>（Inverted Hull 反向外殼）做手繪感深啡外輪廓              */
/*  - 臉部用 canvas 動態貼圖：動漫大眼（自然眨眼）、ω 貓嘴、腮紅；撫摸時變月牙笑眼  */
/*  - 海雙布偶貓（Seal Bicolour）：深啡面罩 + 白色倒 V、蓬鬆頸毛、大尾巴、粉紅肉球  */
/* ------------------------------------------------------------------ */

const CREAM = '#fbf3e6'
const SEAL = '#5c3d2e'
const SEAL_DARK = '#3d2619'
const PINK = '#ff9db5'
const LINE = '#2e1a12'

/** 3 階色階：暗位 / 中間 / 受光（Nearest 取樣 → 卡通硬邊） */
function useGradient() {
  return useMemo(() => {
    const data = new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255])
    const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
    t.minFilter = t.magFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }, [])
}

/**
 * 反向外殼描邊（Inverted Hull）：複製父 mesh 嘅幾何，沿法線向外推 thickness，
 * 只畫背面 → 喺物件外圍形成一圈手繪感深色輪廓。
 */
const hullMats = new Map<number, THREE.MeshBasicMaterial>()
function hullMaterial(t: number) {
  let m = hullMats.get(t)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: LINE, side: THREE.BackSide })
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normalize(normal) * ${t.toFixed(4)};`)
    }
    m.customProgramCacheKey = () => `hull-${t}`
    hullMats.set(t, m)
  }
  return m
}
function Outlines({ thickness = 0.03 }: { thickness?: number; color?: string }) {
  const ref = useRef<THREE.Mesh>(null)
  useLayoutEffect(() => {
    const me = ref.current
    const parent = me?.parent as THREE.Mesh | undefined
    if (!me || !parent?.geometry) return
    me.geometry = parent.geometry
  })
  return <mesh ref={ref} material={hullMaterial(thickness)} raycast={() => null} />
}

type FaceState = 'open' | 'blink' | 'happy'

/** 臉部貼圖（貼喺頭部前半球嘅弧形面片上；u = 左→右，v = 上→下） */
function drawFace(state: FaceState): HTMLCanvasElement {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.clearRect(0, 0, S, S)
  // 深啡面罩：眼周同額頭
  g.fillStyle = SEAL
  g.beginPath()
  g.ellipse(S * 0.5, S * 0.36, S * 0.5, S * 0.3, 0, 0, Math.PI * 2)
  g.fill()
  // 白色倒 V（布偶貓雙色特徵）+ 白口鼻腮
  g.fillStyle = CREAM
  g.beginPath()
  g.moveTo(S * 0.5, S * 0.12)
  g.quadraticCurveTo(S * 0.42, S * 0.45, S * 0.27, S * 0.62)
  g.lineTo(S * 0.73, S * 0.62)
  g.quadraticCurveTo(S * 0.58, S * 0.45, S * 0.5, S * 0.12)
  g.fill()
  g.beginPath()
  g.ellipse(S * 0.5, S * 0.68, S * 0.3, S * 0.18, 0, 0, Math.PI * 2)
  g.fill()
  // 腮紅
  g.fillStyle = 'rgba(255,120,150,0.45)'
  for (const x of [0.26, 0.74]) {
    g.beginPath()
    g.ellipse(S * x, S * 0.64, S * 0.065, S * 0.035, 0, 0, Math.PI * 2)
    g.fill()
  }
  // 眼
  const eye = (x: number) => {
    const cx = S * x
    const cy = S * 0.47
    g.lineCap = 'round'
    g.strokeStyle = LINE
    if (state === 'open') {
      // 白眼底 + 藍色漸變虹膜 + 瞳孔 + 兩點高光
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.ellipse(cx, cy, S * 0.085, S * 0.095, 0, 0, Math.PI * 2)
      g.fill()
      const gr = g.createRadialGradient(cx, cy - S * 0.03, S * 0.01, cx, cy, S * 0.08)
      gr.addColorStop(0, '#9fe0ff')
      gr.addColorStop(0.55, '#3a8eea')
      gr.addColorStop(1, '#1a3f9a')
      g.fillStyle = gr
      g.beginPath()
      g.ellipse(cx, cy + S * 0.005, S * 0.072, S * 0.085, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#0d1730'
      g.beginPath()
      g.ellipse(cx, cy + S * 0.01, S * 0.032, S * 0.05, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.ellipse(cx + S * 0.025, cy - S * 0.035, S * 0.024, S * 0.028, 0, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.arc(cx - S * 0.03, cy + S * 0.04, S * 0.011, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = S * 0.016
      g.beginPath()
      g.ellipse(cx, cy, S * 0.086, S * 0.096, 0, Math.PI * 1.05, Math.PI * 1.95)
      g.stroke()
    } else if (state === 'blink') {
      g.lineWidth = S * 0.018
      g.beginPath()
      g.arc(cx, cy - S * 0.03, S * 0.075, Math.PI * 0.15, Math.PI * 0.85)
      g.stroke()
    } else {
      // 月牙笑眼 ^ ^
      g.lineWidth = S * 0.022
      g.beginPath()
      g.arc(cx, cy + S * 0.035, S * 0.07, Math.PI * 1.15, Math.PI * 1.85)
      g.stroke()
    }
  }
  eye(0.32)
  eye(0.68)
  // 鼻
  g.fillStyle = '#ff7f9f'
  g.beginPath()
  g.moveTo(S * 0.47, S * 0.585)
  g.lineTo(S * 0.53, S * 0.585)
  g.lineTo(S * 0.5, S * 0.62)
  g.closePath()
  g.fill()
  // 嘴：平時 ω，開心時張口
  g.strokeStyle = LINE
  g.lineWidth = S * 0.011
  if (state === 'happy') {
    g.fillStyle = '#c8304e'
    g.beginPath()
    g.moveTo(S * 0.43, S * 0.645)
    g.quadraticCurveTo(S * 0.5, S * 0.75, S * 0.57, S * 0.645)
    g.closePath()
    g.fill()
    g.stroke()
    g.fillStyle = '#ff8fa8'
    g.beginPath()
    g.ellipse(S * 0.5, S * 0.69, S * 0.03, S * 0.018, 0, 0, Math.PI * 2)
    g.fill()
  } else {
    g.beginPath()
    g.moveTo(S * 0.5, S * 0.62)
    g.quadraticCurveTo(S * 0.465, S * 0.665, S * 0.44, S * 0.635)
    g.moveTo(S * 0.5, S * 0.62)
    g.quadraticCurveTo(S * 0.535, S * 0.665, S * 0.56, S * 0.635)
    g.stroke()
  }
  // 鬍鬚
  g.strokeStyle = 'rgba(80,50,40,0.75)'
  g.lineWidth = S * 0.006
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      g.moveTo(S * (0.5 + s * 0.17), S * (0.64 + i * 0.022))
      g.lineTo(S * (0.5 + s * 0.36), S * (0.6 + i * 0.04))
      g.stroke()
    }
  }
  return c
}

function useFaces() {
  return useMemo(() => {
    const mk = (st: FaceState) => {
      const t = new THREE.CanvasTexture(drawFace(st))
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      return t
    }
    return { open: mk('open'), blink: mk('blink'), happy: mk('happy') }
  }, [])
}

function heartTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#ff6f9a'
  g.strokeStyle = '#7a1838'
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(32, 54)
  g.bezierCurveTo(4, 34, 8, 10, 24, 12)
  g.bezierCurveTo(30, 13, 32, 18, 32, 20)
  g.bezierCurveTo(32, 18, 34, 13, 40, 12)
  g.bezierCurveTo(56, 10, 60, 34, 32, 54)
  g.closePath()
  g.fill()
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,0.8)'
  g.beginPath()
  g.ellipse(22, 22, 5, 3, -0.6, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 撫摸時冒出嘅粉紅愛心（升起 + 淡出） */
function Hearts({ burst }: { burst: number }) {
  const tex = useMemo(heartTexture, [])
  const [items, setItems] = useState<Array<{ id: number; x: number; born: number }>>([])
  const clock = useRef(0)
  useEffect(() => {
    if (!burst) return
    const now = clock.current
    setItems((l) => [...l.slice(-6), ...[-0.4, 0.05, 0.45].map((x, i) => ({ id: burst * 10 + i, x: x + (Math.random() - 0.5) * 0.15, born: now + i * 0.12 }))])
  }, [burst])
  const refs = useRef<Record<number, THREE.Sprite | null>>({})
  useFrame((_, dt) => {
    clock.current += dt
    for (const it of items) {
      const s = refs.current[it.id]
      if (!s) continue
      const age = clock.current - it.born
      const k = Math.max(0, Math.min(1, age / 1.4))
      s.visible = age > 0 && k < 1
      s.position.set(it.x + Math.sin(age * 5) * 0.06, 2.15 + k * 0.9, 0.3)
      ;(s.material as THREE.SpriteMaterial).opacity = 1 - k
      s.scale.setScalar(0.28 + k * 0.08)
    }
  })
  return (
    <>
      {items.map((it) => (
        <sprite key={it.id} ref={(r) => { refs.current[it.id] = r }} visible={false}>
          <spriteMaterial map={tex} transparent depthWrite={false} />
        </sprite>
      ))}
    </>
  )
}

function Toon({ color, gm }: { color: string; gm: THREE.Texture }) {
  return <meshToonMaterial color={color} gradientMap={gm} />
}

function Cat({ equipped, happy, jump, onPet }: { equipped: string[]; happy: boolean; jump: number; onPet: () => void }) {
  const gm = useGradient()
  const faces = useFaces()
  const root = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const tail = useRef<THREE.Group>(null)
  const faceMat = useRef<THREE.MeshToonMaterial>(null)
  const jumpT = useRef(0)
  const lastJump = useRef(jump)
  const blink = useRef({ next: 2.5, until: 0 })
  const has = (id: string) => equipped.includes(id)
  const R = 0.62 // Q 版大頭
  const tailCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.25, 0.15, -0.25),
        new THREE.Vector3(0.45, 0.55, -0.3),
        new THREE.Vector3(0.35, 0.95, -0.15),
        new THREE.Vector3(0.15, 1.15, -0.05),
      ]),
    [],
  )

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    if (jump !== lastJump.current) {
      lastJump.current = jump
      jumpT.current = 1
    }
    jumpT.current = Math.max(0, jumpT.current - dt * 1.05)
    const k = jumpT.current
    if (root.current) {
      // 開心彈跳（兩下）+ 落地壓扁回彈；平時輕輕呼吸
      const hop = Math.abs(Math.sin((1 - k) * Math.PI * 2)) * 0.42 * k
      root.current.position.y = hop
      const squash = 1 + Math.sin((1 - k) * Math.PI * 4) * 0.06 * k + Math.sin(t * 2.2) * 0.012
      root.current.scale.set(2 - squash, squash, 2 - squash)
    }
    if (head.current) {
      // 歪頭賣萌
      head.current.rotation.z = happy ? Math.sin(t * 3) * 0.08 + 0.22 * Math.min(1, k * 3 + 0.4) : Math.sin(t * 0.8) * 0.04
      head.current.rotation.x = Math.sin(t * 0.6) * 0.03
    }
    if (tail.current) tail.current.rotation.z = Math.sin(t * (happy ? 7 : 1.8)) * (happy ? 0.3 : 0.12)
    // 自然眨眼
    const b = blink.current
    if (t > b.next) {
      b.until = t + 0.13
      b.next = t + 2.6 + Math.random() * 2.8
    }
    if (faceMat.current) {
      const want = happy ? faces.happy : t < b.until ? faces.blink : faces.open
      if (faceMat.current.map !== want) {
        faceMat.current.map = want
        faceMat.current.needsUpdate = true
      }
    }
  })

  const OL = <Outlines thickness={0.04} color={LINE} />
  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation()
        onPet()
      }}
    >
      {/* 身體（梨形）+ 蓬鬆頸毛 */}
      <mesh position={[0, 0.55, 0]} scale={[1, 0.95, 0.9]} castShadow>
        <sphereGeometry args={[0.55, 40, 28]} />
        <Toon color={CREAM} gm={gm} />
        {OL}
      </mesh>
      <mesh position={[0, 0.9, 0.08]} scale={[1.08, 0.42, 0.95]} castShadow>
        <sphereGeometry args={[0.5, 32, 20]} />
        <Toon color="#ffffff" gm={gm} />
        {OL}
      </mesh>
      {/* 前爪（白）+ 粉紅肉球 */}
      {[-0.22, 0.22].map((x) => (
        <group key={x} position={[x, 0.1, 0.42]}>
          <mesh scale={[1, 0.7, 1.25]} castShadow>
            <sphereGeometry args={[0.15, 20, 14]} />
            <Toon color="#ffffff" gm={gm} />
            {OL}
          </mesh>
          {[[-0.05, 0.03], [0, 0.05], [0.05, 0.03]].map(([bx, by], i) => (
            <mesh key={i} position={[bx, by - 0.02, 0.17]}>
              <sphereGeometry args={[0.026, 10, 8]} />
              <Toon color={PINK} gm={gm} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 後腿 */}
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.15, 0.08]} scale={[0.9, 0.75, 1.35]} castShadow>
          <sphereGeometry args={[0.21, 20, 14]} />
          <Toon color={CREAM} gm={gm} />
          {OL}
        </mesh>
      ))}
      {/* 蓬鬆大尾巴 */}
      <group ref={tail} position={[0.1, 0.22, -0.42]}>
        <mesh castShadow>
          <tubeGeometry args={[tailCurve, 32, 0.15, 14, false]} />
          <Toon color={SEAL} gm={gm} />
          {OL}
        </mesh>
        <mesh position={[0.15, 1.15, -0.05]}>
          <sphereGeometry args={[0.15, 16, 12]} />
          <Toon color={SEAL_DARK} gm={gm} />
        </mesh>
      </group>

      {/* 皇家披風 */}
      {has('pet_cape_royal') && (
        <group position={[0, 0.62, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.56, 0.8, 0.95, 32, 1, true, Math.PI * 0.35, Math.PI * 1.3]} />
            <meshToonMaterial color="#c8142e" gradientMap={gm} side={THREE.DoubleSide} />
            <Outlines thickness={0.032} color={LINE} />
          </mesh>
          <mesh position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5, 0.055, 12, 36]} />
            <Toon color="#f2c14e" gm={gm} />
            {OL}
          </mesh>
        </group>
      )}
      {/* 天使翼 */}
      {has('pet_wings') &&
        [-1, 1].map((s) => (
          <group key={s} position={[s * 0.42, 0.9, -0.42]} rotation={[0.25, s * 0.6, s * 0.5]}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} position={[s * i * 0.13, 0.22 - i * 0.17, -i * 0.02]} scale={[0.15, 0.52 - i * 0.08, 0.07]} castShadow>
                <sphereGeometry args={[1, 18, 12]} />
                <Toon color="#ffffff" gm={gm} />
                <Outlines thickness={0.032} color={LINE} />
              </mesh>
            ))}
          </group>
        ))}

      {/* 頭（Q 版大頭） */}
      <group ref={head} position={[0, 1.55, 0.05]}>
        <mesh castShadow>
          <sphereGeometry args={[R, 48, 36]} />
          <Toon color={CREAM} gm={gm} />
          {OL}
        </mesh>
        {/* 頭頂深啡 */}
        <mesh>
          <sphereGeometry args={[R * 1.003, 48, 20, 0, Math.PI * 2, 0, 0.72]} />
          <Toon color={SEAL} gm={gm} />
        </mesh>
        {/* 臉部動態貼圖（前半球弧形面片） */}
        <mesh>
          <sphereGeometry args={[R * 1.006, 64, 48, Math.PI / 2 - 1.0, 2.0, 0.42, 1.75]} />
          <meshToonMaterial ref={faceMat} map={faces.open} gradientMap={gm} transparent alphaTest={0.02} />
        </mesh>
        {/* 臉頰蓬毛 */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.5, -0.2, 0.1]} scale={[0.55, 0.42, 0.55]} castShadow>
            <sphereGeometry args={[0.3, 16, 12]} />
            <Toon color={CREAM} gm={gm} />
            {OL}
          </mesh>
        ))}
        {/* 耳：深啡外 + 粉紅內 */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.4, 0.5, -0.02]} rotation={[-0.1, 0, -s * 0.38]}>
            <mesh castShadow>
              <coneGeometry args={[0.21, 0.42, 24]} />
              <Toon color={SEAL_DARK} gm={gm} />
              {OL}
            </mesh>
            <mesh position={[0, -0.04, 0.09]} scale={[0.6, 0.72, 0.4]}>
              <coneGeometry args={[0.21, 0.42, 20]} />
              <Toon color="#ffb3c6" gm={gm} />
            </mesh>
          </group>
        ))}
        {/* 小丑鼻 */}
        {has('pet_clown_nose') && (
          <mesh position={[0, -0.08, R * 0.97]} castShadow>
            <sphereGeometry args={[0.11, 24, 18]} />
            <Toon color="#ff1e3c" gm={gm} />
            {OL}
          </mesh>
        )}
        {/* 巫師帽 */}
        {has('pet_hat_wizard') && (
          <group position={[0, R * 0.82, -0.05]} rotation={[-0.15, 0, 0.12]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.66, 0.66, 0.06, 40]} />
              <Toon color="#4a1a8a" gm={gm} />
              {OL}
            </mesh>
            <mesh position={[0, 0.45, 0]} castShadow>
              <coneGeometry args={[0.42, 0.9, 32]} />
              <Toon color="#6a2ac0" gm={gm} />
              {OL}
            </mesh>
            <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.4, 0.05, 12, 32]} />
              <Toon color="#f2c14e" gm={gm} />
            </mesh>
            <mesh position={[0.06, 0.5, 0.36]}>
              <octahedronGeometry args={[0.1]} />
              <Toon color="#ffe066" gm={gm} />
              {OL}
            </mesh>
          </group>
        )}
      </group>
    </group>
  )
}

function Room() {
  const gm = useGradient()
  return (
    <group>
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[2.3, 2.3, 0.08, 64]} />
        <meshToonMaterial color="#5a22a0" gradientMap={gm} />
        <Outlines thickness={0.035} color={LINE} />
      </mesh>
      <mesh position={[0, 0.085, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.2, 0.04, 10, 80]} />
        <meshToonMaterial color="#f2c14e" gradientMap={gm} />
      </mesh>
      <group position={[1.6, 0, -0.95]}>
        <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 0.12, 0.72]} />
          <meshToonMaterial color="#9a6a46" gradientMap={gm} />
          <Outlines thickness={0.035} color={LINE} />
        </mesh>
        <mesh position={[0, 0.78, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 1.35, 24]} />
          <meshToonMaterial color="#e2c494" gradientMap={gm} />
          <Outlines thickness={0.035} color={LINE} />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <boxGeometry args={[0.66, 0.12, 0.66]} />
          <meshToonMaterial color="#c8142e" gradientMap={gm} />
          <Outlines thickness={0.035} color={LINE} />
        </mesh>
        <mesh position={[0.2, 1.66, 0.1]} castShadow>
          <sphereGeometry args={[0.11, 16, 12]} />
          <meshToonMaterial color="#ffd34d" gradientMap={gm} />
          <Outlines thickness={0.03} color={LINE} />
        </mesh>
      </group>
    </group>
  )
}

export default function PetStage({ equipped, happy, jump, onPet }: { equipped: string[]; happy: boolean; jump: number; onPet: () => void }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 2.2, 6.6], fov: 36 }} gl={{ alpha: true, antialias: true }} style={{ touchAction: 'pan-y' }}>
      <ambientLight intensity={1.2} color="#fff6ee" />
      <directionalLight position={[2.5, 5, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-3, 2, 2]} intensity={0.6} color="#ffc2e6" />
      <Room />
      <Cat equipped={equipped} happy={happy} jump={jump} onPet={onPet} />
      <Hearts burst={jump} />
      <ContactShadows position={[0, 0.09, 0]} opacity={0.45} scale={7} blur={2.2} far={2.6} />
      <OrbitControls makeDefault enableZoom={false} enablePan={false} target={[0, 1.1, 0]} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.9} />
    </Canvas>
  )
}
