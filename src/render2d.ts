import { LATCH_RANGE, WALL_X } from './sim/config';
import { latchTarget, multiplier, score } from './sim/step';
import type { SimState, Vec, WorldLike } from './sim/types';

/** 畫面寬度對應的世界單位數。 */
const VIEW_WIDTH = 12;
/** 彗星在畫面上的垂直位置（自底部起算的比例）。 */
const COMET_ANCHOR = 0.32;
const TRAIL_LENGTH = 48;

export interface Renderer {
  draw(state: SimState, world: WorldLike, best: number): void;
  reset(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('此瀏覽器無法建立 2D 畫布');
  let trail: Vec[] = [];

  function resize(): { w: number; h: number; scale: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, scale: w / VIEW_WIDTH };
  }

  function draw(state: SimState, world: WorldLike, best: number): void {
    const { w, h, scale } = resize();
    const camY = state.pos.y + (h * (0.5 - COMET_ANCHOR)) / scale;
    const sx = (x: number) => w / 2 + x * scale;
    const sy = (y: number) => h / 2 - (y - camY) * scale;
    const viewRange = h / scale;

    ctx!.fillStyle = '#05060f';
    ctx!.fillRect(0, 0, w, h);

    ctx!.strokeStyle = 'rgba(120,140,255,0.25)';
    ctx!.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx!.beginPath();
      ctx!.moveTo(sx(side * WALL_X), 0);
      ctx!.lineTo(sx(side * WALL_X), h);
      ctx!.stroke();
    }

    const target = state.latch ? null : latchTarget(state.pos, world);
    for (const star of world.starsNear(camY, viewRange)) {
      const active = state.latch?.starId === star.id;
      const color = `hsl(${Math.round(20 + star.hue * 200)} 90% 65%)`;
      ctx!.strokeStyle = active || target?.id === star.id ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.08)';
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.arc(sx(star.x), sy(star.y), LATCH_RANGE * scale, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.fillStyle = color;
      ctx!.beginPath();
      ctx!.arc(sx(star.x), sy(star.y), star.radius * scale, 0, Math.PI * 2);
      ctx!.fill();
      if (active) {
        ctx!.strokeStyle = color;
        ctx!.beginPath();
        ctx!.moveTo(sx(star.x), sy(star.y));
        ctx!.lineTo(sx(state.pos.x), sy(state.pos.y));
        ctx!.stroke();
      }
    }

    ctx!.fillStyle = '#9fe8ff';
    for (const dust of world.dustNear(camY, viewRange)) {
      if (state.collected.has(dust.id)) continue;
      ctx!.beginPath();
      ctx!.arc(sx(dust.x), sy(dust.y), 0.09 * scale, 0, Math.PI * 2);
      ctx!.fill();
    }

    trail = [...trail, state.pos].slice(-TRAIL_LENGTH);
    trail.forEach((p, i) => {
      const t = i / trail.length;
      ctx!.fillStyle = `rgba(255,255,255,${t * 0.6})`;
      ctx!.beginPath();
      ctx!.arc(sx(p.x), sy(p.y), (0.05 + t * 0.12) * scale, 0, Math.PI * 2);
      ctx!.fill();
    });
    ctx!.fillStyle = state.grazing ? '#ffd27a' : '#ffffff';
    ctx!.beginPath();
    ctx!.arc(sx(state.pos.x), sy(state.pos.y), 0.2 * scale, 0, Math.PI * 2);
    ctx!.fill();

    const voidTop = sy(state.voidY);
    if (voidTop < h) {
      const grad = ctx!.createLinearGradient(0, voidTop - 2 * scale, 0, voidTop);
      grad.addColorStop(0, 'rgba(255,40,90,0)');
      grad.addColorStop(1, 'rgba(255,40,90,0.9)');
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, voidTop - 2 * scale, w, 2 * scale);
      ctx!.fillStyle = '#1a0010';
      ctx!.fillRect(0, voidTop, w, h - voidTop);
    }

    const font = (px: number) => `600 ${Math.round(px * scale)}px system-ui, sans-serif`;
    ctx!.fillStyle = '#ffffff';
    ctx!.textAlign = 'left';
    ctx!.font = font(0.7);
    ctx!.fillText(String(score(state)), 0.5 * scale, 1.2 * scale);
    ctx!.font = font(0.36);
    ctx!.fillStyle = 'rgba(255,255,255,0.6)';
    ctx!.fillText(`最佳 ${best}`, 0.5 * scale, 1.8 * scale);
    if (state.combo > 0) {
      ctx!.textAlign = 'right';
      ctx!.fillStyle = '#ffd27a';
      ctx!.font = font(0.5);
      ctx!.fillText(`連擊 ${state.combo}  ×${multiplier(state.combo).toFixed(2)}`, w - 0.5 * scale, 1.2 * scale);
    }

    ctx!.textAlign = 'center';
    if (!state.alive) {
      ctx!.fillStyle = 'rgba(5,6,15,0.7)';
      ctx!.fillRect(0, 0, w, h);
      ctx!.fillStyle = '#ffffff';
      ctx!.font = font(0.9);
      ctx!.fillText(state.deathCause === 'star' ? '墜入恆星' : '被虛空吞噬', w / 2, h * 0.42);
      ctx!.font = font(0.45);
      ctx!.fillText(`分數 ${score(state)}　點一下再來一局`, w / 2, h * 0.5);
    } else if (state.tick < 360) {
      ctx!.fillStyle = 'rgba(255,255,255,0.8)';
      ctx!.font = font(0.42);
      ctx!.fillText('按住：勾住恆星繞行　放開：甩出去', w / 2, h * 0.85);
    }
  }

  return { draw, reset: () => { trail = []; } };
}
