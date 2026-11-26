import { useState } from 'react'
import { motion } from 'framer-motion'
import { panelMotion } from './panelMotion'
import { APP_VERSION, SAVE_KEYS, useGame, type Settings } from '../store/gameStore'
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
                <li>🎯 撳畫面左 / 中 / 右三分一，對準移動窗口同後板缺口重疊嗰刻射幣，穿過就落金幣。</li>
                <li>💥 3× / 5× 齊射：一次過射出多枚，抓啱時機收益最大（3× 扣 5、5× 扣 8 金幣）。</li>
                <li>🪙 推板將金幣推落前方派彩槽先回收金幣；跌落兩邊邊溝唔計。</li>
                <li>🏗️ 命中會令右上角築塔台逐層疊高，滿咗會推入池中央。</li>
                <li>🎁 特殊道具推落派彩槽 → 觸發分支小遊戲領額外獎勵。</li>
                <li>🏠 布偶貓小窩：每日任務、成就、用券換裝束，裝備有實戰增益。</li>
                <li>👑 冇金幣？皇家金庫每 3 分鐘送 80 金幣，貓爪任務每分鐘可領 50。</li>
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
