import {
  BOOST_DECAY, COMBO_CAP, COMBO_STEP, CRUISE_RECOVER, CRUISE_SPEED, DT, DUST_POINTS, DUST_RADIUS,
  GRAZE_FACTOR, GRAZE_POINTS_PER_SEC, HEIGHT_POINTS, HOLE_GRAVITY, HOLE_GRAZE_RADIUS, HOLE_HORIZON,
  HOLE_ORBIT_PULL, HOLE_REACH, HOLE_SOFTENING, LATCH_POINTS, LATCH_RANGE, MAX_SPEED, ORBIT_PULL, RADIAL_KEEP, RADIAL_TAU,
  VOID_ACCEL, VOID_BASE_SPEED, VOID_LEASH, VOID_MAX_SPEED, VOID_START_Y, WALL_DAMP, WALL_X,
} from './config';
import type { BlackHole, Body, DeathCause, Latch, SimEvent, SimState, Star, Vec, WorldLike } from './types';

const RADIAL_BLEND = 1 - Math.exp(-DT / RADIAL_TAU);
const COLLISION_SCAN = 1.2;

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
    lastBodyId: null,
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

const starBody = (s: Star): Body => ({ id: s.id, x: s.x, y: s.y, radius: s.radius, kind: 'star' });
const holeBody = (h: BlackHole): Body => ({ id: h.id, x: h.x, y: h.y, radius: HOLE_HORIZON, kind: 'hole' });

/** 按住時會勾住哪個天體（最近的恆星或黑洞）；渲染層用它畫瞄準提示，所以與 step 共用同一套規則。 */
export function latchTarget(pos: Vec, world: WorldLike, tick: number): Body | null {
  const bodies = [
    ...world.starsNear(pos.y, LATCH_RANGE, tick).map(starBody),
    ...world.holesNear(pos.y, LATCH_RANGE).map(holeBody),
  ];
  let best: Body | null = null;
  let bestDist = LATCH_RANGE;
  for (const body of bodies) {
    const dist = Math.hypot(pos.x - body.x, pos.y - body.y);
    if (dist < bestDist && dist > body.radius) {
      best = body;
      bestDist = dist;
    }
  }
  return best;
}

export function latchedBody(latch: Latch, world: WorldLike, tick: number): Body | undefined {
  if (latch.kind === 'hole') {
    const hole = world.hole(latch.bodyId);
    return hole && holeBody(hole);
  }
  const star = world.star(latch.bodyId, tick);
  return star && starBody(star);
}

function beginLatch(pos: Vec, vel: Vec, star: Body): Latch {
  const rx = pos.x - star.x;
  const ry = pos.y - star.y;
  const r = Math.hypot(rx, ry);
  const speed = Math.hypot(vel.x, vel.y);
  return {
    bodyId: star.id,
    kind: star.kind,
    r,
    theta: Math.atan2(ry, rx),
    vr: ((vel.x * rx + vel.y * ry) / r) * RADIAL_KEEP,
    L: r * speed,
    sense: rx * vel.y - ry * vel.x >= 0 ? 1 : -1,
  };
}

/** `drift` 是恆星本身的速度（雙星才非零），放開時彗星會帶著它飛出。 */
function advanceLatch(latch: Latch, star: Body, drift: Vec): { latch: Latch; pos: Vec; vel: Vec } {
  const pull = latch.kind === 'hole' ? HOLE_ORBIT_PULL : ORBIT_PULL;
  const vr = latch.vr + (-pull - latch.vr) * RADIAL_BLEND;
  const r = latch.r + vr * DT;
  const vt = Math.min(latch.L / r, MAX_SPEED);
  const theta = latch.theta + ((latch.sense * vt) / r) * DT;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    latch: { ...latch, r, theta, vr },
    pos: { x: star.x + cos * r, y: star.y + sin * r },
    vel: {
      x: cos * vr - sin * vt * latch.sense + drift.x,
      y: sin * vr + cos * vt * latch.sense + drift.y,
    },
  };
}

