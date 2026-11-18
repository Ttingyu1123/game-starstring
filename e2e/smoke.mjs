// 冒煙測試：對 build 後的 preview server 實際操作一輪。
// 用法：npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 57318;
const PAGE_URL = `http://localhost:${PORT}/?seed=e2e`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
/** 畫面取樣的下限：低於這些值代表場景幾乎沒畫出東西。 */
const MIN_LIT = 0.002;
const MIN_COLORFUL = 0.03;
/** 輸出 RMS 低於此值視為無聲。 */
const MIN_AUDIO_LEVEL = 0.003;
const TAP = [195, 500];

function assert(cond, message) {
  if (!cond) throw new Error(`斷言失敗：${message}`);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(PAGE_URL);
      if (res.ok) return;
    } catch {
      // server 尚未就緒，稍後重試
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server 未在 ${PAGE_URL} 啟動`);
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const stopServer = () => new Promise((resolve) => {
  // 被 kill 的行程 exitCode 仍是 null，要一併看 signalCode。
  if (server.exitCode !== null || server.signalCode !== null) return resolve();
  server.once('exit', resolve);
  server.kill();
});

let browser;
try {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
  // 刻意不加 --autoplay-policy=no-user-gesture-required：音訊必須靠真實的點擊手勢解鎖才算數。
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE_URL);

  assert((await page.title()).includes('STARSTRING'), '頁面標題應為本遊戲');
  const read = () => page.evaluate(() => {
    const g = window.__starstring;
    const s = g.state();
    return { phase: g.phase(), tick: s.tick, y: s.pos.y, latched: s.latch !== null, alive: s.alive, combo: s.combo };
  });
  const audioLevel = () => page.evaluate(() => window.__starstring.audioLevel());
  const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
  const dieByHolding = async () => {
    await page.mouse.move(...TAP);
    await page.mouse.down();
    await page.waitForFunction(() => window.__starstring.phase() === 'dead', null, { timeout: 30000 });
    await page.mouse.up();
  };

  // 標題畫面：機器人示範局在背景進行。
  await page.waitForTimeout(2500);
  const title = await read();
  assert(title.phase === 'title' && title.tick > 100, `標題畫面應有示範局在跑（tick=${title.tick}）`);
  const probe = await page.evaluate(() => window.__starstring.probe());
  assert(probe.lit > MIN_LIT, `畫面應有亮部（lit=${probe.lit.toFixed(4)}）`);
  assert(probe.colorful > MIN_COLORFUL, `畫面應有色彩（colorful=${probe.colorful.toFixed(4)}）`);
  await shot('title');

  // 點一下開始：配樂要有輸出。
  await page.mouse.click(...TAP);
  await page.waitForTimeout(300);
  const started = await read();
  assert(started.phase === 'playing' && started.tick < 120, '點一下應開始新的一局');
  await page.waitForTimeout(600);
  const loud = await audioLevel();
  assert(loud > MIN_AUDIO_LEVEL, `開始後應有配樂輸出（RMS=${loud.toFixed(5)}）`);

  // 靜音鍵：真的沒聲音，而且不會被當成遊戲輸入。
  await page.click('#mute');
  await page.waitForTimeout(400);
  const afterMute = await read();
  assert(!afterMute.latched && afterMute.phase === 'playing', '按靜音鍵不應觸發勾星');
  assert((await audioLevel()) < MIN_AUDIO_LEVEL / 3, '靜音後應無輸出');
  await page.click('#mute');

  // 按住直到勾住一個天體，再放開。
  await page.mouse.move(...TAP);
  await page.mouse.down();
  let latched = false;
  for (let i = 0; i < 60 && !latched; i++) {
    await page.waitForTimeout(50);
    latched = (await read()).latched;
  }
  assert(latched, '按住後 3 秒內應勾住天體');
  await page.waitForTimeout(350);
  await shot('latched');
  await page.mouse.up();
  await page.waitForTimeout(100);
  const released = await read();
  assert(!released.latched && released.combo >= 1, '放開後應脫離並累積連擊');

  // 一直按住必定死亡；第二局應出現上一局的幽靈。
  await dieByHolding();
  await page.waitForTimeout(250);
  await shot('gameover');
  await page.waitForTimeout(600);
  await page.mouse.click(...TAP);
  await page.waitForTimeout(400);
  const again = await read();
  assert(again.phase === 'playing' && again.alive && again.tick < 120, '點一下應重新開始');
  assert((await page.evaluate(() => window.__starstring.ghost())) !== null, '第二局應有幽靈彗星');
  const tag = await page.evaluate(() => {
    const el = document.querySelector('#ghost-tag');
    const box = el.getBoundingClientRect();
    return { on: el.dataset.on, text: el.textContent, inView: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
  });
  assert(tag.on === 'true' && tag.text.includes('最佳紀錄') && tag.inView, `幽靈應有畫面內的「最佳紀錄」標籤（${JSON.stringify(tag)}）`);
  // 等幽靈和玩家分開再截圖，才看得到光環本身。
  await page.waitForTimeout(1500);
  await shot('ghost');

  // 回到標題讓示範局飛到第一個黑洞，確認透鏡與吸積盤有畫出來。
  await page.reload();
  await page.waitForFunction(() => window.__starstring.holesAhead() > 0, null, { timeout: 90000 });
  await page.waitForTimeout(500);
  await shot('blackhole');

  // 離線：把 server 真的關掉再重新整理（瀏覽器的離線模擬攔不到 service worker 的請求）。
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
  await stopServer();
  const refused = await fetch(PAGE_URL).then(() => false, () => true);
  assert(refused, 'server 應已關閉');
  errors.length = 0;
  await page.reload();
  await page.waitForFunction(() => window.__starstring?.state().tick > 60, null, { timeout: 10000 });

  assert(errors.length === 0, `頁面不應有錯誤：${errors.join('; ')}`);
  console.log(`e2e 冒煙測試通過（audio RMS=${loud.toFixed(4)} lit=${probe.lit.toFixed(4)} colorful=${probe.colorful.toFixed(4)}，離線重載成功）`);
} finally {
  await browser?.close();
  await stopServer();
}
