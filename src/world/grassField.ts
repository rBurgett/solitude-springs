// Windowed GPU grass for the full map (plan §17): a fixed pool of instanced blades that follows
// the camera. Each instance owns a cell of a square window; the vertex shader hashes the
// absolute world cell for jitter/yaw/height (so blades don't swim as the window moves), reads
// the ground height from a float texture of the height grid, the density from the splat map and
// the trash mask for dead grass. Blades fade out toward the window edge and the draw distance.
import * as THREE from 'three';
import type { WorldGrid, SplatTextures } from './map.ts';

export interface GrassFieldOptions {
  /** Blades per side of the window (blades = side²). */
  side: number;
  spacing: number;
  bladeHeight?: number;
  /** World heights as a float texture. */
  heightTexture: THREE.DataTexture;
  gridSize: number;
  splat: SplatTextures;
}

export interface GrassField {
  mesh: THREE.Mesh;
  update(time: number, camera: THREE.Vector3): void;
  count: number;
  setDensity(scale: number): void;
}

/** Upload the height grid as an R32F texture for GPU placement. */
export function makeHeightTexture(grid: WorldGrid): THREE.DataTexture {
  const tex = new THREE.DataTexture(grid.heights, grid.n, grid.n, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildGrassField(o: GrassFieldOptions): GrassField {
  const side = o.side;
  const count = side * side;
  const cells = new Float32Array(count * 2);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    cells[(j * side + i) * 2] = i - side / 2;
    cells[(j * side + i) * 2 + 1] = j - side / 2;
  }
  const rows = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const width = 0.024;
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
  geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.gridSize);

  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uSpacing: { value: o.spacing },
    uSide: { value: side },
    uSize: { value: o.gridSize },
    uHeight: { value: o.heightTexture },
    uSplat: { value: o.splat.splatMap },
    uTrash: { value: o.splat.trashMask },
    uBladeHeight: { value: o.bladeHeight ?? 0.3 },
    uDensity: { value: 1 },
    uCamera: { value: new THREE.Vector3() },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 cell;
uniform float uTime, uSpacing, uSide, uSize, uBladeHeight, uDensity;
uniform vec2 uCenter;
uniform vec3 uCamera;
uniform sampler2D uHeight, uSplat, uTrash;
varying vec3 vGrassColor;
varying float vBladeT;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 wc = floor(uCenter / uSpacing) + cell;
float r1 = gh(wc), r2 = gh(wc + 17.0), r3 = gh(wc + 31.0), r4 = gh(wc + 53.0);
vec2 wxz = (wc + vec2(r1, r2)) * uSpacing;
vec2 tuv = wxz / uSize + 0.5;
float ground = texture2D(uHeight, tuv).r;
vec4 sp = texture2D(uSplat, tuv);
float trash = texture2D(uTrash, tuv).r;
float density = sp.r * uDensity;
float edge = 1.0 - smoothstep(0.7, 1.0, length(cell) / (uSide * 0.5));
float keep = step(r3, density) * edge;
float yaw = r4 * 6.2831853;
float cy = cos(yaw), sy = sin(yaw);
vec3 objectNormal = normalize(vec3(sy * 0.35, 1.0, cy * 0.35));`,
      )
      .replace(
        '#include <begin_vertex>',
        `float h = uBladeHeight * (0.6 + 0.9 * r1) * (0.7 + 0.6 * sp.r) * (1.0 - trash * 0.45) * keep;
float t = position.y;
vBladeT = t;
vec3 local = vec3(position.x * (1.0 + r2 * 0.4), t * h, 0.0);
float gust = sin(uTime * 1.4 + wxz.x * 0.35 + wxz.y * 0.2) * 0.5 + sin(uTime * 2.7 + wxz.y * 0.9) * 0.25;
float bend = ((r3 - 0.5) * 0.7 + gust * 0.35) * t * t;
local.x += bend * h * cy;
local.z += bend * h * sy * 0.6;
local.y -= abs(bend) * h * 0.25 * t;
vec3 rotated = vec3(local.x * cy - local.z * sy, local.y, local.x * sy + local.z * cy);
vec3 transformed = rotated + vec3(wxz.x, ground, wxz.y);
vec3 healthy = mix(vec3(0.16, 0.36, 0.08), vec3(0.42, 0.62, 0.16), r2 * 0.7 + t * 0.5);
vec3 dead = mix(vec3(0.42, 0.32, 0.12), vec3(0.72, 0.6, 0.3), r2 * 0.6 + t * 0.5);
vGrassColor = mix(healthy, dead, trash);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;\nvarying float vBladeT;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassColor * (0.55 + 0.45 * vBladeT);');
  };
  mat.customProgramCacheKey = () => 'grassfield-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    count,
    update(time, camera) {
      uniforms.uTime.value = time;
      uniforms.uCenter.value.set(camera.x, camera.z);
      uniforms.uCamera.value.copy(camera);
    },
    setDensity(s) {
      uniforms.uDensity.value = s;
    },
  };
}
