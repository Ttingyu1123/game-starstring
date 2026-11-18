import { multiplier } from './sim/step';
import type { DeathCause } from './sim/types';

export type Phase = 'title' | 'playing' | 'dead';

export interface HudView {
  readonly phase: Phase;
  readonly score: number;
  readonly best: number;
  readonly combo: number;
  readonly cause: DeathCause | null;
  readonly newBest: boolean;
  readonly showHint: boolean;
  readonly seedLabel: string;
  /** 幽靈彗星在畫面上的位置（比例，可超出 0–1）；沒有幽靈時為 null。 */
  readonly ghost: { readonly x: number; readonly y: number } | null;
  /** 這一局有幽靈：開場提示改成說明它是什麼。 */
  readonly hasGhost: boolean;
}

const HINT_CONTROLS = '按住 勾住恆星　·　放開 甩出去';
const HINT_GHOST = '綠色光環＝你在這張星圖的最佳紀錄';
/** 幽靈在畫面內時，標籤浮在它上方多少像素。 */
const GHOST_TAG_LIFT = 30;
/** 幽靈跑出畫面時，標籤貼在距離上下緣與左右緣多少像素的位置。 */
const GHOST_TAG_TOP = 96;
const GHOST_TAG_BOTTOM = 76;
const GHOST_TAG_SIDE = 64;

const DEATH_TEXT: Record<DeathCause, string> = {
  star: '墜入恆星',
  void: '被虛空吞噬',
  hole: '落入黑洞',
};

function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`HUD 缺少元素 ${selector}`);
  return el;
}

/** 只在值改變時才寫入 DOM，避免每幀觸發版面重排。 */
function textSetter(el: HTMLElement): (value: string) => void {
  let last = '';
  return (value) => {
    if (value === last) return;
    last = value;
    el.textContent = value;
  };
}

export function createHud(): (view: HudView) => void {
  const root = need<HTMLElement>('#hud');
  const comboBox = need<HTMLElement>('#combo');
  const setScore = textSetter(need('#score'));
  const setBest = textSetter(need('#best'));
  const setCombo = textSetter(need('#combo-count'));
  const setMult = textSetter(need('#combo-mult'));
  const setCause = textSetter(need('#over-cause'));
  const setFinal = textSetter(need('#over-score'));
  const setRecord = textSetter(need('#over-record'));
  const setSeed = textSetter(need('#seed'));
  const setHint = textSetter(need('#hint'));
  const ghostTag = need<HTMLElement>('#ghost-tag');
  const setGhostText = textSetter(ghostTag);
  let lastCombo = 0;

  const placeGhostTag = (ghost: HudView['ghost']): void => {
    ghostTag.dataset.on = String(ghost !== null);
    if (!ghost) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = Math.min(w - GHOST_TAG_SIDE, Math.max(GHOST_TAG_SIDE, ghost.x * w));
    const above = ghost.y < 0;
    const below = ghost.y > 1;
    const y = above ? GHOST_TAG_TOP : below ? h - GHOST_TAG_BOTTOM : Math.max(GHOST_TAG_TOP, ghost.y * h - GHOST_TAG_LIFT);
    setGhostText(above ? '▲ 最佳紀錄領先中' : below ? '▼ 已超越最佳紀錄' : '最佳紀錄');
    ghostTag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  };

  return (view) => {
    root.dataset.phase = view.phase;
    root.dataset.hint = String(view.showHint);
    setHint(view.hasGhost ? HINT_GHOST : HINT_CONTROLS);
    placeGhostTag(view.ghost);
    setScore(String(view.score));
    setBest(`最佳 ${view.best}`);
    setSeed(view.seedLabel);

    comboBox.dataset.on = String(view.combo > 1);
    setCombo(`${view.combo} 連`);
    setMult(`×${multiplier(view.combo).toFixed(2)}`);
    if (view.combo > lastCombo) {
      // 重新觸發彈跳動畫。
      comboBox.classList.remove('pop');
      void comboBox.offsetWidth;
      comboBox.classList.add('pop');
    }
    lastCombo = view.combo;

    if (view.phase === 'dead' && view.cause) {
      setCause(DEATH_TEXT[view.cause]);
      setFinal(String(view.score));
      setRecord(view.newBest ? '新紀錄！' : `最佳 ${view.best}`);
    }
  };
}
