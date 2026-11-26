// 經濟模擬：先 `npm run dev -- --port 5199`，再 `NODE_PATH=<playwright 所在 node_modules> node scripts/economy-sim.cjs <novice|casual|skilled|spammer> 300`
// 每發成本 = SHOT_COST（目前 2）；改 SHOT_COST 時要同步改下面 st.credits / 2
const { chromium } = require('playwright')
const prof = process.argv[2]
const secs = +(process.argv[3] || 300)
const seed = +(process.argv[4] || 1)
;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } })
  page.on('pageerror', (e) => { if (!/hdr/.test(e.message)) console.log('PAGEERR', e.message) })
  await page.goto('http://127.0.0.1:5199/ragdoll-coin-pusher/')
  await page.waitForTimeout(2500)
  await page.evaluate(() => { localStorage.clear(); window.__game.setState({ credits: 150 }); window.__game.getState().goGame() })
  await page.waitForFunction(() => window.__eng && window.__eng(), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  await page.evaluate((prof) => {
    const e = window.__eng(), g = window.__game
    const S = (window.__S = { prof, t: 0, lock: 0, react: 0, broke: 0, wasBroke: false, reliefAt: -1e9, taskAt: -1e9, spec: {}, minC: 1e9, maxC: 0, shots: 0, miniCredits: 0, miniPoints: 0, tl: [] })
    const rnd = (a) => a[Math.floor(Math.random() * a.length)]
    const WHEEL = [{ credits: 10 }, { points: 40 }, { tickets: 1 }, { luck: 30 }, { dock: 15 }, { credits: 25 }, { points: 100 }, { tickets: 2 }]
    const EGGS = [{ credits: 12 }, { tickets: 2, points: 30 }, { points: 120 }]
    const CARDS = [{ credits: 10 }, { credits: 25 }, { points: 60 }, { luck: 40 }, { dock: 15 }, { tickets: 1 }]
    const hl = () => { let w = 0; while (w < 4 && Math.random() < 0.5) w++; if (w >= 1 && Math.random() < 0.5) {} ; return { credits: 15 * 2 ** w, points: 50 * 2 ** w } }
    // 玩家喺贏 1~2 次後收錢；估算：每次翻倍 50% 贏，唔貪
    const hl2 = () => { const w = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 1 : 2; const ok = Math.random() < 0.5 ** Math.max(1, w); return ok ? { credits: 15 * 2 ** w, points: 50 * 2 ** w } : { points: 10 } }
    e.events.onSpecial = (kind) => {
      S.spec[kind] = (S.spec[kind] || 0) + 1
      const r = kind === 'rainbow' ? rnd(WHEEL) : kind === 'gacha' ? rnd(EGGS) : kind === 'bell' ? rnd(CARDS) : hl2()
      S.miniCredits += r.credits || 0; S.miniPoints += r.points || 0
      g.getState().grantReward(r)
      const fx = g.getState().takeFx(); if (fx.dock) e.feedDock(fx.dock); if (fx.gem) { e.feedDock(15); e.dropSpecial('gem') }
    }
    window.__tick = (chunk) => {
      const tx = [-1.5, 0, 1.5]
      const gn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
      for (let i = 0; i < chunk * 60; i++) {
        e.update(1 / 60); S.t += 1 / 60
        const st = g.getState()
        S.minC = Math.min(S.minC, st.credits); S.maxC = Math.max(S.maxC, st.credits)
        if (Math.floor(S.t) % 60 === 0 && !S.tl[Math.floor(S.t / 60)]) S.tl[Math.floor(S.t / 60)] = Math.round(st.credits)
        if (S.t < S.lock) continue
        let mode = 1, lane = null
        const aim = (sig, lead, sideOnly) => { const gx = Math.sin((e.time + 0.6 + lead) * 1.3) * 1.9 + gn() * sig; for (let k = 0; k < 3; k++) { if (sideOnly && k === 1) continue; if (Math.abs(gx - tx[k]) < 0.08) return k - 1 } return null }
        if (S.prof === 'novice') { if (S.t < S.react) continue; mode = Math.random() < 0.12 ? 3 : 1; lane = aim(0.6, 0, false); if (lane !== null) S.react = S.t + 0.3 + Math.random() * 0.7 }
        else if (S.prof === 'casual') { mode = 1; lane = aim(0.35, 0, false) }
        else if (S.prof === 'skilled') { mode = 3; lane = aim(0.2, 0.11, true) }
        else { mode = Math.random() < 0.5 ? 3 : 5; lane = Math.floor(Math.random() * 3) - 1 }
        if (lane === null) continue
        const n = Math.min(mode, Math.floor(st.credits / 2))
        if (n < 1) {
          if (!S.wasBroke) { S.broke++; S.wasBroke = true }
          // 補給：金庫每 600s +50、貓爪任務每 180s +30
          if (S.t - S.reliefAt >= 600) { S.reliefAt = S.t; g.getState().addCredits(50) } else if (S.t - S.taskAt >= 180) { S.taskAt = S.t; g.getState().addCredits(30) }
          continue
        }
        S.wasBroke = false
        if (!st.spend(n).ok) continue
        for (let k = 0; k < n; k++) e.shoot(lane, k * 0.11)
        S.lock = S.t + (n - 1) * 0.11 + 0.45
      }
      const s = g.getState()
      return { t: Math.round(S.t), credits: Math.round(s.credits), shots: s.shots, hits: s.gateHits, pts: s.points, tickets: s.tickets, broke: S.broke, spec: S.spec, miniCredits: S.miniCredits, minC: Math.round(S.minC), maxC: Math.round(S.maxC), tl: S.tl }
    }
  }, prof)
  let r
  for (let c = 0; c < secs / 20; c++) r = await page.evaluate(() => window.__tick(20))
  console.log(prof, JSON.stringify(r))
  await browser.close()
})()
