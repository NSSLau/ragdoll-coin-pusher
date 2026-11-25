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

- 貓耳炮左右擺動；撳「發射」掣 / 畫面 / 空白鍵射幣，按住連發，TURBO 自動連發
- 每射 25 幣，魔法陣出現並自動疊出 18 層高塔
- JP1：白金幣跌出 · JP2：金磚跌出 · JP3：同一棟塔跌出 12 隻幣
