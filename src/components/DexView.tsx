import { useState } from 'react'
import { motion } from 'framer-motion'
import { panelMotion } from './panelMotion'
import { Sprite } from './Sprite'
import { COSTUMES, MONSTER_DEX, ORB_DEX, TROPHIES } from '../data/progress'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import type { SpriteKey } from '../utils/SpriteAtlas'

type Tab = 'monster' | 'treasure' | 'costume'
const COSTUME_SPRITE: Record<string, SpriteKey> = {
  pet_hat_wizard: 'pet_hat_wizard',
  pet_cape_royal: 'pet_cape_royal',
  pet_wings: 'pet_wings',
  pet_clown_nose: 'pet_clown_nose_bow',
}
const ORB_COUNT_KEY: Record<string, string> = {
  orb_fire: 'orb_fire',
  orb_water: 'orb_water',
  orb_lightning: 'orb_lightning',
  orb_mystery: 'orb_mystery',
  trophy_dragon_medal: 'orb_dragon',
}

/** 完整圖鑑：魔物圖鑑 / 稀有寶物（彩珠 + 戰利品）/ 貓咪裝束 */
export function DexView() {
  const [tab, setTab] = useState<Tab>('monster')
  const bestiary = useGame((s) => s.bestiary)
  const dexSeen = useGame((s) => s.dexSeen)
  const trophies = useGame((s) => s.trophies)
  const costumes = useGame((s) => s.costumes)
  const equipped = useGame((s) => s.equipped)

  const mFound = MONSTER_DEX.filter((m) => (bestiary[m.id] ?? 0) > 0 || dexSeen[m.id]).length
  const tFound = TROPHIES.filter((t) => trophies[t.id]).length
  const oFound = ORB_DEX.filter((o) => (bestiary[ORB_COUNT_KEY[o.id]] ?? 0) > 0).length
  const cFound = COSTUMES.filter((c) => costumes[c.id]).length

  return (
    <motion.div className="panel" {...panelMotion}>
      <div className="panel-inner">
        <div className="panel-head">
          <button className="back" onClick={() => useGame.getState().closePanel()}>
            ← 返回
          </button>
          <h2>📖 圖鑑</h2>
          <span className="chip">{mFound + oFound + tFound + cFound}/{MONSTER_DEX.length + ORB_DEX.length + TROPHIES.length + COSTUMES.length}</span>
        </div>

        <div className="nest-tabs">
          {([['monster', `魔物圖鑑 ${mFound}/${MONSTER_DEX.length}`], ['treasure', `稀有寶物 ${oFound + tFound}/${ORB_DEX.length + TROPHIES.length}`], ['costume', `貓咪裝束 ${cFound}/${COSTUMES.length}`]] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { audio.click(); setTab(id) }}>
              {label}
            </button>
          ))}
        </div>

        <div className="dex-body">
          {tab === 'monster' && (
            <div className="dex-grid">
              {MONSTER_DEX.map((m) => {
                const kills = bestiary[m.id] ?? 0
                const seen = kills > 0 || dexSeen[m.id]
                return (
                  <div key={m.id} className={`dex-card${seen ? '' : ' locked'}${m.boss ? ' boss' : ''}`}>
                    <div className="dex-art">
                      <Sprite name={m.sprite} />
                    </div>
                    <b>{seen ? m.name : '？？？'}</b>
                    <small>{seen ? m.desc : '尚未遭遇。每推 100m 就會遇到 1 隻魔物。'}</small>
                    <em>{kills > 0 ? `已擊敗 ×${kills}` : seen ? '已遭遇' : '未發現'}</em>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'treasure' && (
            <>
              <h3 className="dex-sub">元素珠 / 彩球（推落正門次數）</h3>
              <div className="dex-grid">
                {ORB_DEX.map((o) => {
                  const n = bestiary[ORB_COUNT_KEY[o.id]] ?? 0
                  return (
                    <div key={o.id} className={`dex-card${n > 0 ? '' : ' locked'}`}>
                      <div className="dex-art sm">
                        <Sprite name={o.id} />
                      </div>
                      <b>{n > 0 ? o.name : '？？？'}</b>
                      <small>{n > 0 ? o.desc : '射中齒輪外環或中央光圈，有機會掉落。'}</small>
                      <em>{n > 0 ? `推落 ×${n}` : '未發現'}</em>
                    </div>
                  )
                })}
              </div>
              <h3 className="dex-sub">戰利品（永久被動）</h3>
              <div className="dex-grid">
                {TROPHIES.map((t) => {
                  const has = trophies[t.id]
                  return (
                    <div key={t.id} className={`dex-card${has ? ' got' : ' locked'}`}>
                      <div className="dex-art sm">
                        <Sprite name={t.id} />
                      </div>
                      <b>{has ? t.name : '？？？'}</b>
                      <small>{has ? t.perk : `解鎖：${t.how}`}</small>
                      <em>{has ? '已解鎖 ✓' : '未解鎖'}</em>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {tab === 'costume' && (
            <div className="dex-grid">
              {COSTUMES.map((c) => {
                const has = costumes[c.id]
                return (
                  <div key={c.id} className={`dex-card${has ? ' got' : ' locked'}`}>
                    <div className="dex-art sm">
                      <Sprite name={COSTUME_SPRITE[c.id]} />
                    </div>
                    <b>{c.name}</b>
                    <small>{c.desc} · 增益：{c.buff}</small>
                    <em>{has ? (equipped.includes(c.id) ? '已穿戴' : '已擁有') : `⭐ ${c.cost} 積分（貓窩兌換）`}</em>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
