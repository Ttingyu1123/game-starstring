import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CRUISE_SPEED, HOLE_REACH, LATCH_RANGE, MAX_SPEED } from '../sim/config';
import { latchedBody, latchTarget } from '../sim/step';
import type { SimEvent, SimState, Vec, WorldLike } from '../sim/types';
import { createBackground, MAX_HOLES } from './background';
import { createCometLayer } from './comet';
import { createSpriteLayer } from './sprites';
import { createStarLayer, starColor } from './stars';
import { createVoidWall } from './voidwall';

/** 畫面至少要容納的世界寬度與高度；實際比例取兩者較嚴格的一個。 */
const MIN_VIEW_WIDTH = 12;
const MIN_VIEW_HEIGHT = 20;
const MAX_PIXEL_RATIO = 2;
/** 彗星在畫面上的理想高度與允許範圍（自底部起算的比例）。 */
const COMET_ANCHOR = 0.34;
const COMET_MIN = 0.2;
const COMET_MAX = 0.62;
const CAMERA_FOLLOW = 5;
const SHAKE_DECAY = 7;
const FAST_SPEED = 9;

const COLOR_CALM = new THREE.Color(0.45, 0.8, 1.25);
const COLOR_FAST = new THREE.Color(1.25, 0.55, 1.1);
const COLOR_GRAZE = new THREE.Color(1.5, 1.0, 0.35);
const COLOR_DUST = new THREE.Color(0.6, 1.0, 1.4);
const COLOR_WALL = new THREE.Color(0.4, 0.7, 1.8);
const COLOR_DEATH = new THREE.Color(1.6, 0.9, 0.6);
const COLOR_HOLE = new THREE.Color(1.0, 0.55, 1.7);

export interface FrameInput {
  readonly state: SimState;
  readonly world: WorldLike;
  readonly dt: number;
  readonly time: number;
  readonly ghost: Vec | null;
}

export interface Probe {
  /** 亮像素（任一通道 > 50%）占全畫面的比例。 */
  readonly lit: number;
  /** 帶明顯色彩（非灰階）的像素比例。 */
  readonly colorful: number;
}

export interface Gfx {
  frame(input: FrameInput): void;
  handleEvents(events: readonly SimEvent[], state: SimState, world: WorldLike): void;
  reset(): void;
  probe(): Probe;
}

