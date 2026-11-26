import { Sprite } from './Sprite'
import type { SpriteKey } from '../utils/SpriteAtlas'

/** 行內小圖示（取代 emoji 佔位），高度跟字體大小 */
export function Icon({ name }: { name: SpriteKey }) {
  return <Sprite name={name} className="ico" />
}
