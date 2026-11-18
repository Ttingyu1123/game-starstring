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
  /** 這一局有幽靈：開場提示改成說明它是什麼。 */
  readonly hasGhost: boolean;
}

const HINT_CONTROLS = '按住 勾住恆星　·　放開 甩出去';
const HINT_GHOST = '紫色小亮點＝你在這張星圖的最佳紀錄';

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
  let lastCombo = 0;

  return (view) => {
    root.dataset.phase = view.phase;
    root.dataset.hint = String(view.showHint);
    setHint(view.hasGhost ? HINT_GHOST : HINT_CONTROLS);    setScore(String(view.score));
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
