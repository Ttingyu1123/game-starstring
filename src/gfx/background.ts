import * as THREE from 'three';
import { HOLE_HORIZON, HOLE_REACH, LATCH_RANGE, WALL_X } from '../sim/config';
import type { BlackHole } from '../sim/types';
import { NOISE } from './glsl';

export const MAX_HOLES = 4;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vNdc;
uniform vec2 uCam;
uniform vec2 uView;
uniform float uTime;
uniform vec3 uHoles[${MAX_HOLES}];
uniform float uWallFlash;
const float HORIZON = ${HOLE_HORIZON.toFixed(3)};
const float REACH = ${HOLE_REACH.toFixed(3)};
const float WALL = ${WALL_X.toFixed(3)};
const float LATCH = ${LATCH_RANGE.toFixed(3)};
${NOISE}

float starLayer(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 h = hash22(cell + seed);
  float b = hash21(cell * 1.7 + seed + 3.1);
  float d = length(f - (0.2 + 0.6 * h));
  float twinkle = 0.7 + 0.3 * sin(uTime * (1.0 + b * 3.0) + b * 40.0);
  return smoothstep(0.03 + 0.07 * b, 0.0, d) * step(0.5, b) * b * twinkle;
}

void main() {
  vec2 p = uCam + vNdc * uView;
  vec2 lens = vec2(0.0);
  vec3 holeGlow = vec3(0.0);
  float shadow = 1.0;

  for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (uHoles[i].z < 0.5) continue;
    vec2 d = p - uHoles[i].xy;
    float r = length(d);
    vec2 n = d / max(r, 1e-4);
    // 重力透鏡：越靠近視界，背景取樣點被往外推得越多。
    lens -= n * (0.55 / (r + 0.12)) * smoothstep(REACH * 1.4, 0.3, r);

    // 吸積盤：內圈轉得比外圈快，用旋轉後的方向向量取雜訊，避免 atan 的接縫。
    vec2 spun = rotate2(n, uTime * 1.3 + 2.6 / (r + 0.3));
    float streaks = fbm(spun * 3.0 + r * 4.0);
    float disk = smoothstep(HORIZON, HORIZON * 1.35, r) * smoothstep(1.35, 0.45, r);
    vec3 diskColor = mix(vec3(2.2, 0.9, 0.3), vec3(0.7, 0.3, 1.6), smoothstep(0.4, 1.2, r));
    holeGlow += diskColor * disk * (0.25 + 1.5 * streaks * streaks);
    holeGlow += vec3(2.4, 1.9, 1.5) * exp(-abs(r - HORIZON * 1.22) * 42.0);

    // 向內流動的波紋，提示引力作用範圍。
    float ripple = pow(0.5 + 0.5 * sin(r * 7.0 + uTime * 5.0), 4.0);
    holeGlow += vec3(0.5, 0.25, 1.0) * ripple * 0.07 * smoothstep(REACH, REACH * 0.35, r);
    shadow *= smoothstep(HORIZON * 0.95, HORIZON * 1.12, r);

    // 可勾範圍環：z = 2 代表這個黑洞是目前的目標或正勾著。
    float focus = step(1.5, uHoles[i].z);
    holeGlow += vec3(0.8, 0.6, 1.5) * smoothstep(0.035, 0.0, abs(r - LATCH)) * (0.10 + focus * 0.9);
  }

  vec2 q = p + lens;
  float hue = uCam.y * 0.0025;
  vec3 tintA = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.62, 0.75, 0.92)));
  vec3 tintB = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.95, 0.6, 0.72)));
  vec2 nebulaP = (q - uCam * 0.82) * 0.13;
  float n1 = fbm(nebulaP + vec2(0.0, uTime * 0.004));
  float n2 = fbm(nebulaP * 1.9 + vec2(31.0, 7.0));
  vec3 col = vec3(0.004, 0.005, 0.014);
  col += tintA * pow(n1, 3.0) * 0.20;
  col += tintB * pow(n2, 4.0) * 0.22;

  col += vec3(0.9, 0.95, 1.2) * starLayer((q - uCam * 0.55) * 1.3, 11.0) * 0.8;
  col += vec3(1.0, 0.9, 0.8) * starLayer((q - uCam * 0.72) * 2.4, 23.0) * 0.45;
  col += vec3(0.8, 0.85, 1.0) * starLayer((q - uCam * 0.86) * 4.3, 37.0) * 0.25;

  float wallDist = abs(abs(p.x) - WALL);
  float wallPulse = 0.16 + 0.07 * sin(p.y * 3.0 - uTime * 4.0) + uWallFlash;
  col *= mix(1.0, 0.3, smoothstep(WALL - 0.05, WALL + 0.4, abs(p.x)));
  col += vec3(0.25, 0.5, 1.6) * exp(-wallDist * 14.0) * wallPulse;

  gl_FragColor = vec4((col + holeGlow) * shadow, 1.0);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface Background {
  readonly mesh: THREE.Mesh;
  update(camX: number, camY: number, halfW: number, halfH: number, time: number, holes: readonly BlackHole[], wallFlash: number, focusId: string | null): void;
}

export function createBackground(): Background {
  const holeUniforms = Array.from({ length: MAX_HOLES }, () => new THREE.Vector3());
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCam: { value: new THREE.Vector2() },
      uView: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uHoles: { value: holeUniforms },
      uWallFlash: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return {
    mesh,
    update(camX, camY, halfW, halfH, time, holes, wallFlash, focusId) {
      const u = material.uniforms;
      (u.uCam!.value as THREE.Vector2).set(camX, camY);
      (u.uView!.value as THREE.Vector2).set(halfW, halfH);
      u.uTime!.value = time;
      u.uWallFlash!.value = wallFlash;
      holeUniforms.forEach((v, i) => {
        const hole = holes[i];
        if (hole) v.set(hole.x, hole.y, hole.id === focusId ? 2 : 1);
        else v.set(0, 0, 0);
      });
    },
  };
}
