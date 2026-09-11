// The full valley (plan §7.1) as a TerrainSource: spring pool at the head, a winding river with
// banks and trails, a campground shelf, a sandy bend, the marsh, forested slopes, the trailhead
// plateau and boundary ridges. Also the queries gameplay needs: water depth, zones, areas,
// trails, bounds. Deterministic from a seed so saves reproduce the same world.
import type { TerrainSample, TerrainSource } from './terrain.ts';
import type { RiverSpline } from './water.ts';
import { fbm2, smoothstep, clamp01, lerp } from './noise.ts';
import { AREA_TEMPLATES, BOUNDARY, BRIDGES, CAMPGROUND_TEMPLATE, DOCK, PARKING, SANDY_BEND_TEMPLATE, SPAWN, WORLD_SIZE, ZONES, type AreaDef, type ZoneDefData } from '../data/world.ts';

export interface Valley extends TerrainSource {
  seed: number;
  spline: RiverSpline;
  riverCenterX(z: number): number;
  riverHalfWidth(z: number): number;
  /** Signed distance from the water's edge: negative inside the channel. */
  edgeDistance(x: number, z: number): number;
  /** Water depth (0 when not in water). */
  waterDepthAt(x: number, z: number): number;
  /** Ground height without the tiny trail depression etc. — same as sample().height. */
  heightAt(x: number, z: number): number;
  zoneAt(x: number, z: number): ZoneDefData | null;
  zoneForZ(z: number): ZoneDefData | null;
  areaAt(x: number, z: number): AreaDef | null;
  /** Distance to the nearest trail centreline. */
  trailDistance(x: number, z: number): number;
  /** East bank trail x at z (undefined outside its range). */
  eastTrailX(z: number): number;
  westTrailX(z: number): number;
  /** Inward push (metres/second scale) when outside the playable bounds, else null. */
  boundaryPush(x: number, z: number): { x: number; z: number } | null;
  /** Deck geometry of each bridge: endpoints on both banks (y = deck top). */
  bridgeEnds(id: string): { west: [number, number, number]; east: [number, number, number] } | null;
  dock: { root: [number, number, number]; end: [number, number, number] };
  /** Forest density 0..1 (drives tree placement). */
  forestAt(x: number, z: number): number;
  /** Clearing/flat factor 0..1 for prop placement (campground, parking). */
  isFlatArea(x: number, z: number): 'campground' | 'parking' | 'beach' | null;
  /** Areas with x resolved against the river. */
  areas: AreaDef[];
  /** Switchback trail control points from the trailhead down to the east bank trail. */
  switchback: [number, number][];
  campground: { x: number; z: number; radius: number };
  sandyBend: { x: number; z: number; radius: number };
}

