import { initialState, step } from './sim/step';
import type { SimState, WorldLike } from './sim/types';

/** 一局的完整紀錄：模擬是確定性的，所以只要存「輸入在哪些 tick 翻轉」就能重播。 */
export interface GhostRun {
  readonly score: number;
  readonly toggles: readonly number[];
}

const MAX_TOGGLES = 20_000;
const key = (seed: number): string => `starstring.ghost.${seed}`;

function isGhostRun(value: unknown): value is GhostRun {
  if (typeof value !== 'object' || value === null) return false;
  const { score, toggles } = value as Record<string, unknown>;
  return typeof score === 'number' && Number.isFinite(score)
    && Array.isArray(toggles) && toggles.length <= MAX_TOGGLES
    && toggles.every((t) => Number.isInteger(t) && t >= 0);
}

export function loadGhost(seed: number): GhostRun | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(seed)) ?? 'null');
    return isGhostRun(parsed) ? parsed : null;
  } catch {
    return null; // 存檔損毀或 localStorage 不可用：當作沒有幽靈，不影響遊玩。
  }
}

export function saveGhost(seed: number, run: GhostRun): void {
  try {
    localStorage.setItem(key(seed), JSON.stringify(run));
  } catch {
    // 存不了（無痕模式、容量已滿）就只是下一局沒有幽靈。
  }
}

export interface Recorder {
  record(tick: number, hold: boolean): void;
  toggles(): readonly number[];
}

export function createRecorder(): Recorder {
  let last = false;
  let toggles: number[] = [];
  return {
    record(tick, hold) {
      if (hold === last) return;
      last = hold;
      toggles = [...toggles, tick];
    },
    toggles: () => toggles,
  };
}

/** 與玩家同步前進的幽靈；每呼叫一次 advance 前進一個 tick。 */
export function createGhostPlayer(run: GhostRun, world: WorldLike): { advance(): SimState } {
  let state = initialState();
  let hold = false;
  let next = 0;
  return {
    advance() {
      while (run.toggles[next] === state.tick) {
        hold = !hold;
        next += 1;
      }
      state = step(state, hold, world);
      return state;
    },
  };
}
