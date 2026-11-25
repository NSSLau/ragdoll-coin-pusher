# 皇家海雙布偶馬戲團 · 3D 推幣機（Phase 1）

Vite + React + TypeScript + React Three Fiber + Rapier3D。

## 開發

```bash
npm install
npm run dev      # http://localhost:5173/ragdoll-coin-pusher/
npm run build    # 輸出 dist/
```

## 部署（GitHub Pages）

- `vite.config.ts` 已設 `base: '/ragdoll-coin-pusher/'`
- push 到 `main` 會觸發 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` → 部署 `dist`
- **首次要手動設定一次**：repo → Settings → Pages → Source 揀 **GitHub Actions**

所有素材路徑都用 `${import.meta.env.BASE_URL}assets/xxx.jpeg`（見 `src/utils/SpriteAtlas.ts`）。

## 素材（`public/assets/`）

| 檔案 | 內容 |
|---|---|
| `ragdoll-atlas-1.jpeg` | 4x4：海雙布偶主角、貓爪金幣、大小球、大輪盤、粉紅貓爪掣 |
| `ragdoll-atlas-2.jpeg` | 4x4：擴充動作、金磚/白金幣/寶箱、貓耳 UI 框、閃電掣 |
| `ragdoll-atlas-3.jpeg` | 4x4：第 1 行 3D 無縫貼圖；其餘貓耳大炮、魔法陣、進度條等 |
| `lobby-assets-atlas.jpeg` | 大廳主題徽章、牌匾、綠色開始掣、導航圖示 |
| `lobby-bg-universal.jpeg` | 1:1 大廳背景 |
| `tablet-ambient-backdrop.jpeg` | 16:9 遊戲中全景背景 |
| `cabinet-frame-9x16.jpeg` | 9:16 街機機框 |

## 去背

4x4 精靈圖切片用由每格四條外邊緣向內擴散嘅 BFS Flood-Fill（`R,G,B > 235`，1–2px 羽化），
只清走同邊緣連通嘅白色，所以布偶貓白毛臉、胸口唔會被誤去除。

## 玩法

- 第一身視角：撳「發射」掣 / 畫面 / 空白鍵，由面前射幣飛向背板；背板有個左右移動嘅缺口
- 射中缺口：缺口掉落金幣（正中更多運氣值）；射唔中：幣跌返落下面推幣檯
- 運氣值：命中 +5（正中 +7）、射唔中 +1；滿 100 喺中間生成金幣高塔。每 3 次命中送 1 張小遊戲券，連中每 3 次有 Bonus
- 兩層推幣：幣落喺會前後郁嘅上層推板，固定擋板刮落下層；前緣斜坡，中間派彩口、兩側邊溝唔派彩
- JP1/2/3：白金幣／金磚跌出、塔倒 12 隻，以機率中獎（12% / 15% / 3%）

## 小遊戲 / 積分 / 獎品

- **小遊戲**（`src/minigames/`）：貓爪急擊、幸運輪盤、扭蛋狂搖。只由玩家主動開，撳「開始」先扣 1 張券；局內有倒數，局外冇任何時間壓力；入去後推幣機完全暫停
- **小遊戲券**：開局送 3 張；每疊一次塔 +1、每射 100 幣 +1、JP2/JP3 +1；上限 20
- **積分**：小遊戲結算（有保底）、疊塔 +10、爆幣 +5/10/15、JP1/2/3 +20/50/150
- **獎品**：資料喺 `src/data/prizes.ts`（金幣袋、小遊戲券、收藏品），兌換 ≥300 積分會二次確認

## 獎品素材接入（遲啲畫都得，程式零改動）

1. 將圖放入 `public/assets/prizes/<id>.png`（建議 512×512 透明 PNG）
2. 喺 `src/data/prizes.ts` 對應獎品加 `art: true`

未加之前用 emoji + 顏色佔位，唔會有 404 請求。

| id | 名稱 | id | 名稱 |
|---|---|---|---|
| `coins_s` | 金幣袋（小） | `ring_rainbow` | 彩虹圈戒 |
| `coins_l` | 金幣袋（大） | `cape_royal` | 王者斗篷貓 |
| `tickets_3` | 小遊戲券 ×3 | `trophy_paw` | 金色貓爪獎盃 |
| `badge_crown` | 皇冠貓徽章 | `chest_cat` | 神秘寶箱貓 |
| `doll_wizard` | 魔法師貓公仔 | `doll_rocket` | 火箭貓公仔 |

## 音效

全部 Web Audio 即時合成（`src/utils/AudioFX.ts`），冇音檔：射幣、幣落地碰撞、推板機械運轉聲（跟速度）、幣堆磨擦聲（跟活動量）、推板轉向撞擊、吞幣（按價值分層）、爆幣 ×3 級、塔倒塌、疊塔逐層音階、魔法陣、Jackpot，以及小遊戲同兌換音效。
