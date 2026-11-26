import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'

/* ------------------------------------------------------------------ */
/*  布偶貓小窩 3D 舞台：皇家貓屋（紫絨地毯、貓抓柱）+ 3D 布偶貓（程式幾何體）          */
/*  手指左右拖曳旋轉視角；點擊貓咪開心跳；裝備嘅飾品即時穿戴喺貓身上                   */
/* ------------------------------------------------------------------ */

const CREAM = '#f4ede4'
const BROWN = '#6b4a3a'
const DARK = '#3a2a24'

function Eye({ x, happy }: { x: number; happy: boolean }) {
  if (happy) {
    // 開心瞇眼：向上拱嘅弧線 ^
    return (
      <mesh position={[x, 0.1, 0.44]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.065, 0.017, 8, 16, Math.PI]} />
        <meshStandardMaterial color={DARK} roughness={0.6} />
      </mesh>
    )
  }
  return (
    <group position={[x, 0.08, 0.43]}>
      <mesh>
        <sphereGeometry args={[0.085, 20, 16]} />
        <meshStandardMaterial color="#4aa6ff" roughness={0.2} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <sphereGeometry args={[0.04, 12, 10]} />
        <meshStandardMaterial color="#10141c" roughness={0.3} />
      </mesh>
      <mesh position={[0.025, 0.03, 0.09]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

function Cat({ equipped, happy, jump, onPet }: { equipped: string[]; happy: boolean; jump: number; onPet: () => void }) {
  const root = useRef<THREE.Group>(null)
  const t0 = useRef(0)
  const lastJump = useRef(jump)
  const tail = useRef<THREE.Group>(null)
  const has = (id: string) => equipped.includes(id)
  const tailCurve = useMemo(
    () => new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0.25, -0.2), new THREE.Vector3(0.05, 0.6, -0.3), new THREE.Vector3(-0.1, 0.95, -0.2)]),
    [],
  )
  useFrame((st, dt) => {
    if (!root.current) return
    if (jump !== lastJump.current) {
      lastJump.current = jump
      t0.current = 1
    }
    t0.current = Math.max(0, t0.current - dt * 1.1)
    const k = t0.current
    root.current.position.y = Math.abs(Math.sin((1 - k) * Math.PI * 3)) * 0.45 * k
    root.current.scale.set(1 + 0.05 * (1 - k) * 0, 1 + Math.sin((1 - k) * Math.PI * 6) * 0.04 * k, 1)
    root.current.rotation.z = Math.sin(st.clock.elapsedTime * 1.4) * 0.015
    if (tail.current) tail.current.rotation.z = Math.sin(st.clock.elapsedTime * (happy ? 6 : 1.6)) * (happy ? 0.35 : 0.15)
  })
  const mat = (c: string, r = 0.9) => <meshStandardMaterial color={c} roughness={r} />
  return (
    <group
      ref={root}
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onPet()
      }}
    >
      {/* 身體 + 胸毛 */}
      <mesh position={[0, 0.6, 0]} scale={[1, 1.05, 0.95]} castShadow>
        <sphereGeometry args={[0.58, 32, 24]} />
        {mat(CREAM)}
      </mesh>
      <mesh position={[0, 0.55, 0.3]} castShadow>
        <sphereGeometry args={[0.4, 24, 18]} />
        {mat('#fffaf2')}
      </mesh>
      {/* 前爪 / 後爪 */}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.12, 0.45]} scale={[1, 0.7, 1.2]} castShadow>
          <sphereGeometry args={[0.15, 16, 12]} />
          {mat('#fffaf2')}
        </mesh>
      ))}
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, 0.14, 0.12]} scale={[0.9, 0.8, 1.4]} castShadow>
          <sphereGeometry args={[0.2, 16, 12]} />
          {mat(CREAM)}
        </mesh>
      ))}
      {/* 尾巴 */}
      <group ref={tail} position={[0, 0.3, -0.5]}>
        <mesh castShadow>
          <tubeGeometry args={[tailCurve, 24, 0.11, 10, false]} />
          {mat(BROWN)}
        </mesh>
      </group>
      {/* 披風（背後） */}
      {has('pet_cape_royal') && (
        <group position={[0, 0.6, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.6, 0.82, 1.0, 28, 1, true, Math.PI * 0.35, Math.PI * 1.3]} />
            <meshStandardMaterial color="#b0102c" roughness={0.45} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.52, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.52, 0.05, 10, 32]} />
            <meshStandardMaterial color="#e9c46a" metalness={0.85} roughness={0.22} />
          </mesh>
        </group>
      )}
      {/* 天使翼 */}
      {has('pet_wings') &&
        [-1, 1].map((s) => (
          <group key={s} position={[s * 0.45, 0.95, -0.45]} rotation={[0.2, s * 0.6, s * 0.55]}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} position={[s * i * 0.12, 0.2 - i * 0.16, -i * 0.02]} scale={[0.14, 0.5 - i * 0.07, 0.07]} castShadow>
                <sphereGeometry args={[1, 16, 12]} />
                <meshStandardMaterial color="#ffffff" roughness={0.5} emissive="#fff4d6" emissiveIntensity={0.25} />
              </mesh>
            ))}
          </group>
        ))}

      {/* 頭 */}
      <group position={[0, 1.4, 0.05]}>
        <mesh castShadow>
          <sphereGeometry args={[0.52, 32, 24]} />
          {mat(CREAM)}
        </mesh>
        {/* 面罩：額頭同兩邊深色（布偶貓特徵） */}
        <mesh rotation={[0.55, 0, 0]}>
          <sphereGeometry args={[0.525, 32, 20, 0, Math.PI * 2, 0, 1.05]} />
          {mat(BROWN)}
        </mesh>
        <mesh position={[0, -0.14, 0.43]} scale={[1, 0.72, 0.6]}>
          <sphereGeometry args={[0.22, 20, 14]} />
          {mat('#fffaf2')}
        </mesh>
        <mesh position={[0, -0.04, 0.5]} scale={[1, 0.7, 0.7]}>
          <sphereGeometry args={[0.045, 12, 10]} />
          {mat('#ff9bb0', 0.4)}
        </mesh>
        {/* 嘴：開心時張開 */}
        <mesh position={[0, -0.16, 0.5]} scale={happy ? [1, 1, 1] : [0.6, 0.3, 1]}>
          <sphereGeometry args={[0.06, 12, 10]} />
          {mat(happy ? '#c43a56' : '#ff9bb0', 0.5)}
        </mesh>
        <Eye x={-0.18} happy={happy} />
        <Eye x={0.18} happy={happy} />
        {/* 耳 */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.33, 0.45, -0.02]} rotation={[0, 0, -s * 0.4]}>
            <mesh castShadow>
              <coneGeometry args={[0.18, 0.36, 4]} />
              {mat(BROWN)}
            </mesh>
            <mesh position={[0, -0.03, 0.05]} scale={[0.6, 0.7, 0.5]}>
              <coneGeometry args={[0.18, 0.36, 4]} />
              {mat('#ffb0c4', 0.6)}
            </mesh>
          </group>
        ))}
        {/* 鬍鬚 */}
        {[-1, 1].flatMap((s) => [0, 1].map((i) => (
          <mesh key={`${s}${i}`} position={[s * 0.34, -0.12 - i * 0.04, 0.42]} rotation={[0, 0, s * (Math.PI / 2 + (i - 0.5) * 0.25)]}>
            <cylinderGeometry args={[0.004, 0.004, 0.34, 4]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        )))}
        {/* 小丑鼻 */}
        {has('pet_clown_nose') && (
          <mesh position={[0, -0.04, 0.55]} castShadow>
            <sphereGeometry args={[0.1, 20, 16]} />
            <meshStandardMaterial color="#e8142c" roughness={0.25} metalness={0.1} />
          </mesh>
        )}
        {/* 巫師帽 */}
        {has('pet_hat_wizard') && (
          <group position={[0, 0.5, -0.02]} rotation={[-0.12, 0, 0.1]}>
            <mesh position={[0, 0.02, 0]} castShadow>
              <cylinderGeometry args={[0.62, 0.62, 0.05, 32]} />
              <meshStandardMaterial color="#4a1a8a" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.42, 0]} castShadow>
              <coneGeometry args={[0.4, 0.82, 28]} />
              <meshStandardMaterial color="#5a22a8" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.38, 0.04, 10, 28]} />
              <meshStandardMaterial color="#e9c46a" metalness={0.85} roughness={0.22} />
            </mesh>
            <mesh position={[0.05, 0.5, 0.36]}>
              <octahedronGeometry args={[0.09]} />
              <meshStandardMaterial color="#ffd34d" emissive="#ffb300" emissiveIntensity={0.8} metalness={0.5} roughness={0.3} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  )
}

