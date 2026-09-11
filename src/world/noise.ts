// CPU-side value noise / fBm for terrain shaping, splat painting and procedural textures.
import { hash2i } from '../core/rng.ts';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0,1) with integer lattice, seeded. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const n00 = hash2i(xi, yi, seed) / 4294967296;
  const n10 = hash2i(xi + 1, yi, seed) / 4294967296;
  const n01 = hash2i(xi, yi + 1, seed) / 4294967296;
  const n11 = hash2i(xi + 1, yi + 1, seed) / 4294967296;
  const a = n00 + (n10 - n00) * tx;
  const b = n01 + (n11 - n01) * tx;
  return a + (b - a) * ty;
}

/** Fractal Brownian motion in roughly [-1, 1]. */
export function fbm2(x: number, y: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise2(x * freq, y * freq, seed + i * 101) * 2 - 1) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
