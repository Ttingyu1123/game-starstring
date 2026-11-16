export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface Star {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 0–1，決定顏色與音高。 */
  readonly hue: number;
}

export interface Dust {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface WorldLike {
  starsNear(y: number, range: number): readonly Star[];
  dustNear(y: number, range: number): readonly Dust[];
  star(id: string): Star | undefined;
}

/** 勾住期間以極座標積分：半徑不會因數值誤差漂移。 */
export interface Latch {
  readonly starId: string;
  readonly r: number;
  readonly theta: number;
  readonly vr: number;
  /** 角動量 r × 切向速度，勾住期間守恆。 */
  readonly L: number;
  readonly sense: 1 | -1;
}

export type DeathCause = 'star' | 'void';

export type SimEvent =
  | { readonly type: 'latch'; readonly starId: string; readonly combo: number; readonly fresh: boolean }
  | { readonly type: 'release'; readonly speed: number }
  | { readonly type: 'dust'; readonly x: number; readonly y: number }
  | { readonly type: 'bounce'; readonly x: number; readonly y: number }
  | { readonly type: 'death'; readonly cause: DeathCause };

export interface SimState {
  readonly tick: number;
  readonly pos: Vec;
  readonly vel: Vec;
  readonly latch: Latch | null;
  readonly alive: boolean;
  readonly deathCause: DeathCause | null;
  readonly maxY: number;
  readonly voidY: number;
  readonly bonus: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastStarId: string | null;
  readonly grazing: boolean;
  readonly collected: ReadonlySet<string>;
  /** 只包含「這一個 tick」發生的事件，供音效與特效使用。 */
  readonly events: readonly SimEvent[];
}
