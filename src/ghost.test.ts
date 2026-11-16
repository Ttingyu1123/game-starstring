import { describe, expect, it } from 'vitest';
import { createGhostPlayer, createRecorder } from './ghost';
import { playBot } from './sim/bot';
import { initialState, score, step } from './sim/step';
import { World } from './sim/world';

describe('幽靈回放', () => {
  it('錄下的輸入翻轉點重播後與原局逐 tick 一致', () => {
    const world = new World(5);
    const { inputs } = playBot(initialState(), world, 1500);
    const recorder = createRecorder();
    let live = initialState();
    const ghostInputs = inputs.map((hold) => {
      recorder.record(live.tick, hold);
      live = step(live, hold, world);
      return live;
    });

    const ghost = createGhostPlayer({ score: score(live), toggles: recorder.toggles() }, world);
    for (const expected of ghostInputs) {
      const replayed = ghost.advance();
      expect(replayed.pos).toEqual(expected.pos);
    }
    expect(recorder.toggles().length).toBeLessThan(inputs.length / 4);
  });
});
