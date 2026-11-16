// 完整可通關性驗收：把種子切成數份平行跑 vitest。
// 用法：node scripts/solve.mjs [種子數=200] [平行數=4]
import { spawn } from 'node:child_process';

const total = Number(process.argv[2] ?? 200);
const shards = Number(process.argv[3] ?? 4);
const per = Math.ceil(total / shards);

function runShard(index) {
  const from = index * per + 1;
  const count = Math.min(per, total - index * per);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'src/sim/solvable.test.ts', '-t', '都能存活'],
      { env: { ...process.env, VITE_SOLVE_FROM: String(from), VITE_SOLVE_SEEDS: String(count) } },
    );
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const detail = out.split('\n').filter((l) => /高度|seed \d+:/.test(l)).join('\n');
      console.log(`種子 ${from}–${from + count - 1}：${code === 0 ? '通過' : '失敗'}\n${detail}`);
      resolve(code);
    });
  });
}

const codes = await Promise.all(Array.from({ length: shards }, (_, i) => runShard(i)));
const failed = codes.filter((c) => c !== 0).length;
console.log(failed ? `共 ${failed} 份失敗` : `全部 ${total} 個種子通過`);
process.exit(failed ? 1 : 0);
