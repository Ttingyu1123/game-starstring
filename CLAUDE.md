# STARSTRING 星弦

單指重力彈弓街機。Vite + TypeScript + Three.js（WebGL2）+ Web Audio，沒有任何圖片或音檔素材。
架構、指令、部署方式見 [README.md](README.md)，玩家規則見 [docs/MANUAL.md](docs/MANUAL.md)。

- 正式網址：https://game-starstring.tingyudeco.com/ （推到 `main` 自動部署）
- Repo：https://github.com/Ttingyu1123/game-starstring （公開）

## 在這個專案工作要知道的事

- **npm 指令用 PowerShell 跑**。在 Git Bash 裡 `npm test` 會有測試檔載入失敗（`reading 'config'`），不是程式的問題。
- **改 `src/sim/config.ts` 或 `src/sim/world.ts` 之後必跑 `npm run solve`**（200 個種子、約 7 分鐘）。它抓到過單元測試看不出來的必死地圖。
- **改畫面或聲音之後跑 `npm run build` 再 `npm run e2e`**，用本機 Chrome 實際玩一輪。CI 不跑這兩項。
- `src/sim/` 是確定性的純函式模擬，不可依賴 DOM、時間或 `Math.random`；幽靈重播和每日星圖都靠這一點。
- 音訊必須在使用者手勢的同一個同步任務內解鎖（`audio.unlock()` 在按下與放開時都呼叫），否則 iPhone 會無聲。

## 已定案、不要再翻的決定

- **配樂維持程式合成**。試過改用外部音樂檔（Suno 曲目）與高連擊脈動層，使用者在公開前決定改回合成配樂。這個 repo 是公開的，不要把有授權疑慮的音檔提交進來。
- **幽靈彗星維持不起眼的紫色小亮點**。做過加光環與標示的版本，使用者認為太搶眼、會干擾玩家，已還原；只保留開場那一行提示文字。
- **不重製任何既有遊戲**的名稱、角色、美術或關卡。
