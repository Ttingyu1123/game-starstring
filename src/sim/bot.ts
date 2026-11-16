import { step } from './step';
import type { SimState, WorldLike } from './types';

/** 一個計畫＝先滑行 wait 個 tick，再按住 hold 個 tick，然後放開。 */
interface Plan {
  readonly wait: number;
  readonly hold: number;
}

const WAITS = [0, 8, 16, 24, 32, 40, 48, 56];
const HOLDS = [0, 10, 20, 30, 45, 60, 80, 100];
// 不按的計畫不論等多久都是同一條滑行軌跡，只留一個。
const PLANS: readonly Plan[] = WAITS.flatMap((wait) => HOLDS.map((hold) => ({ wait, hold })))
  .filter((plan) => plan.hold > 0 || plan.wait === 0);
/**
 * 計畫結束後再滑行多久來評估後果。必須長過黑洞的「不歸路」距離：
 * 實測放開後 1–2 秒才落入黑洞、途中無星可勾，視野太短就看不到。
 */
const TAIL_TICKS = 240;
/** 滑行尾段這麼久之後才發生的死亡，通常還來得及用下一次勾星避開，扣分較輕。 */
const TAIL_CERTAIN_TICKS = 90;
const LATE_DEATH_FACTOR = 0.35;
/** 每執行這麼多 tick 就重新規劃（滾動視界）。 */
const REPLAN_TICKS = 16;
const DEATH_PENALTY = 40;
const BOUNCE_PENALTY = 3;
const SAFE_MARGIN = 5;

function evaluate(start: SimState, world: WorldLike, plan: Plan): number {
  let s = start;
  let bounces = 0;
  const total = plan.wait + plan.hold + TAIL_TICKS;
  for (let i = 0; i < total; i++) {
    const hold = i >= plan.wait && i < plan.wait + plan.hold;
    s = step(s, hold, world);
    if (s.events.some((e) => e.type === 'bounce')) bounces += 1;
    if (!s.alive) {
      const tailTick = i - plan.wait - plan.hold;
      const late = tailTick > TAIL_CERTAIN_TICKS && s.deathCause === 'star';
      return s.pos.y - DEATH_PENALTY * (late ? LATE_DEATH_FACTOR : 1) + i * 0.05;
    }
  }
  const margin = s.pos.y - s.voidY;
  const squeeze = margin < SAFE_MARGIN ? (SAFE_MARGIN - margin) * 3 : 0;
  return s.pos.y + s.vel.y * 0.4 + s.bonus * 0.002 - bounces * BOUNCE_PENALTY - squeeze;
}

function choosePlan(state: SimState, world: WorldLike): Plan {
  let best = PLANS[0]!;
  let bestValue = -Infinity;
  for (const plan of PLANS) {
    const value = evaluate(state, world, plan);
    if (value > bestValue) {
      best = plan;
      bestValue = value;
    }
  }
  return best;
}

export interface BotRun {
  readonly state: SimState;
  /** 每個 tick 的輸入，可直接拿去重播。 */
  readonly inputs: readonly boolean[];
}

/** 回傳「這個 tick 要不要按住」的決策函式；每 REPLAN_TICKS 重新規劃一次。 */
export function createBotDriver(): (state: SimState, world: WorldLike) => boolean {
  let plan: Plan = PLANS[0]!;
  let age = REPLAN_TICKS;
  return (state, world) => {
    if (age >= REPLAN_TICKS) {
      plan = choosePlan(state, world);
      age = 0;
    }
    const hold = age >= plan.wait && age < plan.wait + plan.hold;
    age += 1;
    return hold;
  };
}

/** 讓機器人從 `start` 玩到死亡或 `maxTicks`。只透過 step() 看世界，與玩家規則完全相同。 */
export function playBot(start: SimState, world: WorldLike, maxTicks: number): BotRun {
  const decide = createBotDriver();
  const inputs: boolean[] = [];
  let state = start;
  while (state.alive && state.tick < maxTicks) {
    const hold = decide(state, world);
    inputs.push(hold);
    state = step(state, hold, world);
  }
  return { state, inputs };
}