function gauss(t: number): number {
  return Math.exp(-t * t);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / l2);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function createValley(seed = 2026): Valley {
  const riverCenterX = (z: number): number => 18 * Math.sin(z * 0.011 + 0.5) + 9 * Math.sin(z * 0.027 + 2.0) + 4 * Math.sin(z * 0.061);
  const riverHalfWidth = (z: number): number => {
    let hw = 7 + 2 * Math.sin(z * 0.05);
    hw += 24 * gauss((z + 170) / 28); // the spring pool
    hw += 26 * smoothstep(165, 215, z) + 5 * Math.sin(z * 0.08); // the marsh opens out
    hw *= smoothstep(-228, -200, z); // the river starts at the spring
    hw *= 1 - smoothstep(300, 330, z);
    return Math.max(0.01, hw);
  };
  const channelDepth = (z: number): number => 2.4 + 3.4 * gauss((z + 170) / 24) - 1.3 * smoothstep(160, 220, z);
  const spline: RiverSpline = { centerX: riverCenterX, halfWidth: riverHalfWidth, zMin: -232, zMax: 330 };
  const edgeDistance = (x: number, z: number): number => Math.abs(x - riverCenterX(z)) - riverHalfWidth(z);
  const eastTrailX = (z: number): number => riverCenterX(z) + riverHalfWidth(z) + 4.5 + 0.7 * Math.sin(z * 0.21);
  const westTrailX = (z: number): number => riverCenterX(z) - riverHalfWidth(z) - 4.5 + 0.7 * Math.sin(z * 0.17 + 2);

  // layout resolved against the spline
  const CAMPGROUND = { x: riverCenterX(CAMPGROUND_TEMPLATE.z) + riverHalfWidth(CAMPGROUND_TEMPLATE.z) + CAMPGROUND_TEMPLATE.offset + CAMPGROUND_TEMPLATE.radius * 0.6, z: CAMPGROUND_TEMPLATE.z, radius: CAMPGROUND_TEMPLATE.radius };
  const SANDY_BEND = { x: riverCenterX(SANDY_BEND_TEMPLATE.z) - riverHalfWidth(SANDY_BEND_TEMPLATE.z) - SANDY_BEND_TEMPLATE.offset - SANDY_BEND_TEMPLATE.radius * 0.4, z: SANDY_BEND_TEMPLATE.z, radius: SANDY_BEND_TEMPLATE.radius };
  const areas: AreaDef[] = AREA_TEMPLATES.map((t) => {
    let x = t.x ?? 0;
    if (t.side === 'center') x = riverCenterX(t.z);
    else if (t.side === 'east') x = riverCenterX(t.z) + riverHalfWidth(t.z) + t.offset;
    else if (t.side === 'west') x = riverCenterX(t.z) - riverHalfWidth(t.z) - t.offset;
    return { id: t.id, name: t.name, x, z: t.z, radius: t.radius };
  });
  // the switchback: zigzag legs down the east side of the ridge, joining the east bank trail
  const SWITCHBACK: [number, number][] = [
    [SPAWN.x, SPAWN.z + 2],
    [SPAWN.x + 34, SPAWN.z + 10],
    [SPAWN.x + 8, SPAWN.z + 20],
    [SPAWN.x + 36, SPAWN.z + 30],
    [SPAWN.x + 10, SPAWN.z + 40],
    [eastTrailX(-190) + 4, -190],
    [eastTrailX(-176), -176],
    [eastTrailX(-162), -162],
    [eastTrailX(-150), -150],
  ];

  const trailDistance = (x: number, z: number): number => {
    let d = Infinity;
    if (z >= -152 && z <= 266) d = Math.min(d, Math.abs(x - eastTrailX(z)));
    if (z >= -114 && z <= 124) d = Math.min(d, Math.abs(x - westTrailX(z)));
    for (let i = 0; i < SWITCHBACK.length - 1; i++) {
      const a = SWITCHBACK[i]!;
      const b = SWITCHBACK[i + 1]!;
      d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]));
    }
    // the parking lot joins the first switchback point
    const first = SWITCHBACK[0]!;
    d = Math.min(d, segDist(x, z, PARKING.x, PARKING.z + PARKING.halfD, first[0], first[1]));
    // bridge approaches: from the east trail across to the west trail
    for (const b of BRIDGES) d = Math.min(d, segDist(x, z, westTrailX(b.z), b.z, eastTrailX(b.z), b.z));
    // campground spur and the dock spur
    d = Math.min(d, segDist(x, z, eastTrailX(CAMPGROUND.z), CAMPGROUND.z, CAMPGROUND.x + 4, CAMPGROUND.z));
    d = Math.min(d, segDist(x, z, eastTrailX(DOCK.z), DOCK.z, riverCenterX(DOCK.z) + riverHalfWidth(DOCK.z) + 1, DOCK.z));
    return d;
  };

  const boxDist = (x: number, z: number, cx: number, cz: number, hw: number, hd: number): number => Math.max(Math.abs(x - cx) - hw, Math.abs(z - cz) - hd);

  const isFlatArea = (x: number, z: number): 'campground' | 'parking' | 'beach' | null => {
    if (boxDist(x, z, PARKING.x, PARKING.z, PARKING.halfW, PARKING.halfD) < 0) return 'parking';
    if (Math.hypot(x - CAMPGROUND.x, z - CAMPGROUND.z) < CAMPGROUND.radius) return 'campground';
    if (Math.hypot(x - SANDY_BEND.x, z - SANDY_BEND.z) < SANDY_BEND.radius && edgeDistance(x, z) > 0) return 'beach';
    return null;
  };

  const forestAt = (x: number, z: number): number => {
    const cx = riverCenterX(z);
    const dd = Math.abs(x - cx) - riverHalfWidth(z);
    const west = x < cx;
    let f = west ? smoothstep(10, 34, dd) : smoothstep(24, 60, dd);
    // deep woods: the west slopes are dense
    if (west) f = Math.max(f, smoothstep(30, 80, dd) * 1.0);
    f = clamp01(f + fbm2(x * 0.02 + 3, z * 0.02, seed + 3, 3) * 0.35);
    // clearings
    if (isFlatArea(x, z)) f *= 0.05;
    f *= 1 - smoothstep(-60, -40, -Math.abs(z + 60)) * (x > cx ? smoothstep(50, 30, Math.hypot(x - CAMPGROUND.x, z - CAMPGROUND.z)) : 0);
    // marsh: cypress stand rather than forest
    if (z > 160) f *= 0.55;
    // the north ridge behind the pool and the boundary ridges are wooded
    f = Math.max(f, smoothstep(-186, -230, z) * 0.75 * (1 - smoothstep(0, 12, -edgeDistance(x, z))));
    // the trailhead plateau keeps some pines but thins near the lot
    f *= 1 - 0.7 * (1 - smoothstep(0, 18, boxDist(x, z, PARKING.x, PARKING.z, PARKING.halfW, PARKING.halfD)));
    return f;
  };

  const bridgeMound = (x: number, z: number): number => {
    let m = 0;
    for (const b of BRIDGES) {
      for (const ex of [westTrailX(b.z) + 2.5, eastTrailX(b.z) - 2.5]) {
        const d = Math.hypot(x - ex, z - b.z);
        m = Math.max(m, (b.clearance - 0.05) * (1 - smoothstep(2.5, 7, d)));
      }
    }
    return m;
  };

  const sample = (x: number, z: number): TerrainSample => {
    const cx = riverCenterX(z);
    const hw = riverHalfWidth(z);
    const d = x - cx;
    const u = d / hw;
    const dd = Math.abs(d) - hw;
    const west = d < 0;
    let h: number;
    const inWater = Math.abs(u) < 1 && z > -232 && z < 330;
    if (inWater) {
      h = -channelDepth(z) * Math.pow(1 - u * u, 1.15) - 0.05;
    } else {
      // bank shelf then the valley sides; the west side is the steeper, forested one
      const shelf = -0.05 + 1.1 * smoothstep(0, 5, dd);
      const rise = west ? 44 * Math.pow(smoothstep(12, 250, dd), 1.35) : 38 * Math.pow(smoothstep(20, 250, dd), 1.5);
      h = shelf + rise;
    }
    const bankFade = smoothstep(0, 3, dd);
    // hills and micro-relief
    h += fbm2(x * 0.012, z * 0.012, seed, 4) * 5 * smoothstep(6, 40, dd) + fbm2(x * 0.08, z * 0.08, seed + 9, 3) * 0.45 * bankFade;
    // the valley closes to the north: the ridge the trailhead sits on
    const north = smoothstep(-186, -262, z);
    h += 40 * Math.pow(north, 1.25) * (1 - (inWater ? 1 : 0) * 0.0);
    // the south boundary ridge
    h += 30 * Math.pow(smoothstep(262, 300, z), 1.3);
    // marsh flats
    if (!inWater) h = lerp(h, Math.min(h, 0.45 + 0.1 * fbm2(x * 0.1, z * 0.1, seed + 4, 2)), smoothstep(150, 200, z) * (1 - smoothstep(8, 40, dd)) * (1 - smoothstep(255, 275, z)));
    // flat areas
    const parkD = boxDist(x, z, PARKING.x, PARKING.z, PARKING.halfW, PARKING.halfD);
    if (parkD < 14) h = lerp(41.5, h, smoothstep(0, 14, parkD));
    const campD = Math.hypot(x - CAMPGROUND.x, z - CAMPGROUND.z) - CAMPGROUND.radius;
    if (campD < 10) h = lerp(1.35 + 0.15 * fbm2(x * 0.15, z * 0.15, seed + 5, 2), h, smoothstep(-2, 10, campD));
    const beachD = Math.hypot(x - SANDY_BEND.x, z - SANDY_BEND.z) - SANDY_BEND.radius;
    if (!inWater && beachD < 6) h = lerp(0.3 + 0.35 * smoothstep(0, 10, dd), h, smoothstep(-4, 6, beachD));
    // bridge approaches rise to the deck
    if (!inWater) {
      const mound = bridgeMound(x, z);
      if (mound > 0) h = Math.max(h, mound);
    }
    // boundary walls
    const bx = Math.max(BOUNDARY.xMin - x, x - BOUNDARY.xMax, 0);
    const bz = Math.max(BOUNDARY.zMin - z, z - BOUNDARY.zMax, 0);
    const bw = Math.max(bx, bz);
    if (bw > 0) h += 25 * smoothstep(0, 18, bw) + 0.6 * bw;
    // trails: compacted, a little sunken
    const td = trailDistance(x, z);
    const trail = 1 - smoothstep(0.9, 1.6, td);
    h -= 0.06 * trail * bankFade;

    // splat weights: [grass, forestFloor, trail, mudSand]
    const flat = isFlatArea(x, z);
    const ridge = Math.max(north, smoothstep(250, 290, z), smoothstep(0, 18, bw));
    const forest = Math.max(forestAt(x, z), ridge * 0.85) * (1 - trail);
    let mud = inWater ? 1 : 1 - smoothstep(0.3, 2.2, dd + Math.max(0, fbm2(x * 0.3, z * 0.3, seed + 7, 2)) * 1.0);
    if (flat === 'beach') mud = Math.max(mud, 1 - smoothstep(-3, 3, beachD));
    if (z > 160 && !inWater) mud = Math.max(mud, 0.5 * (1 - smoothstep(4, 20, dd)));
    let trailW = trail * (1 - mud);
    if (flat === 'parking') trailW = Math.max(trailW, 1 - smoothstep(-1, 1.5, parkD));
    const floorW = forest * (1 - mud) * (1 - trailW);
    let grass = (1 - forest) * (1 - mud) * (1 - trailW);
    // bare rock high on the ridges reads as forest floor
    const total = grass + floorW + trailW + mud || 1;
    grass /= total;
    return { height: h, splat: [grass, floorW / total, trailW / total, mud / total] };
  };

  const heightAt = (x: number, z: number): number => sample(x, z).height;
  const waterDepthAt = (x: number, z: number): number => {
    if (edgeDistance(x, z) >= 0) return 0;
    return Math.max(0, -heightAt(x, z));
  };
  const zoneForZ = (z: number): ZoneDefData | null => ZONES.find((zn) => z >= zn.zMin && z < zn.zMax) ?? null;
  const zoneAt = (x: number, z: number): ZoneDefData | null => (edgeDistance(x, z) < 3 ? zoneForZ(z) : null);
  const areaAt = (x: number, z: number): AreaDef | null => {
    let best: AreaDef | null = null;
    let bestD = Infinity;
    for (const a of areas) {
      const d = Math.hypot(x - a.x, z - a.z) / a.radius;
      if (d < 1 && d < bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
  };
  const boundaryPush = (x: number, z: number): { x: number; z: number } | null => {
    const margin = 6;
    let px = 0;
    let pz = 0;
    if (x < BOUNDARY.xMin + margin) px = 1;
    if (x > BOUNDARY.xMax - margin) px = -1;
    if (z < BOUNDARY.zMin + margin) pz = 1;
    if (z > BOUNDARY.zMax - margin) pz = -1;
    if (!px && !pz) return null;
    const l = Math.hypot(px, pz);
    return { x: px / l, z: pz / l };
  };
  const bridgeEnds = (id: string): { west: [number, number, number]; east: [number, number, number] } | null => {
    const b = BRIDGES.find((x) => x.id === id);
    if (!b) return null;
    const wx = westTrailX(b.z) + 2.5;
    const ex = eastTrailX(b.z) - 2.5;
    return { west: [wx, b.clearance, b.z], east: [ex, b.clearance, b.z] };
  };
  const dockRootX = riverCenterX(DOCK.z) + riverHalfWidth(DOCK.z) + 1.2;
  const dock = { root: [dockRootX, 0.55, DOCK.z] as [number, number, number], end: [dockRootX - DOCK.length, 0.55, DOCK.z] as [number, number, number] };

  return {
    size: WORLD_SIZE,
    seed,
    sample,
    spline,
    riverCenterX,
    riverHalfWidth,
    edgeDistance,
    waterDepthAt,
    heightAt,
    zoneAt,
    zoneForZ,
    areaAt,
    trailDistance,
    eastTrailX,
    westTrailX,
    boundaryPush,
    bridgeEnds,
    dock,
    forestAt,
    isFlatArea,
    areas,
    switchback: SWITCHBACK,
    campground: CAMPGROUND,
    sandyBend: SANDY_BEND,
  };
}
