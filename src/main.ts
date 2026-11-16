import { createRenderer } from './render2d';
import { DT } from './sim/config';
import { seedFromString } from './sim/rng';
import { initialState, score, step } from './sim/step';
import type { SimState } from './sim/types';
import { World } from './sim/world';

const BEST_KEY = 'starstring.best';
/** 分頁切回來時避免一次補跑太多 tick。 */
const MAX_CATCHUP_TICKS = 12;
const RESTART_LOCK_MS = 500;

declare global {
  interface Window {
    /** 供 e2e 讀取模擬狀態。 */
    __starstring?: { state: () => SimState; seed: number };
  }
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0; // 無痕模式等情況下 localStorage 不可用，最高分改為只存在本次分頁。
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // 同上：存不了就只保留在記憶體。
  }
}

function dailySeed(): number {
  const param = new URLSearchParams(location.search).get('seed');
  return seedFromString(param ?? new Date().toISOString().slice(0, 10));
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('找不到遊戲畫布 #stage');
  const renderer = createRenderer(canvas);
  const seed = dailySeed();
  const world = new World(seed);

  let state = initialState();
  let hold = false;
  let best = readBest();
  let diedAt = 0;
  let last = performance.now();
  let acc = 0;

  const press = (): void => {
    if (!state.alive) {
      if (performance.now() - diedAt < RESTART_LOCK_MS) return;
      state = initialState();
      renderer.reset();
      return;
    }
    hold = true;
  };
  const release = (): void => { hold = false; };

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) press(); });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const frame = (now: number): void => {
    acc += Math.min((now - last) / 1000, MAX_CATCHUP_TICKS * DT);
    last = now;
    while (acc >= DT) {
      const wasAlive = state.alive;
      state = step(state, hold, world);
      if (wasAlive && !state.alive) {
        diedAt = now;
        hold = false;
        if (score(state) > best) {
          best = score(state);
          writeBest(best);
        }
      }
      acc -= DT;
    }
    renderer.draw(state, world, best);
    requestAnimationFrame(frame);
  };

  window.__starstring = { state: () => state, seed };
  requestAnimationFrame(frame);
}

start();