export function createGfx(canvas: HTMLCanvasElement): Gfx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const background = createBackground();
  const stars = createStarLayer();
  const comet = createCometLayer();
  const sprites = createSpriteLayer();
  const voidWall = createVoidWall();
  scene.add(background.mesh, stars.group, comet.group, sprites.points, voidWall.mesh);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let width = 0;
  let height = 0;
  let halfW = MIN_VIEW_WIDTH / 2;
  let halfH = MIN_VIEW_HEIGHT / 2;
  let pixelsPerUnit = 32;
  let camY: number | null = null;
  let shake = 0;
  let wallFlash = 0;
  const cometColor = COLOR_CALM.clone();

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    const unit = Math.min(w / MIN_VIEW_WIDTH, h / MIN_VIEW_HEIGHT);
    halfW = w / unit / 2;
    halfH = h / unit / 2;
    pixelsPerUnit = unit * ratio;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  function followCamera(cometY: number, dt: number): number {
    const viewH = halfH * 2;
    const ideal = cometY + viewH * (0.5 - COMET_ANCHOR);
    if (camY === null) return ideal;
    const eased = camY + (ideal - camY) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    const lowest = cometY + viewH * (0.5 - COMET_MAX);
    const highest = cometY + viewH * (0.5 - COMET_MIN);
    return Math.min(highest, Math.max(lowest, eased));
  }

  function frame({ state, world, dt, time, ghost }: FrameInput): void {
    resize();
    if (state.alive || camY === null) camY = followCamera(state.pos.y, dt);
    shake *= Math.exp(-SHAKE_DECAY * dt);
    wallFlash *= Math.exp(-5 * dt);
    const camX = (Math.random() - 0.5) * shake;
    const shakenY = camY + (Math.random() - 0.5) * shake;
    camera.position.set(camX, shakenY, 5);

    const speed = Math.hypot(state.vel.x, state.vel.y);
    const boost = Math.min(1, Math.max(0, (speed - CRUISE_SPEED) / (MAX_SPEED - CRUISE_SPEED)));
    cometColor.copy(COLOR_CALM).lerp(COLOR_FAST, boost);
    if (state.grazing) cometColor.copy(COLOR_GRAZE);
    bloom.strength = 0.5 + boost * 0.35 + (state.alive ? 0 : 0.2);

    const visibleStars = world.starsNear(camY, halfH + LATCH_RANGE, state.tick);
    const active = state.latch ? latchedBody(state.latch, world, state.tick) ?? null : null;
    const activeHue = active ? visibleStars.find((s) => s.id === active.id)?.hue : undefined;
    const tetherColor = activeHue === undefined ? COLOR_HOLE : starColor(activeHue);
    const target = state.alive && !state.latch ? latchTarget(state.pos, world, state.tick) : null;
    stars.update(visibleStars, time, target?.id ?? null, active?.id ?? null);

    comet.update(
      state.pos,
      state.alive,
      cometColor,
      active ? { star: active, color: tetherColor } : null,
      time,
    );

    comet.setGhost(ghost);

    if (state.alive && dt > 0) {
      const back = Math.atan2(-state.vel.y, -state.vel.x);
      if (state.grazing) {
        sprites.emit({ x: state.pos.x, y: state.pos.y, count: 3, color: COLOR_GRAZE, speed: 4, life: 0.5, size: 0.3, direction: back, spread: 1.6 });
      } else if (speed > FAST_SPEED) {
        sprites.emit({ x: state.pos.x, y: state.pos.y, count: 1, color: cometColor, speed: 2, life: 0.45, size: 0.26, direction: back, spread: 0.7 });
      }
    }
    sprites.update(dt, time, world.dustNear(camY, halfH + 1), state.collected, pixelsPerUnit);

    voidWall.update(state.voidY, time);
    background.update(camX, shakenY, halfW, halfH, time, world.holesNear(camY, halfH + HOLE_REACH).slice(0, MAX_HOLES), wallFlash, active?.id ?? target?.id ?? null);
    composer.render();
  }

  function handleEvents(events: readonly SimEvent[], state: SimState, world: WorldLike): void {
    const { x, y } = state.pos;
    for (const event of events) {
      switch (event.type) {
        case 'latch': {
          const star = event.kind === 'star' ? world.star(event.bodyId, state.tick) : undefined;
          const color = star ? starColor(star.hue) : COLOR_HOLE;
          sprites.emit({ x, y, count: event.fresh ? 18 : 6, color, speed: 3.5, life: 0.5, size: 0.34 });
          break;
        }
        case 'release': {
          const power = Math.min(1, event.speed / MAX_SPEED);
          sprites.emit({
            x, y, count: Math.round(6 + power * 22), color: cometColor, speed: 3 + power * 6, life: 0.6, size: 0.34,
            direction: Math.atan2(-state.vel.y, -state.vel.x), spread: 1.1,
          });
          shake = Math.max(shake, power * power * 0.35);
          break;
        }
        case 'dust':
          sprites.emit({ x: event.x, y: event.y, count: 7, color: COLOR_DUST, speed: 2.5, life: 0.45, size: 0.28 });
          break;
        case 'bounce':
          sprites.emit({ x: event.x, y: event.y, count: 20, color: COLOR_WALL, speed: 5, life: 0.5, size: 0.32 });
          shake = Math.max(shake, 0.3);
          wallFlash = 1.2;
          break;
        case 'death':
          sprites.emit({ x, y, count: 160, color: COLOR_DEATH, speed: 9, life: 1.3, size: 0.42 });
          sprites.emit({ x, y, count: 60, color: cometColor, speed: 4, life: 1.6, size: 0.5 });
          shake = 0.9;
          break;
      }
    }
  }

  function probe(): Probe {
    composer.render();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    let colorful = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const max = Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
      const min = Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
      if (max > 127) lit += 1;
      if (max > 60 && max - min > 40) colorful += 1;
    }
    const total = w * h;
    return { lit: lit / total, colorful: colorful / total };
  }

  return {
    frame,
    handleEvents,
    reset() {
      camY = null;
      shake = 0;
      comet.reset();
      sprites.reset();
    },
    probe,
  };
}
