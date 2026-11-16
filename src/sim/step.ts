import {
  BOOST_DECAY, COMBO_CAP, COMBO_STEP, CRUISE_RECOVER, CRUISE_SPEED, DT, DUST_POINTS, DUST_RADIUS,
  GRAZE_FACTOR, GRAZE_POINTS_PER_SEC, HEIGHT_POINTS, LATCH_POINTS, LATCH_RANGE, MAX_SPEED,
  ORBIT_PULL, RADIAL_KEEP, RADIAL_TAU, VOID_ACCEL, VOID_BASE_SPEED, VOID_LEASH, VOID_MAX_SPEED,
  VOID_START_Y, WALL_DAMP, WALL_X,
} from './config';
import type { DeathCause, Latch, SimEvent, SimState, Star, Vec, WorldLike } from './types';

const RADIAL_BLEND = 1 - Math.exp(-DT / RADIAL_TAU);

export function initialState(): SimState {
  return {
    tick: 0,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: CRUISE_SPEED },
    latch: null,
    alive: true,
    deathCause: null,
    maxY: 0,
    voidY: VOID_START_Y,
    bonus: 0,
    combo: 0,
    bestCombo: 0,
    lastStarId: null,
    grazing: false,
    collected: new Set(),
    events: [],
  };
}

export function multiplier(combo: number): number {
  return 1 + Math.min(combo, COMBO_CAP) * COMBO_STEP;
}

export function score(state: SimState): number {
  return Math.round(state.maxY * HEIGHT_POINTS + state.bonus);
}

export function voidSpeed(tick: number): number {
  return Math.min(VOID_MAX_SPEED, VOID_BASE_SPEED + VOID_ACCEL * tick * DT);
}

/** 按住時會勾住哪顆星；渲染層用它畫瞄準提示，所以與 step 共用同一套規則。 */
export function latchTarget(pos: Vec, world: WorldLike): Star | null {
  let best: Star | null = null;
  let bestDist = LATCH_RANGE;
  for (const star of world.starsNear(pos.y, LATCH_RANGE)) {
    const dist = Math.hypot(pos.x - star.x, pos.y - star.y);
    if (dist < bestDist && dist > star.radius) {
      best = star;
      bestDist = dist;
    }
  }
  return best;
}

function beginLatch(pos: Vec, vel: Vec, star: Star): Latch {
  const rx = pos.x - star.x;
  const ry = pos.y - star.y;
  const r = Math.hypot(rx, ry);
  const speed = Math.hypot(vel.x, vel.y);
  return {
    starId: star.id,
    r,
    theta: Math.atan2(ry, rx),
    vr: ((vel.x * rx + vel.y * ry) / r) * RADIAL_KEEP,
    L: r * speed,
    sense: rx * vel.y - ry * vel.x >= 0 ? 1 : -1,
  };
}

function advanceLatch(latch: Latch, star: Star): { latch: Latch; pos: Vec; vel: Vec } {
  const vr = latch.vr + (-ORBIT_PULL - latch.vr) * RADIAL_BLEND;
  const r = latch.r + vr * DT;
  const vt = Math.min(latch.L / r, MAX_SPEED);
  const theta = latch.theta + ((latch.sense * vt) / r) * DT;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    latch: { ...latch, r, theta, vr },
    pos: { x: star.x + cos * r, y: star.y + sin * r },
    vel: { x: cos * vr - sin * vt * latch.sense, y: sin * vr + cos * vt * latch.sense },
  };
}

function advanceFree(pos: Vec, vel: Vec): { pos: Vec; vel: Vec; bounced: boolean } {
  const speed = Math.hypot(vel.x, vel.y);
  const rate = speed > CRUISE_SPEED ? BOOST_DECAY : CRUISE_RECOVER;
  const nextSpeed = CRUISE_SPEED + (speed - CRUISE_SPEED) * Math.exp(-rate * DT);
  const k = speed > 1e-9 ? nextSpeed / speed : 1;
  let vx = vel.x * k;
  let vy = vel.y * k;
  let x = pos.x + vx * DT;
  const y = pos.y + vy * DT;
  let bounced = false;
  if (Math.abs(x) > WALL_X) {
    x = Math.sign(x) * WALL_X * 2 - x;
    vx = -vx * WALL_DAMP;
    vy *= WALL_DAMP;
    bounced = true;
  }
  return { pos: { x, y }, vel: { x: vx, y: vy }, bounced };
}

export function step(state: SimState, hold: boolean, world: WorldLike): SimState {
  if (!state.alive) return state.events.length ? { ...state, events: [] } : state;

  const events: SimEvent[] = [];
  let { pos, vel, latch, combo, lastStarId, bonus, collected } = state;
  let grazing = false;
  let death: DeathCause | null = null;

  if (latch && !hold) {
    latch = null;
    events.push({ type: 'release', speed: Math.hypot(vel.x, vel.y) });
  }

  if (!latch && hold) {
    const target = latchTarget(pos, world);
    if (target) {
      const fresh = target.id !== lastStarId;
      if (fresh) {
        combo += 1;
        bonus += LATCH_POINTS * multiplier(combo);
      }
      lastStarId = target.id;
      latch = beginLatch(pos, vel, target);
      events.push({ type: 'latch', starId: target.id, combo, fresh });
    }
  }

  const latchedStar = latch ? world.star(latch.starId) : undefined;
  if (latch && latchedStar) {
    const next = advanceLatch(latch, latchedStar);
    ({ latch, pos, vel } = next);
    if (next.latch.r <= latchedStar.radius) death = 'star';
    else if (next.latch.r < latchedStar.radius * GRAZE_FACTOR) {
      grazing = true;
      bonus += GRAZE_POINTS_PER_SEC * DT * multiplier(combo);
    }
  } else {
    latch = null;
    const next = advanceFree(pos, vel);
    ({ pos, vel } = next);
    if (next.bounced) {
      combo = 0;
      events.push({ type: 'bounce', x: pos.x, y: pos.y });
    }
    for (const star of world.starsNear(pos.y, 1)) {
      if (Math.hypot(pos.x - star.x, pos.y - star.y) <= star.radius) death = 'star';
    }
  }

  for (const dust of world.dustNear(pos.y, DUST_RADIUS)) {
    if (collected.has(dust.id)) continue;
    if (Math.hypot(pos.x - dust.x, pos.y - dust.y) > DUST_RADIUS) continue;
    collected = new Set(collected).add(dust.id);
    bonus += DUST_POINTS * multiplier(combo);
    events.push({ type: 'dust', x: dust.x, y: dust.y });
  }

  const maxY = Math.max(state.maxY, pos.y);
  const voidY = Math.max(state.voidY + voidSpeed(state.tick) * DT, maxY - VOID_LEASH);
  if (!death && pos.y < voidY) death = 'void';
  if (death) events.push({ type: 'death', cause: death });

  return {
    tick: state.tick + 1,
    pos,
    vel,
    latch,
    alive: !death,
    deathCause: death,
    maxY,
    voidY,
    bonus,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    lastStarId,
    grazing,
    collected,
    events,
  };
}
