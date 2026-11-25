import { Component, Suspense, useEffect, useState, type MutableRefObject, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Sparkles } from '@react-three/drei'
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
}

export function PusherScene({ engineRef, events }: Props) {
  const [engine, setEngine] = useState<PusherEngine | null>(null)
  const camera = useThree((s) => s.camera)

  // 鏡頭：由上前方俯瞰檯面
  useEffect(() => {
    camera.position.set(0, 8.5, 8.2)
    camera.lookAt(0, 0.2, -0.9)
    camera.updateProjectionMatrix()
  }, [camera])

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
