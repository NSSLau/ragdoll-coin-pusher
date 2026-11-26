import type { CSSProperties } from 'react'
import { getSprite, type SpriteKey } from '../utils/SpriteAtlas'

interface Props {
  name: SpriteKey
  className?: string
  style?: CSSProperties
  alt?: string
  onAnimationEnd?: () => void
}

/** 顯示一個已去背嘅精靈（貼身裁切，保留原始比例） */
export function Sprite({ name, className, style, alt = '', onAnimationEnd }: Props) {
  const s = getSprite(name)
  return (
    <img
      src={s.url}
      alt={alt}
      draggable={false}
      onAnimationEnd={onAnimationEnd}
      className={className}
      style={{ aspectRatio: `${s.width} / ${s.height}`, ...style }}
    />
  )
}
