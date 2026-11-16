import {
  BINARY_FROM_CHUNK, BINARY_OMEGA, BINARY_RADIUS, CHUNK_HEIGHT, CHUNK_MARGIN, DT, HOLE_FROM_CHUNK, HOLE_X_RANGE,
  STAR_MIN_GAP, STAR_X_RANGE,
} from './config';
import { hashInts, mulberry32 } from './rng';
import type { BlackHole, Dust, Star, WorldLike } from './types';

interface Chunk {
  readonly stars: readonly Star[];
  readonly dust: readonly Dust[];
  readonly holes: readonly BlackHole[];
}

const EMPTY: Chunk = { stars: [], dust: [], holes: [] };
const PLACE_ATTEMPTS = 24;
const BINARY_CHANCE = 0.16;
const HOLE_CHANCE_STEP = 0.05;
const HOLE_CHANCE_MAX = 0.45;
const BINARY_CENTER_RANGE = 1.2;

type Rand = () => number;

function dustRing(rand: Rand, id: string, x: number, y: number, ring: number): Dust[] {
  const count = 4 + Math.floor(rand() * 3);
  const start = rand() * Math.PI * 2;
  return Array.from({ length: count }, (_, k) => ({
    id: `${id}:${k}`,
    x: x + Math.cos(start + k * 0.42) * ring,
    y: y + Math.sin(start + k * 0.42) * ring,
  }));
}

function binaryChunk(rand: Rand, index: number): Chunk {
  const cx = (rand() * 2 - 1) * BINARY_CENTER_RANGE;
  const cy = (index + 0.5) * CHUNK_HEIGHT;
  const phase = rand() * Math.PI * 2;
  const omega = rand() < 0.5 ? BINARY_OMEGA : -BINARY_OMEGA;
  const hue = rand();
  const stars = [0, 1].map((k) => ({
    id: `${index}:${k}`,
    x: cx,
    y: cy,
    radius: 0.42,
    hue: (hue + k * 0.5) % 1,
    orbit: { cx, cy, radius: BINARY_RADIUS, phase: phase + k * Math.PI, omega },
  }));
  return { stars, dust: dustRing(rand, `${index}:b`, cx, cy, 0.6), holes: [] };
}

function scatterChunk(rand: Rand, index: number): Chunk {
  const y0 = index * CHUNK_HEIGHT + CHUNK_MARGIN;
  const bandHeight = CHUNK_HEIGHT - CHUNK_MARGIN * 2;
  const placed: { x: number; y: number }[] = [];

  const place = (xRange: number): { x: number; y: number } | null => {
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
      const x = (rand() * 2 - 1) * xRange;
      const y = y0 + rand() * bandHeight;
      // 起點正上方留一條通道，避免開場直接撞星。
      if (index === 0 && Math.abs(x) < 1.6) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < STAR_MIN_GAP)) continue;
      placed.push({ x, y });
      return { x, y };
    }
    return null;
  };

  const stars: Star[] = [];
  const wanted = 2 + (rand() < Math.min(0.7, 0.2 + index * 0.02) ? 1 : 0);
  const growth = Math.min(0.16, index * 0.004);
  for (let i = 0; i < wanted; i++) {
    const spot = place(STAR_X_RANGE);
    const radius = 0.4 + growth + rand() * 0.22;
    const hue = rand();
    if (spot) stars.push({ id: `${index}:${stars.length}`, ...spot, radius, hue });
  }

  const holes: BlackHole[] = [];
  const holeChance = Math.min(HOLE_CHANCE_MAX, (index - HOLE_FROM_CHUNK + 1) * HOLE_CHANCE_STEP);
  if (index >= HOLE_FROM_CHUNK && rand() < holeChance) {
    const spot = place(HOLE_X_RANGE);
    if (spot) holes.push({ id: `${index}:h`, ...spot });
  }

  const dust = stars.flatMap((s) => dustRing(rand, s.id, s.x, s.y, s.radius + 0.7 + rand() * 0.7));
  return { stars, dust, holes };
}

function generateChunk(seed: number, index: number): Chunk {
  if (index < 0) return EMPTY;
  const rand = mulberry32(hashInts(seed, index));
  const binary = index >= BINARY_FROM_CHUNK && rand() < BINARY_CHANCE;
  return binary ? binaryChunk(rand, index) : scatterChunk(rand, index);
}

function resolve(star: Star, tick: number): Star {
  const o = star.orbit;
  if (!o) return star;
  const angle = o.phase + o.omega * tick * DT;
  return { ...star, x: o.cx + Math.cos(angle) * o.radius, y: o.cy + Math.sin(angle) * o.radius };
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

  starsNear(y: number, range: number, tick: number): Star[] {
    return this.collect(y, range, (c) => c.stars).map((s) => resolve(s, tick));
  }

  dustNear(y: number, range: number): Dust[] {
    return this.collect(y, range, (c) => c.dust);
  }

  holesNear(y: number, range: number): BlackHole[] {
    return this.collect(y, range, (c) => c.holes);
  }

  hole(id: string): BlackHole | undefined {
    return this.chunk(Number(id.split(':')[0])).holes[0];
  }

  star(id: string, tick: number): Star | undefined {
    const [chunkText, indexText] = id.split(':');
    const star = this.chunk(Number(chunkText)).stars[Number(indexText)];
    return star && resolve(star, tick);
  }
}
