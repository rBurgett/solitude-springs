// Heightfield terrain: a height function sampled into a grid mesh, plus a CPU-painted splat map
// (grass / forest floor / trail dirt / mud-sand) and a trash mask (brown grass) — plan §17.
import * as THREE from 'three';
import { clamp01, smoothstep } from './noise.ts';

export interface TerrainSample {
  /** Height in metres (water level is y = 0). */
  height: number;
  /** Splat weights, sum to 1: [grass, forestFloor, trailDirt, mudSand]. */
  splat: [number, number, number, number];
}

export interface TerrainSource {
  /** Extent in metres, centred on the origin. */
  size: number;
  sample(x: number, z: number): TerrainSample;
}

export interface TerrainBuild {
  geometry: THREE.BufferGeometry;
  splatMap: THREE.DataTexture;
  trashMask: THREE.DataTexture;
  /** Interpolated height lookup on the built grid. */
  heightAt(x: number, z: number): number;
  /** Interpolated normal lookup. */
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  /** Paint (or clear) a circular trashed area into the trash mask. */
  paintTrash(cx: number, cz: number, radius: number, amount: number): void;
  size: number;
  resolution: number;
}

/**
 * Build the terrain grid at `step` metres per vertex and the splat/trash textures at `texels` per side.
 */
export function buildTerrain(src: TerrainSource, step = 0.5, texels = 256): TerrainBuild {
  const size = src.size;
  const n = Math.round(size / step) + 1;
  const half = size / 2;
  const heights = new Float32Array(n * n);
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = src.sample(x, z).height;
      const k = j * n + i;
      heights[k] = h;
      positions[k * 3] = x;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = i / (n - 1);
      uvs[k * 2 + 1] = j / (n - 1);
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // alternate the diagonal so slopes don't show a directional bias
      if ((i + j) % 2 === 0) {
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      } else {
        index[p++] = a; index[p++] = c; index[p++] = d;
        index[p++] = a; index[p++] = d; index[p++] = b;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // Splat map: RGBA8 = grass, forest floor, trail, mud/sand.
  const splatData = new Uint8Array(texels * texels * 4);
  const trashData = new Uint8Array(texels * texels);
  for (let j = 0; j < texels; j++) {
    for (let i = 0; i < texels; i++) {
      const x = -half + ((i + 0.5) / texels) * size;
      const z = -half + ((j + 0.5) / texels) * size;
      const s = src.sample(x, z).splat;
      const k = (j * texels + i) * 4;
      splatData[k] = Math.round(clamp01(s[0]) * 255);
      splatData[k + 1] = Math.round(clamp01(s[1]) * 255);
      splatData[k + 2] = Math.round(clamp01(s[2]) * 255);
      splatData[k + 3] = Math.round(clamp01(s[3]) * 255);
    }
  }
  const splatMap = new THREE.DataTexture(splatData, texels, texels, THREE.RGBAFormat);
  splatMap.magFilter = THREE.LinearFilter;
  splatMap.minFilter = THREE.LinearFilter;
  splatMap.needsUpdate = true;
  const trashMask = new THREE.DataTexture(trashData, texels, texels, THREE.RedFormat);
  trashMask.magFilter = THREE.LinearFilter;
  trashMask.minFilter = THREE.LinearFilter;
  trashMask.needsUpdate = true;

  const heightAt = (x: number, z: number): number => {
    const fx = clamp01((x + half) / size) * (n - 1);
    const fz = clamp01((z + half) / size) * (n - 1);
    const i = Math.min(n - 2, Math.floor(fx));
    const j = Math.min(n - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const h00 = heights[j * n + i] as number;
    const h10 = heights[j * n + i + 1] as number;
    const h01 = heights[(j + 1) * n + i] as number;
    const h11 = heights[(j + 1) * n + i + 1] as number;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
  const normalAt = (x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => {
    const e = step * 0.5;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  };
  const paintTrash = (cx: number, cz: number, radius: number, amount: number): void => {
    const data = trashMask.image.data as Uint8Array;
    for (let j = 0; j < texels; j++) {
      const z = -half + ((j + 0.5) / texels) * size;
      for (let i = 0; i < texels; i++) {
        const x = -half + ((i + 0.5) / texels) * size;
        const d = Math.hypot(x - cx, z - cz);
        if (d > radius) continue;
        const w = 1 - smoothstep(radius * 0.55, radius, d);
        const k = j * texels + i;
        const v = clamp01((data[k] as number) / 255 + w * amount);
        data[k] = Math.round(v * 255);
      }
    }
    trashMask.needsUpdate = true;
  };
  return { geometry, splatMap, trashMask, heightAt, normalAt, paintTrash, size, resolution: n };
}
