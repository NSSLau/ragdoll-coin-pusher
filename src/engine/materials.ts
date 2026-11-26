import * as THREE from 'three'

/**
 * 程式生成嘅絨布凹凸貼圖（bumpMap）：菱格車線 + 鈕扣凹位 + 細絨顆粒。
 * 白 = 凸、黑 = 凹；配合 MeshPhysicalMaterial 嘅 sheen 做天鵝絨質感，唔使額外圖片。
 */
export function velvetBumpCanvas(size = 256): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#b4b4b4'
  g.fillRect(0, 0, size, size)
  // 菱格面向內微隆起（徑向漸變），車線位置凹落
  const half = size / 2
  g.save()
  g.beginPath()
  g.moveTo(half, 0)
  g.lineTo(size, half)
  g.lineTo(half, size)
  g.lineTo(0, half)
  g.closePath()
  const rg = g.createRadialGradient(half, half, 0, half, half, half)
  rg.addColorStop(0, '#f0f0f0')
  rg.addColorStop(1, '#a0a0a0')
  g.fillStyle = rg
  g.fill()
  g.restore()
  // 車線（菱格邊）
  g.strokeStyle = '#2a2a2a'
  g.lineWidth = size / 28
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(half, 0)
  g.lineTo(size, half)
  g.lineTo(half, size)
  g.lineTo(0, half)
  g.closePath()
  g.stroke()
  // 菱格交匯嘅鈕扣凹位
  g.fillStyle = '#101010'
  for (const [x, y] of [[half, 0], [size, half], [half, size], [0, half], [half, half]] as const) {
    g.beginPath()
    g.arc(x, y, size / 20, 0, Math.PI * 2)
    g.fill()
  }
  // 細絨顆粒
  const img = g.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
    img.data[i + 1] = img.data[i]
    img.data[i + 2] = img.data[i]
  }
  g.putImageData(img, 0, 0)
  return c
}

export function bumpTexture(canvas: HTMLCanvasElement, rx: number, ry: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}
