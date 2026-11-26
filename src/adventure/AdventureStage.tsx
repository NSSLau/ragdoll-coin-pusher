import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sprite } from '../components/Sprite'
import type { SpriteKey } from '../utils/SpriteAtlas'
import { HERO_MAX, MONSTERS, SLASH_TIME, useAdventure } from './adventureStore'

const WALK_FRAME_MS = 220

/** 上方橫向捲軸舞台：布偶貓勇者行路打怪（面板開住時暫停） */
export function AdventureStage({ paused }: { paused: boolean }) {
  const stage = useAdventure((s) => s.stage)
  const wave = useAdventure((s) => s.wave)
  const phase = useAdventure((s) => s.phase)
  const heroHp = useAdventure((s) => s.heroHp)
  const monHp = useAdventure((s) => s.monHp)
  const monMax = useAdventure((s) => s.monMax)
  const slashId = useAdventure((s) => s.slashId)
  const critId = useAdventure((s) => s.critId)
  const hurtId = useAdventure((s) => s.hurtId)
  const monHitId = useAdventure((s) => s.monHitId)
  const smashId = useAdventure((s) => s.smashId)
  const floats = useAdventure((s) => s.floats)
  const lastReward = useAdventure((s) => s.lastReward)

  const [frame, setFrame] = useState(0)
  const slashing = useAdventure((s) => s.slashT > 0)

  // 遊戲時鐘：rAF 驅動，暫停時唔行（dt 有上限，切走分頁返嚟唔會一次過扣好多血）
  useEffect(() => {
    if (paused) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      useAdventure.getState().tick(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [paused])

  // 行路幀 1 ↔ 2
  useEffect(() => {
    if (paused || phase !== 'walk') return
    const id = window.setInterval(() => setFrame((f) => 1 - f), WALK_FRAME_MS)
    return () => window.clearInterval(id)
  }, [paused, phase])


  const m = MONSTERS[wave]
  const heroSprite: SpriteKey =
    phase === 'dizzy'
      ? 'adv_hero_dizzy'
      : slashing && phase === 'fight'
        ? 'adv_hero_slash'
        : phase === 'walk' && frame
          ? 'adv_hero_walk2'
          : 'adv_hero_walk1'
  const showMonster = phase === 'fight'
  const label = m.boss ? 'BOSS' : `${wave + 1}`

  return (
    <div className={`adv${phase === 'walk' && !paused ? ' scrolling' : ''}${m.boss && showMonster ? ' boss' : ''}`}>
      <div className="adv-bg" />
      <div className="adv-ground" />

      <div className="adv-hud">
        <span className="adv-stage">
          Stage {stage}-{label}
        </span>
        <div className="adv-prog" aria-label="關卡進度">
          {MONSTERS.map((mm, i) => (
            <i key={i} className={`${i < wave || phase === 'clear' ? 'done' : i === wave ? 'cur' : ''}${mm.boss ? ' b' : ''}`} />
          ))}
        </div>
        {showMonster && <span className="adv-mname">{m.name}</span>}
      </div>

      {/* 勇者 */}
      <div className="adv-hero">
        <div className="adv-hp hero">
          <i style={{ width: `${(heroHp / HERO_MAX) * 100}%` }} />
          <span>
            {Math.ceil(heroHp)}/{HERO_MAX}
          </span>
        </div>
        <motion.div
          key={`h${slashId}`}
          className="adv-sprite"
          animate={slashId ? { x: [0, '32%', 0] } : { x: 0 }}
          transition={{ duration: SLASH_TIME, ease: 'easeOut' }}
        >
          <Sprite name={heroSprite} className={hurtId ? 'adv-hurt' : ''} key={`hurt${hurtId}`} />
        </motion.div>
      </div>

      {/* 怪物 */}
      <AnimatePresence>
        {showMonster && (
          <motion.div
            key={`m${stage}-${wave}`}
            className={`adv-mon${m.boss ? ' boss' : ''}`}
            initial={{ x: '120%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ y: '40%', opacity: 0, rotate: 25, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 160, damping: 18 }}
          >
            <div className="adv-hp mon">
              <i style={{ width: `${monMax ? (monHp / monMax) * 100 : 0}%` }} />
            </div>
            <div className="adv-sprite" key={`mh${monHitId}`}>
              <Sprite name={m.sprite} className={`${monHitId ? 'adv-hit' : ''}${m.flip ? ' flip' : ''}`} />
            </div>
            {critId > 0 && <Sprite key={`c${critId}`} name="fx_hit_star" className="adv-crit" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 金磚必殺：巨型貓爪由天而降 */}
      {smashId > 0 && <Sprite key={`s${smashId}`} name="mg_hub" className="adv-paw" />}

      {/* 浮動數字 */}
      <div className="adv-floats">
        <AnimatePresence>
          {floats.map((f) => (
            <motion.span
              key={f.id}
              className={`adv-float ${f.kind}`}
              initial={{ y: 0, opacity: 1, scale: f.kind === 'smash' || f.kind === 'crit' ? 1.4 : 1 }}
              animate={{ y: -26, opacity: 0, scale: 1 }}
              transition={{ duration: 0.9 }}
              onAnimationComplete={() =>
                useAdventure.setState((s) => ({ floats: s.floats.filter((x) => x.id !== f.id) }))
              }
            >
              {f.text}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {phase === 'dizzy' && <div className="adv-banner bad">暈低咗！退回起點重新挑戰</div>}
      {phase === 'clear' && (
        <div className="adv-banner good">
          通關！+{lastReward} 金幣
        </div>
      )}
      {phase === 'walk' && wave === 3 && <div className="adv-banner warn">⚠ Boss 出現！</div>}
    </div>
  )
}
