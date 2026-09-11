// Deterministic pseudo-random helpers. Procedural placement, NPC picks and fishing rolls all
// draw from these so a save reproduces the same world; the RNG state is serialized (§14.2).

/** 32-bit integer hash (murmur-style avalanche). */
export function hashInt(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash 2D integer coordinates and a seed into a uint32. */
export function hash2i(x: number, y: number, seed: number): number {
  let h = hashInt(Math.imul(x | 0, 0x9e3779b1) + (seed | 0));
  h = hashInt(h ^ Math.imul(y | 0, 0x85ebca77));
  return h >>> 0;
}

/** Hash 3 integers into a uint32. */
export function hash3i(x: number, y: number, z: number, seed: number): number {
  return hashInt(hash2i(x, y, seed) ^ Math.imul(z | 0, 0x27d4eb2f));
}

/** Deterministic float in [0,1) for 2D integer coords. */
export function rand2(x: number, y: number, seed: number): number {
  return hash2i(x, y, seed) / 4294967296;
}

/** Hash a string to a uint32 (FNV-1a), for seeding from ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG with a serializable state. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Current state (a uint32); restore with `setState`. */
  getState(): number {
    return this.s;
  }
  setState(state: number): void {
    this.s = state >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  /** Weighted pick; weights ≤ 0 are never chosen. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) throw new Error('weighted pick with no positive weights');
    let r = this.next() * total;
    for (const it of items) {
      const w = Math.max(0, weight(it));
      if (r < w) return it;
      r -= w;
    }
    return items[items.length - 1] as T;
  }
  /** Triangular distribution on [min, max] with the given mode. */
  triangular(min: number, max: number, mode: number): number {
    const u = this.next();
    const c = (mode - min) / (max - min);
    return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }
  /** Gaussian-ish via sum of uniforms. */
  gauss(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + u * sd * 0.866;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = t;
    }
    return arr;
  }
}

/** Non-deterministic seed for new games. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return (a[0] as number) >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

/** Random id for save slots. */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + randomSeed().toString(36);
}
