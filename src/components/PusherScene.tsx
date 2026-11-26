import { Component, Suspense, useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, PerformanceMonitor, Sparkles } from '@react-three/drei'
import { PusherEngine, type EngineEvents } from '../engine/PusherEngine'
import { loadTable, saveTable } from '../utils/saveTable'
import { PIP_ASPECT } from '../engine/TowerDock'

/** 築塔台小視窗（右上角）：佔畫布闊度比例 / 邊距 / 距頂 */
export const PIP_W = 0.16
export const PIP_MARGIN = 0.015
export const PIP_TOP = 0.008

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

const PITCH = (36 * Math.PI) / 180 // 俯角（低啲 = 更似第一身）
const FIT_HALF_WIDTH = 3.3 // 要完整睇到嘅檯面半闊（含側牆）
const CAM_SHIFT_X = 0
const LOOK_AT = new THREE.Vector3(CAM_SHIFT_X, -0.75, 0.3) // 睇向偏前，令檯面靠上，畀下面操作掣留位

export function PusherScene({ engineRef, events, onContextLost, onDecline }: Props) {
  const [engine, setEngine] = useState<PusherEngine | null>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  // 鏡頭：按畫布闊高比自動拉遠／拉近，確保檯面左右剛好填滿
  useEffect(() => {
    camera.fov = 62 // 闊視角：近大遠小，有第一身臨場感
    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const dist = FIT_HALF_WIDTH / (tanHalf * aspect)
    camera.position.set(CAM_SHIFT_X, LOOK_AT.y + Math.sin(PITCH) * dist, LOOK_AT.z + Math.cos(PITCH) * dist)
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
    void PusherEngine.create(events, loadTable()).then((e) => {
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
        saveTable(created.serialize()) // 離開機台前存檔（dispose 之前）
        created.dispose()
        if (engineRef.current === created) engineRef.current = null
      }
    }
    // events 內嘅 callback 係穩定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, dt) => {
    if (!engine) return
    engine.update(dt)
  })

  // 自動存檔：每 5 秒 + 切走 App / 離開時
  useEffect(() => {
    if (!engine) return
    const save = () => saveTable(engine.serialize())
    const id = window.setInterval(save, 5000)
    const onVis = () => document.hidden && save()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', save)
    }
  }, [engine])

  // 築塔台小視窗：同一個 renderer 用 scissor 再畫一次（獨立 scene + 正交鏡頭）
  const pip = useMemo(() => {
    const scene = new THREE.Scene()
    const w = 3.4
    const h = w * PIP_ASPECT
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 30)
    cam.position.set(0, 2.1, 9)
    cam.lookAt(0, 1.2, 0)
    cam.position.y = 1.2 + 1.2
    return { scene, cam }
  }, [])
  useEffect(() => {
    if (!engine) return
    pip.scene.add(engine.dockPip)
    return () => {
      pip.scene.remove(engine.dockPip)
    }
  }, [engine, pip])
  useFrame(({ gl, scene, camera, size }) => {
    if (!engine) return
    gl.setScissorTest(false)
    gl.setViewport(0, 0, size.width, size.height)
    gl.clear()
    gl.render(scene, camera)
    const w = size.width * PIP_W
    const h = w * PIP_ASPECT
    const x = size.width * (1 - PIP_MARGIN) - w
    const y = size.height - size.width * PIP_TOP - h
    gl.setScissorTest(true)
    gl.setViewport(x, y, w, h)
    gl.setScissor(x, y, w, h)
    gl.clearDepth() // 唔清顏色：小視窗半透明疊喺主畫面上
    gl.render(pip.scene, pip.cam)
    gl.setScissorTest(false)
  }, 1)

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
        count={16}
        scale={[6.4, 3.2, 8]}
        position={[0, 1.8, -1]}
        size={3}
        speed={0.35}
        opacity={0.9}
        color="#ffe28a"
      />
      {engine && <primitive object={engine.group} />}
    </>
  )
}