function Room() {
  return (
    <group>
      {/* 紫絨地毯 + 金邊 */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[2.3, 2.3, 0.08, 48]} />
        <meshStandardMaterial color="#4a1a7a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.085, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.2, 0.035, 10, 64]} />
        <meshStandardMaterial color="#e9c46a" metalness={0.85} roughness={0.22} />
      </mesh>
      {/* 貓抓柱 */}
      <group position={[1.55, 0, -0.9]}>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.1, 0.7]} />
          <meshStandardMaterial color="#8a5a3a" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.75, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 1.3, 20]} />
          <meshStandardMaterial color="#d9b88a" roughness={1} />
        </mesh>
        <mesh position={[0, 1.45, 0]} castShadow>
          <boxGeometry args={[0.62, 0.1, 0.62]} />
          <meshStandardMaterial color="#b0102c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.58, 0]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color="#ffd34d" metalness={0.85} roughness={0.22} />
        </mesh>
      </group>
    </group>
  )
}

export default function PetStage({ equipped, happy, jump, onPet }: { equipped: string[]; happy: boolean; jump: number; onPet: () => void }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 2.1, 6.4], fov: 38 }} gl={{ alpha: true, antialias: true }} style={{ touchAction: 'pan-y' }}>
      <ambientLight intensity={0.8} color="#e6d6ff" />
      <hemisphereLight args={['#fff1d6', '#3a1458', 0.6]} />
      <directionalLight position={[2.5, 5, 3]} intensity={1.7} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <pointLight position={[-2, 2, 2]} intensity={6} color="#ffb0e0" />
      <Room />
      <Cat equipped={equipped} happy={happy} jump={jump} onPet={onPet} />
      <ContactShadows position={[0, 0.09, 0]} opacity={0.55} scale={7} blur={2.4} far={2.6} />
      <OrbitControls makeDefault enableZoom={false} enablePan={false} target={[0, 1.0, 0]} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.9} />
    </Canvas>
  )
}
