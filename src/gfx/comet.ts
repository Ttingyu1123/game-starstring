import * as THREE from 'three';
import type { Vec } from '../sim/types';
import { WORLD_VERTEX } from './glsl';

const TRAIL_SAMPLES = 56;
const TRAIL_WIDTH = 0.2;
const HEAD_SIZE = 2.2;
/** 薄荷綠：彗星本身只會是青、洋紅、金三色，幽靈用它們之外的顏色才不會混淆。 */
const GHOST_COLOR = new THREE.Color(0.45, 1.3, 0.8);
const GHOST_RING_RADIUS = 0.36;

const GHOST_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uTime;
void main() {
  vec2 p = (vUv - 0.5) * ${HEAD_SIZE.toFixed(2)};
  float r = length(p);
  float dash = 0.55 + 0.45 * sin(atan(p.y, p.x) * 6.0 + uTime * 2.5);
  float ring = exp(-pow((r - ${GHOST_RING_RADIUS.toFixed(2)}) / 0.035, 2.0)) * dash;
  float core = exp(-r * r * 90.0);
  float halo = exp(-r * 5.0) * 0.25;
  gl_FragColor = vec4(uColor * (ring * 1.6 + halo) + vec3(1.0) * core * 1.2, 1.0);
}
`;

const HEAD_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
void main() {
  float r = length(vUv - 0.5) * ${HEAD_SIZE.toFixed(2)};
  vec3 col = vec3(1.0) * exp(-r * r * 70.0) * 3.5 + uColor * exp(-r * 6.0) * 1.1;
  gl_FragColor = vec4(col, 1.0);
}
`;

const TRAIL_VERTEX = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAGMENT = /* glsl */ `
precision highp float;
varying float vAge;
varying float vSide;
uniform vec3 uColor;
void main() {
  float across = 1.0 - abs(vSide);
  float glow = across * across * vAge * vAge;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), vAge * vAge * 0.7) * glow * 2.2, 1.0);
}
`;

const TETHER_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uTime;
uniform float uLength;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float pulse = 0.55 + 0.45 * sin(vUv.x * uLength * 7.0 - uTime * 16.0);
  float core = exp(-across * 14.0) * 1.6 + exp(-across * 4.0) * 0.25;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3) * core * pulse, 1.0);
}
`;

function additive(fragmentShader: string, vertexShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export interface CometLayer {
  readonly group: THREE.Group;
  update(pos: Vec, visible: boolean, color: THREE.Color, tether: { star: Vec; color: THREE.Color } | null, time: number): void;
  /** 上一次最佳紀錄的幽靈彗星；傳 null 隱藏。 */
  setGhost(pos: Vec | null, time: number): void;
  reset(): void;
}

export function createCometLayer(): CometLayer {
  const group = new THREE.Group();

  const headMaterial = additive(HEAD_FRAGMENT, WORLD_VERTEX, { uColor: { value: new THREE.Color(1, 1, 1) } });
  const head = new THREE.Mesh(new THREE.PlaneGeometry(HEAD_SIZE, HEAD_SIZE), headMaterial);
  head.renderOrder = 4;

  // 彗尾是一條每幀重建的帶狀網格：每個取樣點左右各一個頂點。
  const positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const ages = new Float32Array(TRAIL_SAMPLES * 2);
  const sides = new Float32Array(TRAIL_SAMPLES * 2);
  const indices: number[] = [];
  for (let i = 0; i < TRAIL_SAMPLES; i++) {
    sides[i * 2] = -1;
    sides[i * 2 + 1] = 1;
    if (i < TRAIL_SAMPLES - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const trailGeometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const ageAttr = new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute('position', positionAttr);
  trailGeometry.setAttribute('aAge', ageAttr);
  trailGeometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  trailGeometry.setIndex(indices);
  const trailMaterial = additive(TRAIL_FRAGMENT, TRAIL_VERTEX, { uColor: { value: new THREE.Color(0.5, 0.8, 1) } });
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  trail.renderOrder = 3;

  const tetherMaterial = additive(TETHER_FRAGMENT, WORLD_VERTEX, {
    uColor: { value: new THREE.Color() },
    uTime: { value: 0 },
    uLength: { value: 1 },
  });
  const tetherMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tetherMaterial);
  tetherMesh.renderOrder = 2;

  const ghostMaterial = additive(GHOST_FRAGMENT, WORLD_VERTEX, { uColor: { value: GHOST_COLOR }, uTime: { value: 0 } });
  const ghost = new THREE.Mesh(head.geometry, ghostMaterial);
  ghost.renderOrder = 2;
  ghost.visible = false;

  group.add(trail, tetherMesh, ghost, head);
  let history: Vec[] = [];

  function rebuildTrail(): void {
    const count = history.length;
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      // 歷史不足時把多出的頂點全疊在最舊的點上，形成退化三角形（不會畫出來）。
      const k = Math.max(0, i - (TRAIL_SAMPLES - count));
      const p = history[k] ?? { x: 0, y: 0 };
      const prev = history[Math.max(0, k - 1)] ?? p;
      const next = history[Math.min(count - 1, k + 1)] ?? p;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const age = count > 1 ? k / (count - 1) : 0;
      const half = TRAIL_WIDTH * (0.25 + 0.75 * age);
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      positions.set([p.x - nx, p.y - ny, 0, p.x + nx, p.y + ny, 0], i * 6);
      ages[i * 2] = age;
      ages[i * 2 + 1] = age;
    }
    positionAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
  }

  return {
    group,
    update(pos, visible, color, tether, time) {
      head.visible = visible;
      head.position.set(pos.x, pos.y, 0);
      (headMaterial.uniforms.uColor!.value as THREE.Color).copy(color);
      (trailMaterial.uniforms.uColor!.value as THREE.Color).copy(color);

      if (visible) history = [...history, pos].slice(-TRAIL_SAMPLES);
      else history = history.slice(1);
      trail.visible = history.length > 1;
      if (trail.visible) rebuildTrail();

      tetherMesh.visible = visible && tether !== null;
      if (tether && visible) {
        const dx = pos.x - tether.star.x;
        const dy = pos.y - tether.star.y;
        const length = Math.hypot(dx, dy);
        tetherMesh.position.set((pos.x + tether.star.x) / 2, (pos.y + tether.star.y) / 2, 0);
        tetherMesh.rotation.z = Math.atan2(dy, dx);
        tetherMesh.scale.set(length, 0.5, 1);
        const u = tetherMaterial.uniforms;
        (u.uColor!.value as THREE.Color).copy(tether.color);
        u.uTime!.value = time;
        u.uLength!.value = length;
      }
    },
    setGhost(pos, time) {
      ghost.visible = pos !== null;
      ghostMaterial.uniforms.uTime!.value = time;
      if (pos) ghost.position.set(pos.x, pos.y, 0);
    },
    reset() {
      history = [];
      ghost.visible = false;
    },
  };
}
