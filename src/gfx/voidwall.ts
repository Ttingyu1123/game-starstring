import * as THREE from 'three';
import { NOISE, WORLD_VERTEX } from './glsl';

const HEIGHT = 80;
const WIDTH = 120;
/** 面片頂端高出虛空邊界多少，留給邊緣的輝光。 */
const GLOW_ROOM = 5;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vWorld;
uniform float uVoidY;
uniform float uTime;
${NOISE}
void main() {
  float wobble = (fbm(vec2(vWorld.x * 0.7, uTime * 0.7)) - 0.5) * 1.3 + sin(vWorld.x * 2.1 + uTime * 2.3) * 0.12;
  float h = vWorld.y - (uVoidY + wobble);
  float body = smoothstep(0.15, -0.35, h);
  float flames = fbm(vec2(vWorld.x * 1.6, vWorld.y * 1.2 - uTime * 2.5));
  // 輝光只留在邊界附近：往上緩慢衰減成火舌，往本體內部迅速熄滅。
  float edge = h > 0.0 ? exp(-h * 1.6) : exp(h * 3.5);
  vec3 glow = vec3(1.5, 0.10, 0.42) * edge * (0.2 + 0.9 * flames * flames);
  glow += vec3(2.2, 0.7, 1.0) * exp(-abs(h) * 11.0);
  vec3 deep = vec3(0.022, 0.0, 0.014) + vec3(0.22, 0.01, 0.08) * flames * flames * exp(min(h, 0.0) * 0.35);
  // 預乘 alpha：本體遮住後方、輝光疊加在上面。
  gl_FragColor = vec4(deep * body + glow, body);
}
`;

export interface VoidWall {
  readonly mesh: THREE.Mesh;
  update(voidY: number, time: number): void;
}

export function createVoidWall(): VoidWall {
  const material = new THREE.ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uVoidY: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return {
    mesh,
    update(voidY, time) {
      mesh.position.set(0, voidY + GLOW_ROOM - HEIGHT / 2, 0);
      material.uniforms.uVoidY!.value = voidY;
      material.uniforms.uTime!.value = time;
    },
  };
}
