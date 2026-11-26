import { panelMotion } from './panelMotion'
import { useState } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { PRIZES, PRIZE_MAP, type Prize } from '../data/prizes'
import { useGame } from '../store/gameStore'
import { audio } from '../utils/AudioFX'
import { PrizeArt } from './PrizeArt'
import { Icon } from './Icon'

const CONFIRM_FROM = 300 // 呢個積分以上要二次確認（兌換唔可還原）

function Card({ prize }: { prize: Prize }) {
  const points = useGame((s) => s.points)
  const owned = useGame((s) => s.owned[prize.id] ?? 0)
  const [confirm, setConfirm] = useState(false)

  const full = prize.kind === 'collectible' && owned >= (prize.limit ?? 1)
  const short = points < prize.cost
  const disabled = prize.comingSoon || full

  const redeem = () => {
    const r = useGame.getState().buyPrize(prize.id)
    setConfirm(false)
    if (r.ok) {
      audio.buy()
      if (prize.kind === 'collectible') void confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, zIndex: 300 })
    } else audio.error()
    useGame.getState().showToast(r.msg)
  }

  const onClick = () => {
    audio.click()
    if (disabled) return
    if (short) {
      audio.error()
      useGame.getState().showToast(`積分唔夠（仲差 ${prize.cost - points}）`)
      return
    }
    if (prize.cost >= CONFIRM_FROM && !confirm) setConfirm(true)
    else redeem()
  }

  return (
    <div className={`prize${full ? ' owned' : ''}${prize.comingSoon ? ' soon' : ''}`}>
      <PrizeArt prize={prize} size={76} />
      <b>{prize.name}</b>
      <small>{prize.desc}</small>
      {confirm ? (
        <div className="prize-confirm">
          <span>確認用 {prize.cost} 積分兌換？</span>
          <div>
            <button className="primary" onClick={redeem}>
              確認
            </button>
            <button onClick={() => setConfirm(false)}>取消</button>
          </div>
        </div>
      ) : (
        <button className={`prize-btn${short && !disabled ? ' short' : ''}`} onClick={onClick} disabled={disabled}>
          {prize.comingSoon ? '即將開放' : full ? '已擁有 ✓' : <><Icon name="ui_star" /> {prize.cost}</>}
        </button>
      )}
    </div>
  )
}

export function ShopView() {
  const tab = useGame((s) => s.shopTab)
  const points = useGame((s) => s.points)
  const tickets = useGame((s) => s.tickets)
  const owned = useGame((s) => s.owned)

  const mine = Object.entries(owned)
    .map(([id, n]) => ({ prize: PRIZE_MAP[id], n }))
    .filter((x) => x.prize)

  const setTab = (t: 'exchange' | 'mine') => {
    audio.click()
    useGame.setState({ shopTab: t })
  }

  return (
    <motion.div className="panel" {...panelMotion}>
      <div className="panel-inner">
        <div className="panel-head">
          <button className="back" onClick={() => useGame.getState().closePanel()}>
            ← 返回
          </button>
          <h2>🎁 獎品兌換</h2>
          <span className="chip"><Icon name="ui_star" /> {points}</span>
        </div>

        <div className="tabs">
          <button className={tab === 'exchange' ? 'on' : ''} onClick={() => setTab('exchange')}>
            兌換
          </button>
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
            我嘅獎品 {mine.length > 0 && `(${mine.length})`}
          </button>
          <span className="tabs-tix"><Icon name="ui_ticket" /> {tickets}</span>
        </div>

        {tab === 'exchange' ? (
          <>
            <p className="panel-note">用小遊戲同推幣賺嘅積分兌換。收藏品每件只可擁有一件。</p>
            <div className="prize-grid">
              {PRIZES.map((p) => (
                <Card key={p.id} prize={p} />
              ))}
            </div>
          </>
        ) : mine.length === 0 ? (
          <p className="panel-note empty">仲未有獎品。玩小遊戲賺積分，去「兌換」睇下！</p>
        ) : (
          <div className="prize-grid">
            {mine.map(({ prize }) => (
              <div className="prize owned" key={prize.id}>
                <PrizeArt prize={prize} size={76} />
                <b>{prize.name}</b>
                <small>{prize.desc}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
