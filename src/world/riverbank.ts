// The M0 riverbank vignette layout (plan §20 M0): ~60 × 60 m of bank, a winding spring run,
// a dirt trail along the east bank, and the placement helpers the lab page needs. The full
// valley (§7) will be authored as data on top of the same TerrainSource/RiverSpline contracts.
import * as THREE from 'three';
import type { TerrainSample, TerrainSource } from './terrain.ts';
import type { RiverSpline } from './water.ts';
import { fbm2, smoothstep, clamp01 } from './noise.ts';

export interface RiverbankLayout extends TerrainSource {
  spline: RiverSpline;
  /** Trail centre x at z. */
  trailX(z: number): number;
  /** Signed distance from the water's edge: negative inside the channel. */
  edgeDistance(x: number, z: number): number;
  bridgeZ: number;
  seed: number;
}

export function createRiverbank(size = 64, seed = 11): RiverbankLayout {
  const centerX = (z: number): number => 9 + 2.5 * Math.sin(z * 0.07) + 1.2 * Math.sin(z * 0.19 + 1);
  const halfWidth = (z: number): number => 4.5 + 0.8 * Math.sin(z * 0.11);
  const spline: RiverSpline = { centerX, halfWidth, zMin: -size / 2 - 2, zMax: size / 2 + 2 };
  const trailX = (z: number): number => centerX(z) - halfWidth(z) - 5.5 + 0.6 * Math.sin(z * 0.23);
  const edgeDistance = (x: number, z: number): number => {
    const d = x - centerX(z);
    const w = halfWidth(z);
    return Math.abs(d) - w;
  };
  const bridgeZ = -6;

  const sample = (x: number, z: number): TerrainSample => {
    const cx = centerX(z);
    const w = halfWidth(z);
    const d = x - cx;
    const u = d / w;
    const dd = Math.abs(d) - w; // distance beyond the water's edge
    let h: number;
    if (Math.abs(u) < 1) {
      h = -1.9 * Math.pow(1 - u * u, 1.15) - 0.05;
    } else if (d < 0) {
      // east bank: gentle rise to a grassy shelf, then a slow slope up to the trailhead side
      h = -0.05 + 1.25 * smoothstep(0, 7, dd) + 0.035 * dd;
    } else {
      // west bank: steeper forested slope
      h = -0.05 + 2.6 * smoothstep(0, 9, dd) + 0.15 * dd;
    }
    const bankFade = smoothstep(0, 2.5, dd);
    const n = fbm2(x * 0.06, z * 0.06, seed, 4) * 0.5 + fbm2(x * 0.45, z * 0.45, seed + 9, 2) * 0.07;
    h += n * bankFade;
    // trail: a slight depression, compacted
    const tx = trailX(z);
    const dt = Math.abs(x - tx);
    const trail = 1 - smoothstep(0.7, 1.4, dt);
    h -= 0.07 * trail;
    // splat
    const forestNoise = fbm2(x * 0.09 + 5, z * 0.09, seed + 3, 3);
    let forest = d < 0 ? smoothstep(tx - 2.5, tx - 8, x) : smoothstep(1.0, 5.0, dd);
    forest = clamp01(forest + forestNoise * 0.35);
    const mud = Math.abs(u) < 1 ? 1 : 1 - smoothstep(0.4, 2.4, dd + Math.max(0, fbm2(x * 0.3, z * 0.3, seed + 7, 2)) * 1.2);
    let grass = clamp01(1 - forest) * (1 - mud);
    let floor = forest * (1 - mud);
    const trailW = trail * (1 - mud);
    grass *= 1 - trailW;
    floor *= 1 - trailW;
    const total = grass + floor + trailW + mud || 1;
    return { height: h, splat: [grass / total, floor / total, trailW / total, mud / total] };
  };
  return { size, sample, spline, trailX, edgeDistance, bridgeZ, seed };
}

/** Deterministic scatter positions on the bank for rocks, ferns and trees. */
export function scatterPoints(
  layout: RiverbankLayout,
  count: number,
  seedOffset: number,
  accept: (x: number, z: number, edge: number, s: TerrainSample) => boolean,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = layout.size / 2;
  let i = 0;
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    // low-discrepancy-ish: hash the attempt index
    const a = Math.sin((i + seedOffset) * 12.9898 + layout.seed) * 43758.5453;
    const b = Math.sin((i + seedOffset) * 78.233 + layout.seed * 1.7) * 12345.6789;
    i++;
    const x = (a - Math.floor(a)) * layout.size - half;
    const z = (b - Math.floor(b)) * layout.size - half;
    const s = layout.sample(x, z);
    const edge = layout.edgeDistance(x, z);
    if (!accept(x, z, edge, s)) continue;
    out.push(new THREE.Vector3(x, s.height, z));
  }
  return out;
}
