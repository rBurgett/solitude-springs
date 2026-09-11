// World pickups (plan §8.1): dropped items, catches that didn't fit, party cans. Simple
// spinning markers with an item glyph colour; F picks up the nearest one in range.
import * as THREE from 'three';
import type { World } from '../world/world.ts';
import type { PickupRecord } from '../sim/save/schema.ts';
import { randomId } from '../core/rng.ts';
import { makeItemMesh } from './itemMesh.ts';

interface Pickup {
  record: PickupRecord;
  mesh: THREE.Group;
  phase: number;
}

export class PickupSystem {
  private world: World;
  private items = new Map<string, Pickup>();
  private tmp = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
  }

  spawn(itemId: string, count: number, position: THREE.Vector3, color?: string): PickupRecord {
    const rec: PickupRecord = { id: randomId(), itemId, count, ...(color ? { color } : {}), position: [position.x, position.y, position.z] };
    this.add(rec);
    return rec;
  }

  private add(rec: PickupRecord): void {
    const g = new THREE.Group();
    // the item mesh lies on its side above the ground marker, spinning slowly
    const body = new THREE.Group();
    const item = makeItemMesh(rec.itemId, rec.color);
    item.rotation.z = -Math.PI / 2;
    item.position.x = -0.12;
    body.add(item);
    body.position.y = 0.18;
    g.add(body);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    const y = Math.max(rec.position[1], this.world.groundAt(rec.position[0], rec.position[2]));
    g.position.set(rec.position[0], y, rec.position[2]);
    rec.position[1] = y;
    this.world.scene.add(g);
    this.items.set(rec.id, { record: rec, mesh: g, phase: Math.random() * 6 });
  }

  /** Nearest pickup within `radius` of a point. */
  nearest(p: THREE.Vector3, radius = 2.2): PickupRecord | null {
    let best: Pickup | null = null;
    let bd = radius * radius;
    for (const it of this.items.values()) {
      const d = this.tmp.set(...it.record.position).distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best?.record ?? null;
  }

  take(id: string): PickupRecord | null {
    const it = this.items.get(id);
    if (!it) return null;
    it.mesh.removeFromParent();
    this.items.delete(id);
    return it.record;
  }

  step(dt: number): void {
    for (const it of this.items.values()) {
      it.phase += dt;
      const body = it.mesh.children[0]!;
      body.rotation.y += dt * 1.2;
      body.position.y = 0.18 + Math.sin(it.phase * 2) * 0.03;
    }
  }

  serialize(): PickupRecord[] {
    return [...this.items.values()].map((it) => ({ ...it.record, position: [...it.record.position] as [number, number, number] }));
  }

  restore(records: PickupRecord[]): void {
    this.clear();
    for (const r of records) this.add({ ...r, position: [...r.position] as [number, number, number] });
  }

  clear(): void {
    for (const it of this.items.values()) it.mesh.removeFromParent();
    this.items.clear();
  }

  get count(): number {
    return this.items.size;
  }
}
