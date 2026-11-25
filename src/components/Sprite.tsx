import type { CSSProperties } from 'react'
import { getSprite, type SpriteKey } from '../utils/SpriteAtlas'

interface Props {
  name: SpriteKey
  className?: string
  style?: CSSProperties
  alt?: string
}

/** 顯示一個已去背嘅精靈（貼身裁切，保留原始比例） */
export function Sprite({ name, className, style, alt = '' }: Props) {
  const s = getSprite(name)
  return (
    <img
      src={s.url}
      alt={alt}
      draggable={false}
      className={className}
      style={{ aspectRatio: `${s.width} / ${s.height}`, ...style }}
    />
  )
}