function holePull(pos: Vec, holes: readonly BlackHole[]): Vec {
  let ax = 0;
  let ay = 0;
  for (const hole of holes) {
    const dx = hole.x - pos.x;
    const dy = hole.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= HOLE_REACH || dist < 1e-9) continue;
    // 在作用範圍邊緣平滑歸零，避免跨過邊界時加速度跳變。
    const falloff = 1 - (dist / HOLE_REACH) ** 2;
    const a = (HOLE_GRAVITY / (dist * dist + HOLE_SOFTENING)) * falloff;
    ax += (dx / dist) * a;
    ay += (dy / dist) * a;
  }
  return { x: ax, y: ay };
}

function advanceFree(pos: Vec, vel: Vec, holes: readonly BlackHole[]): { pos: Vec; vel: Vec; bounced: boolean } {
  const pull = holePull(pos, holes);
  const pulledX = vel.x + pull.x * DT;
  const pulledY = vel.y + pull.y * DT;
  const speed = Math.hypot(pulledX, pulledY);
  const rate = speed > CRUISE_SPEED ? BOOST_DECAY : CRUISE_RECOVER;
  const nextSpeed = Math.min(MAX_SPEED, CRUISE_SPEED + (speed - CRUISE_SPEED) * Math.exp(-rate * DT));
  const k = speed > 1e-9 ? nextSpeed / speed : 1;
  let vx = pulledX * k;
  let vy = pulledY * k;
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

function collision(pos: Vec, world: WorldLike, tick: number): DeathCause | null {
  for (const star of world.starsNear(pos.y, COLLISION_SCAN, tick)) {
    if (Math.hypot(pos.x - star.x, pos.y - star.y) <= star.radius) return 'star';
  }
  for (const hole of world.holesNear(pos.y, COLLISION_SCAN)) {
    if (Math.hypot(pos.x - hole.x, pos.y - hole.y) <= HOLE_HORIZON) return 'hole';
  }
  return null;
}

export function step(state: SimState, hold: boolean, world: WorldLike): SimState {
  if (!state.alive) return state.events.length ? { ...state, events: [] } : state;

  const events: SimEvent[] = [];
  const nextTick = state.tick + 1;
  let { pos, vel, latch, combo, lastBodyId, bonus, collected } = state;
  let grazing = false;

  if (latch && !hold) {
    latch = null;
    events.push({ type: 'release', speed: Math.hypot(vel.x, vel.y) });
  }

  if (!latch && hold) {
    const target = latchTarget(pos, world, state.tick);
    if (target) {
      const fresh = target.id !== lastBodyId;
      if (fresh) {
        combo += 1;
        bonus += LATCH_POINTS * multiplier(combo);
      }
      lastBodyId = target.id;
      latch = beginLatch(pos, vel, target);
      events.push({ type: 'latch', bodyId: target.id, kind: target.kind, combo, fresh });
    }
  }

  const starNow = latch ? latchedBody(latch, world, state.tick) : undefined;
  const starNext = latch ? latchedBody(latch, world, nextTick) : undefined;
  if (latch && starNow && starNext) {
    const drift = { x: (starNext.x - starNow.x) / DT, y: (starNext.y - starNow.y) / DT };
    const next = advanceLatch(latch, starNext, drift);
    ({ latch, pos, vel } = next);
    const grazeRadius = starNext.kind === 'hole' ? HOLE_GRAZE_RADIUS : starNext.radius * GRAZE_FACTOR;
    if (next.latch.r < grazeRadius) {
      grazing = true;
      bonus += GRAZE_POINTS_PER_SEC * DT * multiplier(combo);
    }
  } else {
    latch = null;
    const next = advanceFree(pos, vel, world.holesNear(pos.y, HOLE_REACH));
    ({ pos, vel } = next);
    if (next.bounced) {
      combo = 0;
      events.push({ type: 'bounce', x: pos.x, y: pos.y });
    }
  }

  let death = collision(pos, world, nextTick);

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
    tick: nextTick,
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
    lastBodyId,
    grazing,
    collected,
    events,
  };
}
