import { describe, expect, it } from 'vitest';
import { playBot } from './bot';
import { DT } from './config';
import { initialState, step } from './step';
import type { Star, WorldLike } from './types';
import { World } from './world';

// 平常跑少量種子；完整驗收用 `npm run solve`（200 個種子、平行分份）。
const SEED_COUNT = Number(import.meta.env.VITE_SOLVE_SEEDS ?? 6);
const SEED_FROM = Number(import.meta.env.VITE_SOLVE_FROM ?? 1);
const SURVIVE_SECONDS = 60;
const SURVIVE_TICKS = SURVIVE_SECONDS / DT;

describe('可通關性', () => {
  it(`機器人在 ${SEED_COUNT} 個種子上都能存活 ${SURVIVE_SECONDS} 秒`, () => {
    const failures: string[] = [];
    const heights: number[] = [];
    for (let seed = SEED_FROM; seed < SEED_FROM + SEED_COUNT; seed++) {
      const { state } = playBot(initialState(), new World(seed), SURVIVE_TICKS);
      heights.push(state.maxY);
      if (!state.alive) failures.push(`seed ${seed}: ${state.deathCause} @ ${(state.tick * DT).toFixed(1)}s`);
    }
    heights.sort((a, b) => a - b);
    console.info(`高度 最低 ${heights[0]!.toFixed(0)}　中位 ${heights[heights.length >> 1]!.toFixed(0)}　最高 ${heights.at(-1)!.toFixed(0)}`);
    expect(failures).toEqual([]);
  }, 1_200_000);

  it('機器人的輸入重播後得到相同結果（回放可行）', () => {
    const world = new World(3);
    const { state, inputs } = playBot(initialState(), world, 1200);
    let replay = initialState();
    for (const hold of inputs) replay = step(replay, hold, world);
    expect(replay.pos).toEqual(state.pos);
    expect(replay.bonus).toBe(state.bonus);
  });

  it('不可能通過的星圖會被判定失敗（確認這個檢查會紅）', () => {
    // 一整排互相重疊的恆星把通道完全封死。
    const wall: Star[] = Array.from({ length: 13 }, (_, i) => ({ id: `w${i}`, x: -6 + i, y: 30, radius: 0.9, hue: 0 }));
    const blocked: WorldLike = {
      starsNear: () => wall,
      holesNear: () => [],
      hole: () => undefined,
      dustNear: () => [],
      star: (id) => wall.find((s) => s.id === id),
    };
    const { state } = playBot(initialState(), blocked, SURVIVE_TICKS);
    expect(state.alive).toBe(false);
  });
});
