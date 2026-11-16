/** 模擬的固定步長（秒）。所有物理與回放都以 tick 為單位，確保確定性。 */
export const DT = 1 / 120;

export const CRUISE_SPEED = 6;
export const MAX_SPEED = 16;
/** 自由飛行時，超出巡航速度的部分每秒衰減的比率。 */
export const BOOST_DECAY = 0.35;
/** 低於巡航速度時回復的比率（撞牆後用）。 */
export const CRUISE_RECOVER = 2;

/** 能勾住恆星的最大距離（自恆星中心起算）。 */
export const LATCH_RANGE = 2.6;
/** 勾住後軌道向內收縮的速度（單位／秒）：按越久越快也越危險。 */
export const ORBIT_PULL = 0.4;
/** 勾住瞬間的徑向速度收斂到 -ORBIT_PULL 的時間常數。 */
export const RADIAL_TAU = 0.12;
export const RADIAL_KEEP = 0.5;

/** 軌道半徑小於 恆星半徑 × 此倍率 時算「擦邊」。 */
export const GRAZE_FACTOR = 1.7;
export const GRAZE_POINTS_PER_SEC = 40;

export const WALL_X = 5.6;
export const WALL_DAMP = 0.85;

export const VOID_START_Y = -10;
export const VOID_BASE_SPEED = 3;
export const VOID_ACCEL = 0.035;
export const VOID_MAX_SPEED = 10;
/** 虛空最多落後玩家最高點多遠，維持壓迫感。 */
export const VOID_LEASH = 16;

export const DUST_RADIUS = 0.5;
export const DUST_POINTS = 10;
export const LATCH_POINTS = 20;
export const HEIGHT_POINTS = 10;
export const COMBO_CAP = 16;
export const COMBO_STEP = 0.25;

export const CHUNK_HEIGHT = 9;
export const CHUNK_MARGIN = 1.5;
export const STAR_X_RANGE = 3;
export const STAR_MIN_GAP = 3;
