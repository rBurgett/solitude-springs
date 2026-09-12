// Trail-graph navigation + local steering (plan §3.2 "NPC navigation", §11.4). NPCs mostly travel
// the trails: a small graph of nodes along the east and west bank trails, the switchback, the
// bridges and the campground/dock/parking spurs. Off-trail approaches steer around tree trunks
// and never enter the water unless told to.
import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { BRIDGES, DOCK, PARKING } from '../data/world.ts';

export interface NavNode {
  id: number;
  x: number;
  z: number;
  y: number;
  /** Adjacent node ids. */
  edges: number[];
  kind: 'east' | 'west' | 'switchback' | 'bridge' | 'spur';
}

export class NavGraph {
  readonly nodes: NavNode[] = [];
  private world: World;
  private trunkGrid = new Map<string, { x: number; z: number; r: number }[]>();
  private tmp = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
    const v = world.valley;
    const add = (x: number, z: number, kind: NavNode['kind']): NavNode => {
      const n: NavNode = { id: this.nodes.length, x, z, y: world.groundAt(x, z), edges: [], kind };
      this.nodes.push(n);
      return n;
    };
    const link = (a: NavNode, b: NavNode): void => {
      if (!a.edges.includes(b.id)) a.edges.push(b.id);
      if (!b.edges.includes(a.id)) b.edges.push(a.id);
    };
    // east bank trail
    const east: NavNode[] = [];
    for (let z = -152; z <= 266; z += 8) east.push(add(v.eastTrailX(z), z, 'east'));
    for (let i = 1; i < east.length; i++) link(east[i - 1]!, east[i]!);
    // west bank trail
    const west: NavNode[] = [];
    for (let z = -114; z <= 124; z += 8) west.push(add(v.westTrailX(z), z, 'west'));
    for (let i = 1; i < west.length; i++) link(west[i - 1]!, west[i]!);
    // the switchback down from the trailhead, joining the east trail
    let prev: NavNode | null = null;
    for (const [x, z] of v.switchback) {
      const n = add(x, z, 'switchback');
      if (prev) link(prev, n);
      prev = n;
    }
    if (prev) link(prev, this.nearestOf(east, prev.x, prev.z));
    // the parking lot spur
    const lot = add(PARKING.x, PARKING.z + PARKING.halfD - 2, 'spur');
    link(lot, this.nodes.find((n) => n.kind === 'switchback')!);
    // bridges: two deck nodes linking the west and east trails
    for (const b of BRIDGES) {
      const ends = v.bridgeEnds(b.id)!;
      const w = add(ends.west[0], ends.west[2], 'bridge');
      const e = add(ends.east[0], ends.east[2], 'bridge');
      w.y = ends.west[1];
      e.y = ends.east[1];
      link(w, e);
      link(w, this.nearestOf(west, w.x, w.z));
      link(e, this.nearestOf(east, e.x, e.z));
    }
    // campground and dock spurs
    const camp = add(v.campground.x, v.campground.z, 'spur');
    link(camp, this.nearestOf(east, v.eastTrailX(v.campground.z), v.campground.z));
    const dockRoot = add(v.dock.root[0] + 1.5, DOCK.z, 'spur');
    link(dockRoot, this.nearestOf(east, v.eastTrailX(DOCK.z), DOCK.z));
    // beach spur off the west trail
    const beach = add(v.sandyBend.x, v.sandyBend.z, 'spur');
    link(beach, this.nearestOf(west, v.westTrailX(v.sandyBend.z), v.sandyBend.z));
    // tree trunks in a coarse grid for steering
    for (const t of world.vegetation.trunks) {
      const key = this.cellKey(t.x, t.z);
      let list = this.trunkGrid.get(key);
      if (!list) {
        list = [];
        this.trunkGrid.set(key, list);
      }
      list.push({ x: t.x, z: t.z, r: t.radius + 0.45 });
    }
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
  }

  private nearestOf(list: NavNode[], x: number, z: number): NavNode {
    let best = list[0]!;
    let bd = Infinity;
    for (const n of list) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  nearest(x: number, z: number, kinds?: readonly NavNode['kind'][]): NavNode {
    return this.nearestOf(kinds ? this.nodes.filter((n) => kinds.includes(n.kind)) : this.nodes, x, z);
  }

  /** A* over the graph. Returns node ids from `from` to `to` inclusive. */
  path(from: number, to: number): NavNode[] {
    if (from === to) return [this.nodes[from]!];
    const h = (a: NavNode): number => Math.hypot(a.x - this.nodes[to]!.x, a.z - this.nodes[to]!.z);
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open = new Set<number>([from]);
    const f = new Map<number, number>([[from, h(this.nodes[from]!)]]);
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const id of open) {
        const v = f.get(id) ?? Infinity;
        if (v < best) {
          best = v;
          cur = id;
        }
      }
      if (cur === to) break;
      open.delete(cur);
      const cn = this.nodes[cur]!;
      for (const nb of cn.edges) {
        const nn = this.nodes[nb]!;
        const tentative = (g.get(cur) ?? Infinity) + Math.hypot(nn.x - cn.x, nn.z - cn.z);
        if (tentative < (g.get(nb) ?? Infinity)) {
          came.set(nb, cur);
          g.set(nb, tentative);
          f.set(nb, tentative + h(nn));
          open.add(nb);
        }
      }
    }
    if (!came.has(to)) return [this.nodes[from]!];
    const out: NavNode[] = [];
    let c = to;
    while (c !== from) {
      out.push(this.nodes[c]!);
      c = came.get(c)!;
    }
    out.push(this.nodes[from]!);
    return out.reverse();
  }

  /** Waypoints (world positions) from a point to another, along the trails. */
  /** The nearest trail node on the same bank as (x, z), so the straight legs at either end of a route never
   *  cross the water (bridge nodes are over the river and don't count). Falls back to the nearest of all. */
  nearestOnBank(x: number, z: number): NavNode {
    const bank = this.side(x, z);
    const same = this.nodes.filter((n) => n.kind !== 'bridge' && this.side(n.x, n.z) === bank);
    return same.length ? this.nearestOf(same, x, z) : this.nearest(x, z);
  }

  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const a = this.nearestOnBank(from.x, from.z);
    const b = this.nearestOnBank(to.x, to.z);
    const nodes = this.path(a.id, b.id);
    // skip the first node when it is behind us relative to the second
    const pts = nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    if (pts.length >= 2 && from.distanceTo(pts[1]!) < pts[0]!.distanceTo(pts[1]!)) pts.shift();
    return pts;
  }

  /** Which bank a point is on (+1 east, −1 west). */
  side(x: number, z: number): number {
    return Math.sign(x - this.world.valley.riverCenterX(z)) || 1;
  }

  /**
   * A trail node roughly `distance` metres from a point (a spawn or an exit), biased by `rng`.
   * Prefers the same bank as `from` so the route doesn't detour over a bridge.
   */
  nodeAtDistance(from: THREE.Vector3, distance: number, rng: () => number, tolerance = 12): NavNode {
    const bank = this.side(from.x, from.z);
    // prefer this bank even at a looser distance: a spawn across a wide stretch of water is a long way round
    for (const tol of [tolerance, tolerance * 2, tolerance * 4]) {
      const sameBank = this.nodes.filter((n) => n.kind !== 'bridge' && this.side(n.x, n.z) === bank && Math.abs(Math.hypot(n.x - from.x, n.z - from.z) - distance) < tol);
      if (sameBank.length) return sameBank[Math.floor(rng() * sameBank.length)]!;
    }
    const near = this.nodes.filter((n) => Math.abs(Math.hypot(n.x - from.x, n.z - from.z) - distance) < tolerance && n.kind !== 'bridge');
    if (near.length) return near[Math.floor(rng() * near.length)]!;
    // fall back to the closest match
    let best = this.nodes[0]!;
    let bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.abs(Math.hypot(n.x - from.x, n.z - from.z) - distance);
      if (d < bd && n.kind !== 'bridge') {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** The nearest point on land (≥ `margin` from the water's edge) to `p`, straight out from the river centre. */
  landPoint(p: THREE.Vector3, margin = 1.8): THREE.Vector3 {
    const v = this.world.valley;
    if (v.edgeDistance(p.x, p.z) >= margin) return p.clone();
    const cx = v.riverCenterX(p.z);
    const side = Math.sign(p.x - cx) || 1;
    const x = cx + side * (v.riverHalfWidth(p.z) + margin);
    return new THREE.Vector3(x, this.world.groundAt(x, p.z), p.z);
  }

  /** Trunk circles near a point. */
  trunksNear(x: number, z: number): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    const cx = Math.floor(x / 10);
    const cz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.trunkGrid.get(`${cx + i},${cz + j}`);
      if (list) out.push(...list);
    }
    return out;
  }

  /**
   * One steering step toward `target` at `speed`: avoids trunks and (unless `water`) the river.
   * Returns the new feet position (y from the physics ground).
   */
  steer(pos: THREE.Vector3, target: THREE.Vector3, speed: number, dt: number, water = false, exclude?: import('@dimforge/rapier3d-compat').Collider): THREE.Vector3 {
    const dir = this.tmp.set(target.x - pos.x, 0, target.z - pos.z);
    const dist = dir.length();
    if (dist < 1e-4) return pos.clone();
    dir.divideScalar(dist);
    // trunk avoidance: push sideways away from any trunk within the look-ahead
    let ax = 0;
    let az = 0;
    for (const t of this.trunksNear(pos.x, pos.z)) {
      const dx = t.x - pos.x;
      const dz = t.z - pos.z;
      const d = Math.hypot(dx, dz);
      const ahead = dx * dir.x + dz * dir.z;
      if (d < t.r + 1.6 && ahead > -0.2) {
        const side = dx * -dir.z + dz * dir.x; // positive = trunk to the right
        const push = (t.r + 1.6 - d) / (t.r + 1.6);
        ax += (side > 0 ? dir.z : -dir.z) * push * 2.2;
        az += (side > 0 ? -dir.x : dir.x) * push * 2.2;
      }
    }
    let vx = dir.x + ax;
    let vz = dir.z + az;
    const l = Math.hypot(vx, vz) || 1;
    vx /= l;
    vz /= l;
    const stepLen = Math.min(dist, speed * dt);
    let nx = pos.x + vx * stepLen;
    let nz = pos.z + vz * stepLen;
    if (!water) {
      const v = this.world.valley;
      const inWaterNow = v.edgeDistance(pos.x, pos.z) < 0.8;
      // don't step from land into the water: slide along the bank (the river runs north–south);
      // an NPC already in the water keeps walking (toward a land target) so it climbs out
      if (!inWaterNow && v.edgeDistance(nx, nz) < 0.8 && this.world.groundAt(nx, nz, pos.y + 2.5, exclude) < 0.3) {
        const cx = v.riverCenterX(pos.z);
        nx = pos.x + Math.sign(pos.x - cx) * 0.3 * stepLen;
        nz = pos.z + Math.sign(vz || 1) * stepLen;
        if (v.edgeDistance(nx, nz) < 0.8) {
          nx = pos.x;
          nz = pos.z;
        }
      }
    }
    return new THREE.Vector3(nx, this.world.groundAt(nx, nz, pos.y + 2.5, exclude), nz);
  }
}
