// Character separation (plan §1 #43): people never share a spot. Pure pairwise resolution of
// horizontal overlaps; the NPC manager applies the displacements each tick. Two visitors used to
// fuse into one body — a shared approach point on the bank, then the same path at the same speed.

export interface Body {
  x: number;
  z: number;
  /** false for someone who must not be shoved (rising from the water, mid-gesture). */
  movable: boolean;
}

/** Displacements that end every overlap closer than `minSeparation` (one relaxation pass). */
export function resolveOverlaps(bodies: readonly Body[], minSeparation: number): { dx: number; dz: number }[] {
  const out = bodies.map(() => ({ dx: 0, dz: 0 }));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      if (!a.movable && !b.movable) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= minSeparation) continue;
      if (d < 1e-4) {
        // exactly on top of each other: split sideways, deterministically
        dx = 1;
        dz = 0;
        d = 1;
      }
      const push = (minSeparation - Math.hypot(b.x - a.x, b.z - a.z)) / d;
      const share = a.movable && b.movable ? 0.5 : 1;
      if (a.movable) {
        out[i]!.dx -= dx * push * share;
        out[i]!.dz -= dz * push * share;
      }
      if (b.movable) {
        out[j]!.dx += dx * push * share;
        out[j]!.dz += dz * push * share;
      }
    }
  }
  return out;
}
