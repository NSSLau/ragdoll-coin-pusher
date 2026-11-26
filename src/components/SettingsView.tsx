import { useState } from 'react'
import { motion } from 'framer-motion'
import { panelMotion } from './panelMotion'
import { APP_VERSION, DRAGON_MAX, FEVER_SECONDS, RELIEF_AMOUNT, RELIEF_COOLDOWN, SAVE_KEYS, SHOT_COST, TASK_AMOUNT, TASK_COOLDOWN, useGame, type Settings } from '../store/gameStore'
import { IRIS_UNLOCK_S } from '../engine/GearPortal'
import { audio } from '../utils/AudioFX'

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`set-toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        audio.click()
        onChange(!on)
      }}
    >
      <i />
    </button>
  )
}

function Slider({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  return (
    <input
      className="set-slider"
      type="range"
      min={0}
      max={100}
      step={5}
      aria-label={label}
      disabled={disabled}
      value={Math.round(value * 100)}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      style={{ ['--p' as string]: `${Math.round(value * 100)}%` }}
    />
  )
}

/** 遊戲設定：聲音（BGM / SFX 獨立）、震動、畫質、玩法說明、版本、重置存檔（二次確認） */
export function SettingsView() {
  const s = useGame((st) => st.settings)
  const set = (p: Partial<Settings>) => useGame.getState().setSettings(p)
  const [confirm, setConfirm] = useState(0) // 0 未撳；1 第一次確認；2 最後確認
  const [help, setHelp] = useState(false)

  const reset = () => {
    if (confirm < 2) {
      audio.click()
      setConfirm(confirm + 1)
      return
    }
    try {
      for (const k of SAVE_KEYS) localStorage.removeItem(k)
    } catch {
      /* 私隱模式 */
    }
    window.location.reload()
  }

  return (
    <motion.div className="panel" {...panelMotion}>
      <div className="panel-inner">
        <div className="panel-head">
          <button className="back" onClick={() => useGame.getState().closePanel()}>
            ← 返回
          </button>
          <h2>⚙️ 設定</h2>
          <span className="chip">{APP_VERSION}</span>
        </div>

        <div className="set-list">
          <section className="set-card">
            <h3>🔊 聲音</h3>
            <div className="set-row">
              <span>背景音樂</span>
              <Toggle label="背景音樂" on={s.bgmOn} onChange={(v) => set({ bgmOn: v })} />
            </div>
            <Slider label="背景音樂音量" value={s.bgmVol} disabled={!s.bgmOn} onChange={(v) => set({ bgmVol: v })} />
            <div className="set-row">
              <span>遊戲音效</span>
              <Toggle label="遊戲音效" on={s.sfxOn} onChange={(v) => set({ sfxOn: v })} />
            </div>
            <Slider label="遊戲音效音量" value={s.sfxVol} disabled={!s.sfxOn} onChange={(v) => { set({ sfxVol: v }); audio.click() }} />
          </section>

          <section className="set-card">
            <h3>📳 手感與效能</h3>
            <div className="set-row">
              <span>震動回饋</span>
              <Toggle label="震動回饋" on={s.haptics} onChange={(v) => { set({ haptics: v }); if (v) useGame.getState().buzz(30) }} />
            </div>
            <div className="set-row">
              <span>畫質模式</span>
              <div className="set-seg">
                {([['high', '高畫質光影'], ['saver', '流暢省電']] as const).map(([q, label]) => (
                  <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => { audio.click(); set({ quality: q }) }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <small className="set-note">流暢省電：關閉金幣投影、降低解像度，舊手機更順。</small>
          </section>

          <section className="set-card">
            <h3>📖 資訊與存檔</h3>
            <button className="set-btn" onClick={() => { audio.click(); setHelp(!help) }}>
              {help ? '收起玩法說明' : '玩法說明'}
            </button>
            {help && (
              <ul className="set-help">
                <li>🎯 撳畫面左 / 中 / 右三分一射幣。左右線瞄準齒輪外環洞口經過嘅定位點（藍：築塔；金：築塔 ×2；紫：運氣值），洞口對正嗰刻射入就穿環充能。</li>
                <li>🔒 中央光圈預設上鎖（射中央只會彈開）。外環命中後解鎖 {IRIS_UNLOCK_S} 秒，期間射入中央 = 空間折疊：按充能層數（1～3）分裂成稀有金幣，Boss 傷害同倍數；之後光圈重新上鎖。</li>
                <li>💰 單發 1× 扣 {SHOT_COST} 幣、3× 扣 {SHOT_COST * 3} 幣、5× 扣 {SHOT_COST * 5} 幣。推落正門：銀幣 +1、金幣 +5、金磚 +15（可用幣）。</li>
                <li>🚪 前緣正中 65% 係黃金派彩正門；左右兩側各 17.5% 係回收槽，幣會即刻回收、唔計幣（每 4 枚僅 +1 運氣值）。</li>
                <li>🏗️ 命中令右上角築塔台疊起「50 枚梅花螺旋塔」（35 銀 + 15 金，共值 110 幣），疊滿推入池中央，要等推板撞擊先會倒。</li>
                <li>🔮 射中外環 / 光圈有機會掉落實體彩珠：火 / 水 / 雷元素珠、七星龍珠、彩虹神秘彩球，隨推板推向黃金正門。</li>
                <li>🐉 七星龍珠推落正門點亮機背燈陣 1 盞；集滿 {DRAGON_MAX} 盞觸發 {FEVER_SECONDS} 秒 SUPER FEVER（推板加速、金銀幣雨 25 枚、命中積分翻倍）。</li>
                <li>⚔️ 每 100m 出 1 隻元素魔物（每 5 隻有 1 隻 Boss）。水克火、火克雷、雷克水：克制 3.0× 暴擊破盾，同屬性 0.3×；七星龍珠係全屬性必殺。</li>
                <li>🌈 彩虹神秘彩球推落正門 → 即開「彩虹命運轉盤」或「皇家猜大細」。</li>
                <li>🏠 布偶貓小窩：每日任務、成就、用積分換裝束，裝備有實戰增益；戰利品架上嘅戰利品有永久被動。</li>
                <li>👑 冇可用幣？皇家金庫每 {RELIEF_COOLDOWN / 60000} 分鐘送 {RELIEF_AMOUNT} 幣，貓爪任務每 {TASK_COOLDOWN / 60000} 分鐘可領 {TASK_AMOUNT} 幣。</li>
              </ul>
            )}
            <div className="set-row">
              <span>版本</span>
              <b>{APP_VERSION}</b>
            </div>
            <button className={`set-btn danger${confirm ? ' armed' : ''}`} onClick={reset}>
              {confirm === 0 ? '重置存檔' : confirm === 1 ? '確定？所有金幣、券、成就會清空' : '最後確認：立即重置'}
            </button>
            {confirm > 0 && (
              <button className="set-btn" onClick={() => { audio.click(); setConfirm(0) }}>
                取消
              </button>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  )
}
