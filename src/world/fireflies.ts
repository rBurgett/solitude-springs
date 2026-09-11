// Night fireflies: a handful of drifting, blinking points (plan §7.3).
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

export interface Fireflies {
  points: THREE.Points;
  update(time: number): void;
}

export function buildFireflies(count: number, area: { x: number; z: number; radius: number }, heightAt: (x: number, z: number) => number, seed = 5): Fireflies {
  const rng = new Rng(seed);
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count * 2);
  const base: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = area.radius * Math.sqrt(rng.next());
    const x = area.x + Math.cos(a) * r;
    const z = area.z + Math.sin(a) * r;
    const y = heightAt(x, z) + rng.range(0.3, 1.8);
    base.push(x, y, z);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    phase[i * 2] = rng.range(0, 100);
    phase[i * 2 + 1] = rng.range(0.6, 1.6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec2 phase;
      uniform float uTime;
      varying float vGlow;
      void main() {
        vec3 p = position;
        float t = uTime * phase.y + phase.x;
        p.x += sin(t * 0.7) * 0.6;
        p.y += sin(t * 1.1 + 1.0) * 0.3;
        p.z += cos(t * 0.5) * 0.6;
        float blink = smoothstep(0.55, 0.95, sin(t * 2.3) * 0.5 + 0.5);
        vGlow = blink;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(22.0, (3.0 + 5.0 * blink) * (30.0 / max(2.0, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * vGlow * 2.5, a * vGlow);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    update(time) {
      mat.uniforms.uTime!.value = time;
    },
  };
}
