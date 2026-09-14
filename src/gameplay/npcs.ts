// NPC manager: spawning from roster data, the active list, per-tick updates, and queries the game
// and the Director need (nearest talkable NPC, anyone within the quiet radius).
import * as THREE from 'three';
import { Npc } from '../actors/npc.ts';
import type { NpcDef } from '../data/npcs.ts';
import { TUNABLES } from '../data/tunables.ts';
import { resolveOverlaps } from '../sim/separation.ts';
import type { World } from '../world/world.ts';
import { NavGraph } from './navigation.ts';
import { loadCharacterAssets } from '../character/character.ts';

export class NpcManager {
  readonly nav: NavGraph;
  readonly active = new Map<string, Npc>();
  private world: World;
  private tmp = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
    this.nav = new NavGraph(world);
  }

  /** Preload both bodies so spawns don't stall (the player's is already cached). */
  static preload(): Promise<unknown> {
    return Promise.all([loadCharacterAssets('male'), loadCharacterAssets('female')]);
  }

  get(id: string): Npc | undefined {
    return this.active.get(id);
  }

  get count(): number {
    return this.active.size;
  }

  async spawn(def: NpcDef, feet: THREE.Vector3, yaw = 0): Promise<Npc> {
    const existing = this.active.get(def.id);
    if (existing) {
      existing.place(feet, yaw);
      return existing;
    }
    if (this.active.size >= TUNABLES.npc.maxActive) {
      // drop the farthest idle one
      let far: Npc | null = null;
      let fd = -1;
      for (const n of this.active.values()) {
        const d = n.feet.distanceTo(feet);
        if (n.mode === 'idle' && d > fd) {
          fd = d;
          far = n;
        }
      }
      if (far) this.despawn(far.def.id);
    }
    const npc = await Npc.create(def, this.world, this.nav, feet, yaw);
    // a runner may have despawned everything while we were loading
    if (this.active.has(def.id)) {
      npc.dispose();
      return this.active.get(def.id)!;
    }
    this.active.set(def.id, npc);
    return npc;
  }

  /** Remove an NPC. One the combat system holds (hands up, hostile) stays until it lets go, unless forced. */
  despawn(id: string, force = false): boolean {
    const n = this.active.get(id);
    if (!n) return true;
    if (n.engaged && !force) return false;
    n.dispose();
    this.active.delete(id);
    return true;
  }

  despawnAll(): void {
    for (const id of [...this.active.keys()]) this.despawn(id, true);
  }

  step(dt: number): void {
    for (const n of this.active.values()) n.step(dt);
    this.separate();
  }

  /** People never share a spot (plan §1 #43): resolve overlaps after the tick, and let a walker whose
   *  destination somebody already occupies count as arrived instead of jostling forever. */
  private separate(): void {
    const list = [...this.active.values()];
    if (list.length < 2) return;
    const minSep = TUNABLES.npc.minSeparation;
    const moves = resolveOverlaps(list.map((n) => ({ x: n.position.x, z: n.position.z, movable: n.canBeNudged })), minSep);
    for (let i = 0; i < list.length; i++) {
      const m = moves[i]!;
      if (m.dx || m.dz) list[i]!.nudge(m.dx, m.dz);
    }
    for (const n of list) {
      const dest = n.destination;
      if (!dest || Math.hypot(dest.x - n.position.x, dest.z - n.position.z) > minSep + 0.35) continue;
      if (list.some((o) => o !== n && Math.hypot(dest.x - o.position.x, dest.z - o.position.z) < minSep * 0.9)) n.arriveNow();
    }
  }

  render(dt: number, cameraPos: THREE.Vector3): void {
    for (const n of this.active.values()) n.render(dt, cameraPos);
  }

  /** The closest NPC within interact range that isn't busy (fleeing, floating, emerging). */
  nearestTalkable(feet: THREE.Vector3, range = TUNABLES.npc.interactRange): Npc | null {
    let best: Npc | null = null;
    let bd = range * range;
    for (const n of this.active.values()) {
      if (n.mode === 'flee' || n.mode === 'float' || n.mode === 'emerge' || n.tag === 'busy') continue;
      const d = this.tmp.copy(n.feet).distanceToSquared(feet);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  anyWithin(feet: THREE.Vector3, radius: number): boolean {
    const r2 = radius * radius;
    for (const n of this.active.values()) if (n.feet.distanceToSquared(feet) < r2) return true;
    return false;
  }

  /** A point `distance` from the player toward `from`, kept on land (a wading player is met from the bank). */
  approachPoint(player: THREE.Vector3, from: THREE.Vector3, distance: number, sideOffset = 0): THREE.Vector3 {
    const dir = new THREE.Vector3(from.x - player.x, 0, from.z - player.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    // clamp to land first, then step sideways and clamp again: near the water both visitors used to
    // snap to the same bank point and fuse into one body
    const base = this.nav.landPoint(new THREE.Vector3(player.x, player.y, player.z).addScaledVector(dir, distance));
    if (!sideOffset) return base;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(sideOffset);
    return this.nav.landPoint(base.clone().add(side));
  }

  /** A trail-side spawn point roughly `distance` from the player. */
  spawnPoint(from: THREE.Vector3, distance: number, rng: () => number): THREE.Vector3 {
    const n = this.nav.nodeAtDistance(from, distance, rng);
    return new THREE.Vector3(n.x, n.y, n.z);
  }

  /** A far trail node to leave toward. */
  exitPoint(from: THREE.Vector3, rng: () => number): THREE.Vector3 {
    const n = this.nav.nodeAtDistance(from, 110, rng, 30);
    return new THREE.Vector3(n.x, n.y, n.z);
  }
}
