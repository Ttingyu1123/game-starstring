# STARSTRING 星弦

**直接玩：https://game-starstring.tingyudeco.com/**

單指重力彈弓街機。你是一顆彗星：**按住**勾住最近的天體繞行，**放開**把自己甩出去。

- 繞得越久軌道越小、速度越快（角動量守恆），但也越接近墜毀。
- 黑洞也能勾：加速最猛，也最快掉進視界。
- 下方的虛空會越追越快，原地繞圈太久就會被吞掉。
- 每天一張全球相同的「今日星系」；網址加 `?seed=任意文字` 可指定星圖。
- 死亡後下一局會出現你在這張星圖最佳紀錄的幽靈彗星。

所有畫面與聲音都是程式即時產生的，專案裡沒有任何圖片或音檔素材。

玩家看的完整規則與訣竅在 [docs/MANUAL.md](docs/MANUAL.md)。

## 開發

```
npm install
npm run dev        # http://localhost:57317
npm run typecheck
npm test           # 單元測試＋6 個種子的可通關性
npm run solve      # 完整驗收：機器人在 200 個種子上都要存活 60 秒（約 7 分鐘）
npm run build
npm run e2e        # 需先 build；用本機 Chrome 實際玩一輪，截圖在 e2e/out/
```

## 部署

推到 `main` 就會由 [.github/workflows/deploy.yml](.github/workflows/deploy.yml) 自動跑型別檢查、單元測試、建置，然後發布到 GitHub Pages。

- 正式網址是 `game-starstring.tingyudeco.com`：Cloudflare 上一筆 CNAME 指向 `ttingyu1123.github.io`，Proxy 必須關閉（DNS only），否則 GitHub 發不出 HTTPS 憑證。
- 自訂網域設在 repo 的 Pages 設定裡，不需要 `CNAME` 檔。舊網址 `ttingyu1123.github.io/game-starstring/` 會自動轉到正式網址。
- `vite.config.ts` 的 `base` 是 `./`，所以放在子路徑或網域根目錄都能運作，換網址不用改程式。
- 最高分與幽靈紀錄存在瀏覽器的 localStorage，跟著網址走；換網址等於玩家的紀錄歸零。
- CI 用 `npm install` 而不是 `npm ci`：鎖定檔在 Windows 產生，缺少 Linux 專用的選用套件，`npm ci` 會拒絕它。
- CI 沒有跑 `npm run solve` 和 `npm run e2e`，動到難度或畫面時請在本機跑。

## 架構

| 路徑 | 內容 |
|---|---|
| `src/sim/` | 純函式、固定步長（120 Hz）的確定性模擬，不依賴 DOM。`step(state, hold, world)` 是唯一的規則來源。 |
| `src/sim/bot.ts` | 只透過 `step()` 前瞻規劃的機器人，用於可通關性驗收與標題畫面的示範局。 |
| `src/gfx/` | Three.js（WebGL2）繪圖：背景星雲與黑洞透鏡、恆星、彗尾、粒子、bloom。 |
| `src/audio.ts` | Web Audio 即時合成的配樂與音效；聲部隨連擊加入，繞行時依角速度彈琶音。 |
| `src/ghost.ts` | 以「輸入翻轉點」記錄一局，重播成幽靈。 |

## 調整難度時

改 `src/sim/config.ts` 或 `src/sim/world.ts` 之後一定要跑 `npm run solve`。
開發過程中它抓到過兩個讓地圖出現必死局的設計問題（見 config 裡 `HOLE_X_RANGE` 的註解），單元測試都看不出來。
