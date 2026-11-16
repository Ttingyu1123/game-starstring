import * as THREE from 'three';
import type { Dust } from '../sim/types';

const MAX_DUST = 200;
const MAX_PARTICLES = 700;
const CAPACITY = MAX_DUST + MAX_PARTICLES;
const PARTICLE_DRAG = 1.6;

const VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uPixelsPerUnit;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelsPerUnit;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float glow = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor.rgb * glow * glow * vColor.a, 1.0);
}
`;

export interface Burst {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly color: THREE.Color;
  readonly speed: number;
  readonly life: number;
  readonly size: number;
  /** 噴發方向（弧度）與散開角度；省略時為全方向。 */
  readonly direction?: number;
  readonly spread?: number;
}

export interface SpriteLayer {
  readonly points: THREE.Points;
  emit(burst: Burst): void;
  update(dt: number, time: number, dust: readonly Dust[], collected: ReadonlySet<string>, pixelsPerUnit: number): void;
  reset(): void;
}

export function createSpriteLayer(): SpriteLayer {
  const positions = new Float32Array(CAPACITY * 3);
  const colors = new Float32Array(CAPACITY * 4);
  const sizes = new Float32Array(CAPACITY);
  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('aColor', colorAttr);
  geometry.setAttribute('aSize', sizeAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uPixelsPerUnit: { value: 32 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  // 粒子池是每幀就地更新的定長緩衝區：這裡刻意不做不可變更新，避免每幀配置數百個物件。
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const rgb = new Float32Array(MAX_PARTICLES * 3);
  let cursor = 0;

  function write(slot: number, x: number, y: number, r: number, g: number, b: number, a: number, s: number): void {
    positions.set([x, y, 0], slot * 3);
    colors.set([r, g, b, a], slot * 4);
    sizes[slot] = s;
  }

  return {
    points,
    emit(burst) {
      for (let i = 0; i < burst.count; i++) {
        const k = cursor;
        cursor = (cursor + 1) % MAX_PARTICLES;
        const angle = burst.direction === undefined
          ? Math.random() * Math.PI * 2
          : burst.direction + (Math.random() - 0.5) * (burst.spread ?? 1);
        const speed = burst.speed * (0.3 + Math.random() * 0.7);
        px[k] = burst.x;
        py[k] = burst.y;
        vx[k] = Math.cos(angle) * speed;
        vy[k] = Math.sin(angle) * speed;
        maxLife[k] = burst.life * (0.5 + Math.random() * 0.5);
        life[k] = maxLife[k]!;
        size[k] = burst.size * (0.6 + Math.random() * 0.8);
        rgb.set([burst.color.r, burst.color.g, burst.color.b], k * 3);
      }
    },
    update(dt, time, dust, collected, pixelsPerUnit) {
      material.uniforms.uPixelsPerUnit!.value = pixelsPerUnit;
      let n = 0;
      for (const d of dust) {
        if (n >= MAX_DUST) break;
        if (collected.has(d.id)) continue;
        const twinkle = 0.65 + 0.35 * Math.sin(time * 4 + d.x * 7.3 + d.y * 3.1);
        write(n++, d.x, d.y, 0.55, 0.95, 1.3, twinkle, 0.3);
      }
      const drag = Math.exp(-PARTICLE_DRAG * dt);
      for (let k = 0; k < MAX_PARTICLES; k++) {
        if (life[k]! <= 0) continue;
        life[k]! -= dt;
        vx[k]! *= drag;
        vy[k]! *= drag;
        px[k]! += vx[k]! * dt;
        py[k]! += vy[k]! * dt;
        const t = Math.max(0, life[k]! / maxLife[k]!);
        write(n++, px[k]!, py[k]!, rgb[k * 3]!, rgb[k * 3 + 1]!, rgb[k * 3 + 2]!, t * 1.6, size[k]! * (0.4 + 0.6 * t));
      }
      geometry.setDrawRange(0, n);
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    },
    reset() {
      life.fill(0);
    },
  };
}
