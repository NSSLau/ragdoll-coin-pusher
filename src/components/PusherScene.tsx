import { Component, Suspense, useEffect, useState, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, PerformanceMonitor, Sparkles } from '@react-three/drei'
import { PusherEngine, type EngineEvents } from '../engine/PusherEngine'

/** Environment 會由 CDN 載 HDR；載入失敗就靜靜地跳過，唔好拖垮成個場景 */
class SafeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

interface Props {
  engineRef: MutableRefObject<PusherEngine | null>
  events: EngineEvents
  onContextLost: () => void
  onDecline: () => void
}

const PITCH = (60 * Math.PI) / 180 // 俯角
const FIT_HALF_WIDTH = 3.45 // 要完整睇到嘅檯面半闊（含側牆）
const LOOK_AT = new THREE.Vector3(0, 0, 0.9) // 睇向偏前，令檯面靠上，畀下面操作掣留位

export function PusherScene({ engineRef, events, onContextLost, onDecline }: Props) {
  const [engine, setEngine] = useState<PusherEngine | null>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  // 鏡頭：按畫布闊高比自動拉遠／拉近，確保檯面左右剛好填滿
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const dist = FIT_HALF_WIDTH / (tanHalf * aspect)
    camera.position.set(0, LOOK_AT.y + Math.sin(PITCH) * dist, LOOK_AT.z + Math.cos(PITCH) * dist)
    camera.lookAt(LOOK_AT)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])

  // iOS 切換 App／記憶體不足會令 WebGL context 丟失
  useEffect(() => {
    const el = gl.domElement
    const lost = (e: Event) => {
      e.preventDefault()
      onContextLost()
    }
    el.addEventListener('webglcontextlost', lost)
    return () => el.removeEventListener('webglcontextlost', lost)
  }, [gl, onContextLost])

  useEffect(() => {
    let disposed = false
    let created: PusherEngine | null = null
    void PusherEngine.create(events).then((e) => {
      if (disposed) {
        e.dispose()
        return
      }
      created = e
      engineRef.current = e
      setEngine(e)
    })
    return () => {
      disposed = true
      if (created) {
        created.dispose()
        if (engineRef.current === created) engineRef.current = null
      }
    }
    // events 內嘅 callback 係穩定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, dt) => {
    engine?.update(dt)
  })

  return (
    <>
      <PerformanceMonitor onDecline={onDecline} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 9, 5]} intensity={1.6} />
      <pointLight position={[0, 3, 2]} intensity={14} color="#ffd9a0" />
      <SafeBoundary>
        <Suspense fallback={null}>
          <Environment preset="city" environmentIntensity={0.55} />
        </Suspense>
      </SafeBoundary>
      <Sparkles
        count={46}
        scale={[6.4, 3.2, 8]}
        position={[0, 1.8, -1]}
        size={5}
        speed={0.35}
        opacity={0.9}
        color="#ffe28a"
      />
      {engine && <primitive object={engine.group} />}
    </>
  )
}
