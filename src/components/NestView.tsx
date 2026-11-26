import { panelMotion } from './panelMotion'
import { lazy, Suspense, useState } from 'react'
import { motion } from 'framer-motion'
import { ACHS, COSTUMES, DAILY, TIERS, type Reward2 } from '../data/progress'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { Icon } from './Icon'
const PetRoom = lazy(() => import('./PetRoom'))

type Tab = 'daily' | 'ach' | 'costume'

const rewardText = (r: Reward2) =>
  [r.credits ? `金幣 +${r.credits}` : '', r.points ? `積分 +${r.points}` : '', r.tickets ? `🎟️ +${r.tickets}` : ''].filter(Boolean).join(' · ')

/** 布偶貓小窩：每日任務、四階成就、布偶貓裝束（用券兌換；美術 pet_* 之後接入） */
export function NestView() {
  const [tab, setTab] = useState<Tab>('daily')
  const tickets = useGame((s) => s.tickets)
  const daily = useGame((s) => s.daily)
  const stats = useGame((s) => s.stats)
  const ach = useGame((s) => s.ach)
  const costumes = useGame((s) => s.costumes)
  const equipped = useGame((s) => s.equipped)
  const [beat, setBeat] = useState(0)
  const [treat, setTreat] = useState(0)
  const cheer = () => setBeat((n) => n + 1) // 領取 / 換裝 → 貓慶祝（跳 + 愛心）

  return (
    <motion.div className="panel" {...panelMotion}>
      <div className="panel-inner">
        <div className="panel-head">
          <button className="back" onClick={() => useGame.getState().closePanel()}>
            ← 返回
          </button>
          <h2>🏠 布偶貓小窩</h2>
          <span className="chip chip-cur"><Icon name="ui_ticket" /><b>{tickets}</b></span>
        </div>

        <div className="nest-3d">
          <Suspense fallback={<div className="nest-3d-loading">載入貓屋…</div>}>
            <PetRoom equipped={equipped} cheer={beat} treat={treat} />
          </Suspense>
          <button
            className="nest-feed"
            onClick={() => {
              audio.click()
              setTreat((n) => n + 1)
            }}
          >
            🐟 餵食零食
          </button>
          <span className="nest-3d-hint">點擊 / 滑動撫摸貓咪</span>
        </div>

        <div className="nest-tabs">
          {([['daily', '每日任務'], ['ach', '成就'], ['costume', '裝束']] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { audio.click(); setTab(id) }}>
              {label}
            </button>
          ))}
        </div>

        <div className="nest-list">
          {tab === 'daily' &&
            DAILY.map((d, i) => {
              const done = daily.claimed[i] ?? 0
              const st = d.stages[Math.min(2, done)]
              const v = Math.min(st.goal, daily[d.key])
              const ok = done < 3 && daily[d.key] >= st.goal
              return (
                <div key={d.id} className="nest-row">
                  <div className="nest-main">
                    <b>{d.name} <em className="nest-stage">階段 {Math.min(3, done + 1)}/3</em></b>
                    <div className="nest-bar"><i style={{ width: `${(v / st.goal) * 100}%` }} /></div>
                    <small>{done >= 3 ? '今日已全部完成 🏆' : `${v}/${st.goal} · 獎勵 ${rewardText(st.reward)}`}</small>
                  </div>
                  <button className="nest-go" disabled={!ok} onClick={() => { audio.ticket(); useGame.getState().claimDaily(i); cheer() }}>
                    {done >= 3 ? '完成' : ok ? '領取' : '進行中'}
                  </button>
                </div>
              )
            })}

          {tab === 'ach' &&
            ACHS.map((a) => {
              const val = stats[a.key]
              const have = a.tiers.filter((t) => val >= t).length
              const done = ach[a.id] ?? 0
              const next = a.tiers[Math.min(3, done)]
              return (
                <div key={a.id} className="nest-row">
                  <div className="nest-main">
                    <b>{a.emoji} {a.name}</b>
                    <div className="nest-tiers">
                      {TIERS.map((t, i) => (
                        <i key={t.name} className={i < done ? 'got' : i < have ? 'ready' : ''} style={{ background: i < done || i < have ? t.color : undefined }} title={`${t.name}階 ${a.tiers[i]}`} />
                      ))}
                    </div>
                    <small>
                      {done >= 4 ? '全部達成 🏆' : `${val}/${next}（${TIERS[done].name}階 · 獎勵 積分 +${TIERS[done].points}${TIERS[done].tickets ? ` · 🎟️ +${TIERS[done].tickets}` : ''}）`}
                    </small>
                  </div>
                  <button className="nest-go" disabled={have <= done} onClick={() => { audio.ticket(); useGame.getState().claimAch(a.id); cheer() }}>
                    {have > done ? '領取' : done >= 4 ? '完成' : '進行中'}
                  </button>
                </div>
              )
            })}

          {tab === 'costume' &&
            COSTUMES.map((c) => {
              const has = costumes[c.id]
              const on = equipped.includes(c.id)
              return (
                <div key={c.id} className="nest-row">
                  <span className="nest-emoji">{c.emoji}</span>
                  <div className="nest-main">
                    <b>{c.name}</b>
                    <small>{c.desc} · 增益：{c.buff}</small>
                  </div>
                  <button
                    className="nest-go"
                    onClick={() => {
                      if (has) {
                        audio.click()
                        useGame.getState().toggleEquip(c.id)
                      } else {
                        audio.buy()
                        useGame.getState().buyCostume(c.id)
                      }
                      cheer()
                    }}
                  >
                    {has ? (on ? '卸下' : '裝備') : `🎟️ ${c.cost}`}
                  </button>
                </div>
              )
            })}
        </div>
      </div>
    </motion.div>
  )
}
