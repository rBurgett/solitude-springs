// GPU-instanced grass blades on a MeshStandardMaterial (so they receive shadows, fog and
// environment light for free). Wind sway in the vertex shader; the trash mask turns blades
// brown and shorter (plan §17).
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

export interface GrassOptions {
  /** World extent covered (centred at origin). */
  size: number;
  count: number;
  seed: number;
  heightAt(x: number, z: number): number;
  /** 0..1 density at a point (from the splat grass weight); blades are skipped below 0.15. */
  densityAt(x: number, z: number): number;
  trashMask: THREE.Texture;
  bladeHeight?: number;
}

export interface Grass {
  mesh: THREE.Mesh;
  update(time: number): void;
  count: number;
}

export function buildGrass(o: GrassOptions): Grass {
  const rng = new Rng(o.seed);
  const half = o.size / 2;
  const offsets: number[] = [];
  const params: number[] = []; // yaw, height scale, colour variation, bend
  let placed = 0;
  let attempts = 0;
  while (placed < o.count && attempts < o.count * 4) {
    attempts++;
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const d = o.densityAt(x, z);
    if (d < 0.15 || rng.next() > d) continue;
    const y = o.heightAt(x, z);
    offsets.push(x, y, z);
    params.push(rng.range(0, Math.PI * 2), rng.range(0.55, 1.5) * (0.7 + 0.6 * d), rng.next(), rng.range(-0.35, 0.35));
    placed++;
  }
  // One blade: a tapered strip of 4 segments (5 rows × 2 verts, 8 triangles). Bent in the shader.
  const rows = 5;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const width = 0.022;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const w = width * (1 - t * t) * 0.5;
    pos.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
  }
  for (let r = 0; r < rows - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(rows * 2 * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geo.setAttribute('params', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  geo.instanceCount = placed;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.size);

  const bladeHeight = o.bladeHeight ?? 0.26;
  const uniforms = {
    uTime: { value: 0 },
    uTrash: { value: o.trashMask },
    uSize: { value: o.size },
    uBladeHeight: { value: bladeHeight },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 offset;
attribute vec4 params;
uniform float uTime, uSize, uBladeHeight;
uniform sampler2D uTrash;
varying vec3 vGrassColor;
varying float vBladeT;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float trash = texture2D(uTrash, offset.xz / uSize + 0.5).r;
float yaw = params.x;
float cy = cos(yaw), sy = sin(yaw);
// blades lean toward an "up" normal so they shade like the ground rather than as flat cards
vec3 objectNormal = normalize(vec3(sy * 0.35, 1.0, cy * 0.35));`,
      )
      .replace(
        '#include <begin_vertex>',
        `float h = uBladeHeight * params.y * (1.0 - trash * 0.45);
float t = position.y;
vBladeT = t;
vec3 local = vec3(position.x * (1.0 + params.z * 0.4), t * h, 0.0);
// wind: a travelling gust plus per-blade jitter, bending the tip more than the base
float gust = sin(uTime * 1.4 + offset.x * 0.35 + offset.z * 0.2) * 0.5 + sin(uTime * 2.7 + offset.z * 0.9) * 0.25;
float bend = (params.w + gust * 0.35) * t * t;
local.x += bend * h * cy;
local.z += bend * h * sy * 0.6;
local.y -= abs(bend) * h * 0.25 * t;
vec3 rotated = vec3(local.x * cy - local.z * sy, local.y, local.x * sy + local.z * cy);
vec3 transformed = rotated + offset;
vec3 healthy = mix(vec3(0.10, 0.27, 0.05), vec3(0.30, 0.50, 0.11), params.z * 0.7 + t * 0.5);
vec3 dead = mix(vec3(0.42, 0.32, 0.12), vec3(0.72, 0.6, 0.3), params.z * 0.6 + t * 0.5);
vGrassColor = mix(healthy, dead, trash);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;\nvarying float vBladeT;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassColor * (0.55 + 0.45 * vBladeT);');
  };
  mat.customProgramCacheKey = () => 'grass-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    count: placed,
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
}
