const { chromium } = require('playwright')
const prof = process.argv[2]
const secs = +(process.argv[3] || 300)
const MODE = +(process.argv[5] || 1)
const seed = +(process.argv[4] || 1)
;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } })
  page.on('pageerror', (e) => { if (!/hdr/.test(e.message)) console.log('PAGEERR', e.message) })
  await page.goto('http://127.0.0.1:5199/ragdoll-coin-pusher/')
  await page.waitForTimeout(2500)
  await page.evaluate(() => { localStorage.clear(); window.__game.setState({ credits: 120 }); window.__game.getState().goGame() })
  await page.waitForFunction(() => window.__eng && window.__eng(), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  await page.evaluate((prof) => {
    const e = window.__eng(), g = window.__game
    const S = (window.__S = { prof, t: 0, lock: 0, react: 0, broke: 0, wasBroke: false, reliefAt: -1e9, taskAt: -1e9, spec: {}, fevers: 0, firstFever: null, feverCoins: 0, feverEnd: 0, minC: 1e9, maxC: 0, shots: 0, miniCredits: 0, miniPoints: 0, tl: [] })
    const rnd = (a) => a[Math.floor(Math.random() * a.length)]
    const WHEEL = [{ credits: 8 }, { points: 40 }, { points: 80 }, { luck: 30 }, { dock: 30 }, { gold: 1 }, { points: 100 }, { gold: 3 }, { credits: 12 }, { points: 60 }, { gold: 2 }, { dock: 16 }]
    const hl2 = () => { const w = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 1 : 2; const ok = Math.random() < 0.5 ** Math.max(1, w); return ok ? { credits: 10 * 2 ** w, points: 50 * 2 ** w } : { points: 10 } }
    S.coll = { silver: 0, gold: 0, bar: 0, comp: 0, gut: 0, towers: 0, spent: 0 }
    const oc = e.events.onCollect; e.events.onCollect = (k, v) => { S.coll[k] += v; if (S.t < S.feverEnd) S.feverCoins += v; oc(k, v) }
    const ocm = e.events.onCompress; e.events.onCompress = (n) => { S.coll.comp += n; ocm(n) }
    const og = e.events.onGutter; e.events.onGutter = () => { S.coll.gut++; og() }
    const ot = e.events.onTowerSpawn; e.events.onTowerSpawn = () => { S.coll.towers++; ot() }
    // 彩珠落袋：mystery = 轉盤 55% / 猜大細 45%；dragon = 燈陣 +1，集滿 7 盞 FEVER（15 秒）；元素珠對經濟冇直接影響
    e.events.onSpecial = (kind) => {
      S.spec[kind] = (S.spec[kind] || 0) + 1
      if (kind === 'dragon') {
        if (g.getState().addDragon()) { S.fevers++; if (S.firstFever === null) S.firstFever = Math.round(S.t); e.startFever(15); S.feverEnd = S.t + 15 }
        return
      }
      if (kind !== 'mystery') return
      const r = Math.random() < 0.55 ? rnd(WHEEL) : hl2()
      S.miniCredits += r.credits || 0; S.miniPoints += r.points || 0
      g.getState().grantReward(r)
      const fx = g.getState().takeFx(); if (fx.dock) e.feedDock(fx.dock); if (fx.gold) e.coinRain(0, fx.gold)
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
        // 玩家模型：預測 0.6s 後齒輪狀態（帶時間誤差 sig 秒），預測會中先射
        const aim = (sig, pc) => { const tp = e.time + 0.6 + gn() * sig; const order = pc ? [1, 0, 2].sort((a, b) => (a === 1 ? -1 : b === 1 ? 1 : Math.random() - 0.5)) : [0, 1, 2].sort(() => Math.random() - 0.5); for (const li of order) if (e.gateTest(li, tp).hit) return li - 1; return null }
        if (S.prof === 'novice') { if (S.t < S.react) continue; mode = Math.random() < 0.12 ? 3 : 1; lane = aim(0.9, false); if (lane !== null) S.react = S.t + 0.3 + Math.random() * 0.7 }
        else if (S.prof === 'casual') { mode = 1; lane = aim(0.5, true) }
        else if (S.prof === 'skilled') { mode = 3; lane = aim(0.2, true) }
        else { mode = Math.random() < 0.5 ? 3 : 5; lane = Math.floor(Math.random() * 3) - 1 }
        if (lane === null) continue
        const n = Math.min(mode, Math.floor(st.credits / 1))
        if (n < 1) {
          if (!S.wasBroke) { S.broke++; S.wasBroke = true }
          // 補給：金庫每 600s +50、貓爪任務每 180s +30
          if (S.t - S.reliefAt >= 180) { S.reliefAt = S.t; g.getState().addCredits(30) } else if (S.t - S.taskAt >= 60) { S.taskAt = S.t; g.getState().addCredits(30) }
          continue
        }
        S.wasBroke = false
        if (!st.spend(n).ok) continue
        const offs = { 1: [0], 3: [-0.1, 0, 0.1], 5: [-0.16, -0.08, 0, 0.08, 0.16] }[n] || [0]
        for (let k = 0; k < n; k++) e.shoot(lane, 0, { off: offs[k], mult: n, leader: k === 0 })
        S.lock = S.t + (n > 1 ? 0.45 : 0.25)
        S.nshots = (S.nshots || 0) + 1; if (n > 1) S.salvo = (S.salvo || 0) + 1
      }
      const s = g.getState()
      return { t: Math.round(S.t), credits: Math.round(s.credits), shots: s.shots, hits: s.gateHits, pts: s.points, broke: S.broke, coll: S.coll, vol: S.nshots, salvo: S.salvo || 0, spec: S.spec, fevers: S.fevers, firstFever: S.firstFever, feverCoins: S.feverCoins, dragons: s.dragons, miniCredits: S.miniCredits, minC: Math.round(S.minC), maxC: Math.round(S.maxC), tl: S.tl }
    }
  }, prof)
  let r
  for (let c = 0; c < secs / 20; c++) r = await page.evaluate(() => window.__tick(20))
  console.log(prof, JSON.stringify(r))
  await browser.close()
})()
