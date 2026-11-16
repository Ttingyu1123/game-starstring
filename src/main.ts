import { createAudio, type GameAudio } from './audio';
import { createGfx, type Gfx, type Probe } from './gfx';
import { createGhostPlayer, createRecorder, loadGhost, saveGhost, type GhostRun } from './ghost';
import { createHud, type Phase } from './hud';
import { createBotDriver } from './sim/bot';
import { DT } from './sim/config';
import { seedFromString } from './sim/rng';
import { initialState, score, step } from './sim/step';
import type { SimState, Vec } from './sim/types';
import { World } from './sim/world';

const BEST_KEY = 'starstring.best';
const MUTE_KEY = 'starstring.muted';
/** 分頁切回來時避免一次補跑太多 tick。 */
const MAX_CATCHUP_TICKS = 12;
const RESTART_LOCK_MS = 600;
const HINT_TICKS = 6 / DT;
/** 標題畫面的示範局死亡後，停多久再重開。 */
const ATTRACT_RESTART_MS = 1400;
/** e2e 用：彗星上方這段距離內有沒有黑洞。 */
const HOLE_PEEK = 5;

declare global {
  interface Window {
    /** 供 e2e 讀取狀態、畫面取樣與音量。 */
    __starstring?: {
      state: () => SimState;
      phase: () => Phase;
      seed: number;
      probe: () => Probe;
      holesAhead: () => number;
      audioLevel: () => number;
      ghost: () => Vec | null;
    };
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 無痕模式等情況下 localStorage 不可用：設定與紀錄只存在本次分頁。
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 同上：存不了就只保留在記憶體。
  }
}

function resolveSeed(): { seed: number; label: string } {
  const param = new URLSearchParams(location.search).get('seed');
  if (param) return { seed: seedFromString(param), label: `星系 ${param}` };
  const today = new Date().toISOString().slice(0, 10);
  return { seed: seedFromString(today), label: `今日星系 ${today}` };
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.textContent = message;
  box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:16px;line-height:1.8';
  document.body.append(box);
}

function bindMuteButton(audio: GameAudio): void {
  const button = document.querySelector<HTMLButtonElement>('#mute');
  if (!button) return;
  let muted = readStored(MUTE_KEY) === '1';
  const apply = (): void => {
    audio.setMuted(muted);
    button.dataset.muted = String(muted);
    button.setAttribute('aria-pressed', String(muted));
  };
  // 擋下 pointerdown，避免按靜音鍵同時被當成遊戲輸入。
  button.addEventListener('pointerdown', (e) => e.stopPropagation());
  button.addEventListener('click', () => {
    muted = !muted;
    writeStored(MUTE_KEY, muted ? '1' : '0');
    apply();
  });
  apply();
}

function bindInput(press: () => void, release: () => void): void {
  window.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) press(); });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('找不到遊戲畫布 #stage');

  let gfx: Gfx;
  try {
    gfx = createGfx(canvas);
  } catch (error) {
    showFatal('這個瀏覽器無法啟用 WebGL，所以遊戲畫面畫不出來。請改用較新的 Chrome、Safari 或 Edge。');
    throw error;
  }

  const hud = createHud();
  const audio = createAudio();
  const { seed, label } = resolveSeed();
  const world = new World(seed);

  let phase: Phase = 'title';
  let state = initialState();
  let demoBot = createBotDriver();
  let recorder = createRecorder();
  let ghostRun: GhostRun | null = loadGhost(seed);
  let ghostPlayer: ReturnType<typeof createGhostPlayer> | null = null;
  let ghostPos: Vec | null = null;
  let hold = false;
  let best = Number(readStored(BEST_KEY)) || 0;
  let newBest = false;
  let diedAt = 0;
  let last = performance.now();
  let acc = 0;

  const begin = (next: Phase): void => {
    phase = next;
    state = initialState();
    demoBot = createBotDriver();
    recorder = createRecorder();
    ghostPlayer = next === 'playing' && ghostRun ? createGhostPlayer(ghostRun, world) : null;
    ghostPos = null;
    hold = false;
    newBest = false;
    gfx.reset();
  };

  const finishRun = (): void => {
    phase = 'dead';
    const final = score(state);
    if (final > best) {
      best = final;
      newBest = true;
      writeStored(BEST_KEY, String(best));
    }
    if (!ghostRun || final > ghostRun.score) {
      ghostRun = { score: final, toggles: recorder.toggles() };
      saveGhost(seed, ghostRun);
    }
  };

  bindMuteButton(audio);
  bindInput(
    () => {
      audio.unlock();
      if (phase === 'playing') {
        hold = true;
        return;
      }
      if (phase === 'dead' && performance.now() - diedAt < RESTART_LOCK_MS) return;
      begin('playing');
    },
    // Safari 不把 touchstart／pointerdown 視為可解鎖音訊的手勢，放開時再解鎖一次。
    () => { audio.unlock(); hold = false; },
  );

  const tick = (now: number): void => {
    if (!state.alive) {
      if (phase === 'title' && now - diedAt > ATTRACT_RESTART_MS) begin('title');
      return;
    }
    const input = phase === 'title' ? demoBot(state, world) : hold;
    if (phase === 'playing') recorder.record(state.tick, input);
    state = step(state, input, world);
    const ghostState = ghostPlayer?.advance();
    ghostPos = ghostState?.alive ? ghostState.pos : null;

    if (state.events.length) {
      gfx.handleEvents(state.events, state, world);
      if (phase === 'playing') audio.handleEvents(state.events, state, world);
    }
    if (state.alive) return;
    diedAt = now;
    hold = false;
    if (phase === 'playing') finishRun();
  };

  const frame = (now: number): void => {
    const elapsed = Math.min((now - last) / 1000, MAX_CATCHUP_TICKS * DT);
    last = now;
    acc += elapsed;
    while (acc >= DT) {
      tick(now);
      acc -= DT;
    }
    gfx.frame({ state, world, dt: elapsed, time: now / 1000, ghost: ghostPos });
    audio.update(state, phase === 'playing');
    hud({
      phase,
      score: score(state),
      best,
      combo: state.combo,
      cause: state.deathCause,
      newBest,
      showHint: state.tick < HINT_TICKS,
      seedLabel: label,
    });
    requestAnimationFrame(frame);
  };

  window.__starstring = {
    state: () => state,
    phase: () => phase,
    seed,
    probe: () => gfx.probe(),
    holesAhead: () => world.holesNear(state.pos.y + HOLE_PEEK, HOLE_PEEK).length,
    audioLevel: () => audio.level(),
    ghost: () => ghostPos,
  };
  requestAnimationFrame(frame);
}

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 註冊失敗只代表沒有離線功能，線上遊玩不受影響。
  });
}

start();
registerServiceWorker();
