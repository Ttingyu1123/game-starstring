// 用本機 Chrome 把 SVG 圖示轉成 PWA 需要的 PNG。圖示設計改了才需要重跑：node scripts/icons.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));
const SIZES = [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]];

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="38%" cy="62%" r="80%">
      <stop offset="0" stop-color="#1b1640"/><stop offset="1" stop-color="#05060f"/>
    </radialGradient>
    <radialGradient id="star" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff7d6"/><stop offset="0.55" stop-color="#ffc45c"/><stop offset="1" stop-color="#ff7a3c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="trail" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#8fe6ff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="196" cy="316" r="150" fill="none" stroke="#8fa0ff" stroke-opacity="0.28" stroke-width="5"/>
  <circle cx="196" cy="316" r="96" fill="url(#star)"/>
  <path d="M196 466 A150 150 0 0 0 346 316 A150 150 0 0 0 302 210" fill="none" stroke="url(#trail)" stroke-width="20" stroke-linecap="round"/>
  <line x1="302" y1="210" x2="404" y2="108" stroke="#ffffff" stroke-opacity="0.55" stroke-width="8" stroke-linecap="round" stroke-dasharray="4 26"/>
  <circle cx="302" cy="210" r="26" fill="#ffffff"/>
</svg>`;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, size] of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
    await page.screenshot({ path: OUT + name });
    await page.close();
    console.log(`已產生 ${name}`);
  }
} finally {
  await browser.close();
}
