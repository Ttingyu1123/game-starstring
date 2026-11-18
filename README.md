# STARSTRING 星弦

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
