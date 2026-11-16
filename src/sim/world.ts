import { CHUNK_HEIGHT, CHUNK_MARGIN, STAR_MIN_GAP, STAR_X_RANGE } from './config';
import { hashInts, mulberry32 } from './rng';
import type { Dust, Star, WorldLike } from './types';

interface Chunk {
  readonly stars: readonly Star[];
  readonly dust: readonly Dust[];
}

const EMPTY: Chunk = { stars: [], dust: [] };
const PLACE_ATTEMPTS = 24;

function generateChunk(seed: number, index: number): Chunk {
  if (index < 0) return EMPTY;
  const rand = mulberry32(hashInts(seed, index));
  const y0 = index * CHUNK_HEIGHT + CHUNK_MARGIN;
  const bandHeight = CHUNK_HEIGHT - CHUNK_MARGIN * 2;
  const stars: Star[] = [];
  const wanted = 2 + (rand() < Math.min(0.7, 0.2 + index * 0.02) ? 1 : 0);

  for (let i = 0; i < wanted; i++) {
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
      const x = (rand() * 2 - 1) * STAR_X_RANGE;
      const y = y0 + rand() * bandHeight;
      // 起點正上方留一條通道，避免開場直接撞星。
      if (index === 0 && Math.abs(x) < 1.6) continue;
      if (stars.some((s) => Math.hypot(s.x - x, s.y - y) < STAR_MIN_GAP)) continue;
      stars.push({ id: `${index}:${stars.length}`, x, y, radius: 0.4 + rand() * 0.22, hue: rand() });
      break;
    }
  }

  const dust: Dust[] = [];
  for (const star of stars) {
    const count = 4 + Math.floor(rand() * 3);
    const ring = star.radius + 0.7 + rand() * 0.7;
    const start = rand() * Math.PI * 2;
    const spread = 0.42;
    for (let k = 0; k < count; k++) {
      const angle = start + k * spread;
      dust.push({
        id: `${star.id}:${k}`,
        x: star.x + Math.cos(angle) * ring,
        y: star.y + Math.sin(angle) * ring,
      });
    }
  }
  return { stars, dust };
}

/** 整張星圖是 seed 的純函式；chunk 快取只是記憶化。 */
export class World implements WorldLike {
  private readonly chunks = new Map<number, Chunk>();

  constructor(readonly seed: number) {}

  private chunk(index: number): Chunk {
    let chunk = this.chunks.get(index);
    if (!chunk) {
      chunk = generateChunk(this.seed, index);
      this.chunks.set(index, chunk);
    }
    return chunk;
  }

  private collect<T>(y: number, range: number, pick: (c: Chunk) => readonly T[]): T[] {
    const from = Math.floor((y - range) / CHUNK_HEIGHT);
    const to = Math.floor((y + range) / CHUNK_HEIGHT);
    const out: T[] = [];
    for (let i = from; i <= to; i++) out.push(...pick(this.chunk(i)));
    return out;
  }

  starsNear(y: number, range: number): Star[] {
    return this.collect(y, range, (c) => c.stars);
  }

  dustNear(y: number, range: number): Dust[] {
    return this.collect(y, range, (c) => c.dust);
  }

  star(id: string): Star | undefined {
    const [chunkText, indexText] = id.split(':');
    return this.chunk(Number(chunkText)).stars[Number(indexText)];
  }
}
