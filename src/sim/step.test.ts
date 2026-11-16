import { describe, expect, it } from 'vitest';
import { CRUISE_SPEED, DT, MAX_SPEED, STAR_MIN_GAP, STAR_X_RANGE, WALL_X } from './config';
import { initialState, step } from './step';
import type { SimState, Star, WorldLike } from './types';
import { World } from './world';

function fixedWorld(stars: Star[]): WorldLike {
  return {
    starsNear: () => stars,
    holesNear: () => [],
    hole: () => undefined,
    dustNear: () => [],
    star: (id) => stars.find((s) => s.id === id),
  };
}

function run(state: SimState, world: WorldLike, ticks: number, hold: (tick: number) => boolean): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = step(s, hold(s.tick), world);
  return s;
}

const sideStar: Star = { id: 's', x: 2, y: 4, radius: 0.5, hue: 0 };

describe('自由飛行', () => {
  it('不按任何鍵時以巡航速度直線上升', () => {
    const s = run(initialState(), fixedWorld([]), 120, () => false);
    expect(s.pos.x).toBe(0);
    expect(s.pos.y).toBeCloseTo(CRUISE_SPEED, 6);
    expect(s.alive).toBe(true);
  });

  it('撞牆會反彈、留在邊界內並中斷連擊', () => {
    const start: SimState = { ...initialState(), vel: { x: CRUISE_SPEED, y: 0.5 }, combo: 3, voidY: -1000 };
    let s = start;
    let bounced = false;
    for (let i = 0; i < 240; i++) {
      s = step(s, false, fixedWorld([]));
      bounced ||= s.events.some((e) => e.type === 'bounce');
      expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(WALL_X);
    }
    expect(bounced).toBe(true);
    expect(s.combo).toBe(0);
    expect(s.vel.x).toBeLessThan(0);
  });

  it('直接撞上恆星會死亡', () => {
    const s = run(initialState(), fixedWorld([{ ...sideStar, x: 0 }]), 240, () => false);
    expect(s.deathCause).toBe('star');
  });

  it('被虛空追上會死亡', () => {
    const s = step({ ...initialState(), voidY: 5 }, false, fixedWorld([]));
    expect(s.deathCause).toBe('void');
  });
});

describe('勾住與彈弓', () => {
  const world = fixedWorld([sideStar]);
  // 飛到恆星側邊（距離約 2）才按住。
  const approach = run(initialState(), world, Math.round(4 / CRUISE_SPEED / DT), () => false);

  it('勾住期間角動量守恆、半徑收縮、速度上升', () => {
    let s = step(approach, true, world);
    expect(s.latch).not.toBeNull();
    const L = s.latch!.L;
    const r0 = s.latch!.r;
    for (let i = 0; i < 200; i++) {
      s = step(s, true, world);
      const latch = s.latch!;
      const dist = Math.hypot(s.pos.x - sideStar.x, s.pos.y - sideStar.y);
      expect(dist).toBeCloseTo(latch.r, 9);
      const tangential = Math.sqrt(Math.max(0, s.vel.x ** 2 + s.vel.y ** 2 - latch.vr ** 2));
      if (L / latch.r < MAX_SPEED) expect(tangential * latch.r).toBeCloseTo(L, 6);
    }
    expect(s.latch!.r).toBeLessThan(r0);
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeGreaterThan(CRUISE_SPEED * 1.2);
  });

  it('放開後保留速度並沿直線飛出', () => {
    const held = run(approach, world, 150, () => true);
    const released = step(held, false, world);
    expect(released.latch).toBeNull();
    expect(released.events.some((e) => e.type === 'release')).toBe(true);
    const later = run(released, world, 10, () => false);
    const dir = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);
    expect(dir(later.vel)).toBeCloseTo(dir(released.vel), 9);
  });

  it('一直按住最終會墜入恆星', () => {
    const s = run({ ...approach, voidY: -1000 }, world, 120 * 12, () => true);
    expect(s.deathCause).toBe('star');
  });

  it('原地繞行太久會先被虛空追上', () => {
    const s = run(approach, world, 120 * 12, () => true);
    expect(s.deathCause).toBe('void');
  });

  it('勾住新恆星才增加連擊，重勾同一顆不加', () => {
    let s = step(approach, true, world);
    expect(s.combo).toBe(1);
    s = step(s, false, world);
    s = step(s, true, world);
    expect(s.combo).toBe(1);
  });

  it('同樣的輸入序列產生完全相同的結果', () => {
    const real = new World(12345);
    const pattern = (tick: number) => Math.floor(tick / 37) % 3 === 0;
    const a = run(initialState(), real, 2000, pattern);
    const b = run(initialState(), real, 2000, pattern);
    const { collected: ca, ...restA } = a;
    const { collected: cb, ...restB } = b;
    expect(restA).toEqual(restB);
    expect([...ca]).toEqual([...cb]);
  });
});

describe('黑洞', () => {
  const hole = { id: '0:h', x: 1.2, y: 6 };
  const world: WorldLike = { ...fixedWorld([]), holesNear: () => [hole], hole: () => hole };
  const far: SimState = { ...initialState(), voidY: -1000 };

  it('自由飛行時軌跡被引力彎向黑洞', () => {
    // 飛到與黑洞同高（y ≈ 6）時，已在引力範圍內待了約半秒。
    const s = run(far, world, 120, () => false);
    expect(s.alive).toBe(true);
    expect(s.pos.x).toBeGreaterThan(0.1);
    expect(s.vel.x).toBeGreaterThan(0.5);
  });

  it('直直飛進視界會死亡', () => {
    const s = run({ ...far, pos: { x: 1.2, y: 0 } }, world, 240, () => false);
    expect(s.deathCause).toBe('hole');
  });

  it('可以勾住黑洞，而且加速比繞恆星更猛', () => {
    const near = run(far, world, Math.round(5 / CRUISE_SPEED / DT), () => false);
    const onHole = run(near, world, 90, () => true);
    expect(onHole.latch?.kind).toBe('hole');
    const star: Star = { id: 's', x: hole.x, y: hole.y, radius: 0.34, hue: 0 };
    const onStar = run(near, fixedWorld([star]), 90, () => true);
    const speed = (s: SimState) => Math.hypot(s.vel.x, s.vel.y);
    expect(speed(onHole)).toBeGreaterThan(speed(onStar));
  });

  it('勾著黑洞不放最終會落入視界', () => {
    const near = run(far, world, Math.round(5 / CRUISE_SPEED / DT), () => false);
    expect(run(near, world, 120 * 8, () => true).deathCause).toBe('hole');
  });
});

describe('星圖生成', () => {
  it('同種子相同、不同種子不同', () => {
    const a = new World(7).starsNear(100, 50, 0);
    expect(new World(7).starsNear(100, 50, 0)).toEqual(a);
    expect(new World(8).starsNear(100, 50, 0)).not.toEqual(a);
  });

  it('恆星彼此保持最小間距且都在場地內', () => {
    for (const seed of [1, 2, 3]) {
      const stars = new World(seed).starsNear(900, 900, 0).filter((s) => !s.orbit);
      expect(stars.length).toBeGreaterThan(250);
      for (const a of stars) {
        expect(Math.abs(a.x)).toBeLessThanOrEqual(STAR_X_RANGE);
        for (const b of stars) {
          if (a === b || Math.abs(a.y - b.y) > STAR_MIN_GAP) continue;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(STAR_MIN_GAP - 1e-9);
        }
      }
    }
  });
});
