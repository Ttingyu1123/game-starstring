import * as THREE from 'three';
import { LATCH_RANGE } from '../sim/config';
import type { Star } from '../sim/types';
import { NOISE, WORLD_VERTEX } from './glsl';

const POOL_SIZE = 20;
/** 每顆星的方形面片要蓋住整個可勾範圍，才能在同一個 shader 裡畫瞄準環。 */
const QUAD_SIZE = (LATCH_RANGE + 0.15) * 2;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uRadius;
uniform float uTime;
uniform float uSeed;
/** 0 = 一般，1 = 按住會勾到這顆，2 = 正勾著。 */
uniform float uFocus;
const float RANGE = ${LATCH_RANGE.toFixed(3)};
const float HALF = ${(QUAD_SIZE / 2).toFixed(3)};
${NOISE}

void main() {
  vec2 d = (vUv - 0.5) * 2.0 * HALF;
  float dist = length(d);
  float r = dist / uRadius;
  vec2 n = d / max(dist, 1e-4);
  vec3 col = vec3(0.0);

  // 星體表面：流動的米粒組織 + 周邊減光。
  float surface = fbm(d * 5.0 / uRadius + uSeed * 9.0 + vec2(uTime * 0.25, -uTime * 0.18));
  float limb = sqrt(max(0.0, 1.0 - r * r));
  float disc = smoothstep(1.0, 0.94, r);
  col += mix(uColor, vec3(1.0), 0.05 + 0.4 * surface * surface) * (0.55 + 0.85 * limb) * disc;

  // 日冕：沿徑向拉長的雜訊做成光芒。
  float rays = fbm(vec2(dot(n, vec2(0.8, 0.6)) * 3.5 + uSeed * 5.0, dot(n, vec2(-0.6, 0.8)) * 3.5 - uTime * 0.35));
  float corona = exp(-max(r - 1.0, 0.0) * (3.6 - uFocus * 0.6)) * (0.25 + 0.9 * rays * rays);
  col += uColor * corona * (1.0 - disc) * (0.75 + uFocus * 0.35);
  col += uColor * 0.035 * exp(-max(r - 1.0, 0.0) * 1.1);

  // 可勾範圍：平時幾乎看不見，成為目標時亮起並旋轉虛線。
  float ring = smoothstep(0.035, 0.0, abs(dist - RANGE));
  float dash = step(0.5, fract(atan(d.y, d.x) * 5.0 / 3.14159 + uTime * 0.25));
  float focus = min(uFocus, 1.0);
  col += mix(vec3(0.5, 0.6, 1.0) * 0.10, mix(vec3(1.0), uColor, 0.4) * (0.5 + 0.5 * dash), focus) * ring;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function starColor(hue: number): THREE.Color {
  const channel = (offset: number) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (hue * 0.8 + offset));
  return new THREE.Color(channel(0), channel(0.33), channel(0.67)).lerp(new THREE.Color(1, 1, 1), 0.06);
}

export interface StarLayer {
  readonly group: THREE.Group;
  update(stars: readonly Star[], time: number, targetId: string | null, activeId: string | null): void;
}

export function createStarLayer(): StarLayer {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(QUAD_SIZE, QUAD_SIZE);
  const pool = Array.from({ length: POOL_SIZE }, () => {
    const material = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uRadius: { value: 0.5 },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uFocus: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material };
  });

  return {
    group,
    update(stars, time, targetId, activeId) {
      pool.forEach((slot, i) => {
        const star = stars[i];
        slot.mesh.visible = star !== undefined;
        if (!star) return;
        slot.mesh.position.set(star.x, star.y, 0);
        const u = slot.material.uniforms;
        (u.uColor!.value as THREE.Color).copy(starColor(star.hue));
        u.uRadius!.value = star.radius;
        u.uTime!.value = time;
        u.uSeed!.value = star.hue;
        u.uFocus!.value = star.id === activeId ? 2 : star.id === targetId ? 1 : 0;
      });
    },
  };
}
