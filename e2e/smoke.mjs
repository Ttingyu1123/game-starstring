// 冒煙測試：對 build 後的 preview server 實際操作一輪。
// 用法：npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 57318;
const PAGE_URL = `http://localhost:${PORT}/?seed=e2e`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));

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

let browser;
try {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE_URL);

  assert((await page.title()).includes('STARSTRING'), '頁面標題應為本遊戲');
  const read = () => page.evaluate(() => {
    const s = window.__starstring.state();
    return { tick: s.tick, y: s.pos.y, latched: s.latch !== null, alive: s.alive, combo: s.combo, cause: s.deathCause };
  });

  await page.waitForTimeout(400);
  const a = await read();
  assert(a.tick > 10 && a.y > 0.5, `模擬應在前進（tick=${a.tick}, y=${a.y}）`);

  // 按住直到勾住一顆恆星。
  await page.mouse.move(195, 500);
  await page.mouse.down();
  let latched = false;
  for (let i = 0; i < 60 && !latched; i++) {
    await page.waitForTimeout(50);
    latched = (await read()).latched;
  }
  assert(latched, '按住後 3 秒內應勾住恆星');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + 'latched.png' });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const b = await read();
  assert(!b.latched && b.combo >= 1, '放開後應脫離並累積連擊');

  // 一直按住必定死亡（墜星或被虛空追上），接著點一下要能重開。
  await page.mouse.down();
  await page.waitForFunction(() => !window.__starstring.state().alive, null, { timeout: 30000 });
  await page.mouse.up();
  await page.screenshot({ path: OUT + 'gameover.png' });
  await page.waitForTimeout(700);
  await page.mouse.click(195, 500);
  await page.waitForTimeout(200);
  const c = await read();
  assert(c.alive && c.tick < 120, '點一下應重新開始');

  assert(errors.length === 0, `頁面不應有未捕捉錯誤：${errors.join('; ')}`);
  console.log('e2e 冒煙測試通過');
} finally {
  await browser?.close();
  server.kill();
}
