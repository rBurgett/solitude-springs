// The bear (plan §11.4 "Bear", §1 #9): a 5 s warning, then it emerges from the nearest forest
// edge, walks to the player, sniffs, and takes every fish — the fish fly into its mouth — or huffs
// and leaves. It never damages the player; a weapon (M3) scares it off before the swipe.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import { Bear } from '../../actors/bear.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { removeAllFish, hasItem } from '../../sim/inventory.ts';
import { bearStab } from '../../audio/party.ts';

const E = TUNABLES.events;

export class BearRunner extends EventRunner {
  readonly type = 'bear' as const;
  private bear: Bear | null = null;
  private timer = 0;
  private flying: { mesh: THREE.Mesh; from: THREE.Vector3; t: number }[] = [];
  private scared = false;
  private exit = new THREE.Vector3();

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    this.phase = 'warning';
    this.timer = 0;
    h.audio?.brushCrash();
    h.audio?.scatter();
    h.caption('*something big is coming*');
    this.bear = await Bear.create(h.world);
  }

  private forestEdge(): THREE.Vector3 {
    const h = this.h;
    const p = h.player.feet;
    const v = h.world.valley;
    let best = new THREE.Vector3(p.x - 28, 0, p.z);
    let bf = -1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 28;
      const z = p.z + Math.sin(a) * 28;
      if (v.edgeDistance(x, z) < 3) continue;
      const f = v.forestAt(x, z);
      if (f > bf) {
        bf = f;
        best = new THREE.Vector3(x, 0, z);
      }
    }
    best.y = h.world.groundAt(best.x, best.z);
    return best;
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    this.timer += dt;
    if (this.phase === 'warning') {
      if (this.timer >= E.bearWarningSeconds && this.bear) {
        const edge = this.forestEdge();
        this.exit.copy(edge);
        this.bear.place(edge, Math.atan2(h.player.feet.x - edge.x, h.player.feet.z - edge.z));
        this.bear.moveTo(h.player.feet, 2.4);
        this.phase = 'approach';
        this.timer = 0;
        h.audio?.bearRoar();
        if (h.audio) bearStab(h.audio);
        h.music?.duck(20);
        h.bus.emit('bearArrived', {});
      }
      return;
    }
    const bear = this.bear!;
    bear.step(dt);
    if (this.phase === 'approach') {
      const d = bear.position.distanceTo(h.player.feet);
      if (d > 2.4) {
        if (!bear.moving || this.timer % 0.5 < dt) bear.moveTo(h.player.feet, 2.4);
      } else {
        bear.stop();
        bear.sniff(E.bearSniffSeconds);
        this.phase = 'sniff';
        this.timer = 0;
        h.caption('*sniff sniff*');
      }
      if (this.timer > 40) this.leave(); // couldn't reach the player
      return;
    }
    if (this.phase === 'sniff') {
      if (this.timer >= E.bearSniffSeconds) this.swipe();
      return;
    }
    if (this.phase === 'swipe') {
      for (const f of this.flying) {
        f.t += dt * 1.8;
        const u = Math.min(1, f.t);
        f.mesh.position.lerpVectors(f.from, bear.mouth(), u);
        f.mesh.position.y += Math.sin(u * Math.PI) * 1.2;
        f.mesh.rotation.x += dt * 9;
        if (u >= 1) f.mesh.visible = false;
      }
      if (this.timer >= 1.6) this.leave();
      return;
    }
    if (this.phase === 'leave') {
      if (!bear.moving || this.timer > 25) this.finish();
    }
  }

  private swipe(): void {
    const h = this.h;
    const bear = this.bear!;
    this.phase = 'swipe';
    this.timer = 0;
    const n = removeAllFish(h.inventory);
    if (n > 0) {
      h.audio?.bearSwipe();
      h.stats.fishLostToBears += n;
      h.stats.worstDayBear = h.clock.day;
      const p = h.player.feet;
      for (let i = 0; i < Math.min(n, 10); i++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1.6, 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x5aa0d8, roughness: 0.35, metalness: 0.3 }));
        const from = new THREE.Vector3(p.x + (h.rng.next() - 0.5) * 0.6, p.y + 1.0 + h.rng.next() * 0.4, p.z + (h.rng.next() - 0.5) * 0.6);
        mesh.position.copy(from);
        h.world.scene.add(mesh);
        this.flying.push({ mesh, from, t: -i * 0.12 });
      }
      h.toast(`The bear took ${n} fish. All of them. It didn't even chew.`, 'warn');
      h.bus.emit('bearTook', { fish: n });
    } else {
      h.audio?.bearHuff();
      let snack: string | null = null;
      for (const id of ['burger', 'granola_bar']) if (hasItem(h.inventory, id) && h.rng.chance(0.5)) snack = id;
      if (snack) {
        h.takeItem(snack, 1);
        h.toast(`No fish. The bear huffs, takes a ${snack === 'burger' ? 'burger' : 'granola bar'}, and leaves.`, 'warn');
      } else h.toast('No fish. The bear huffs, disapprovingly, and leaves.');
      h.bus.emit('bearTook', { fish: 0 });
    }
    h.unlockChecks();
    void h.save('bear');
  }

  /** Where a weapon attack has to point to scare it, while it is coming (§11.4). */
  override threatTarget(): { position: THREE.Vector3; radius: number; name: string } | null {
    if (!this.bear || (this.phase !== 'approach' && this.phase !== 'sniff')) return null;
    return { position: new THREE.Vector3(this.bear.position.x, this.bear.position.y + 0.9, this.bear.position.z), radius: 1.5, name: 'the bear' };
  }

  /** A weapon attack toward it during the approach sends it running (achievement Bear Necessities). */
  override onThreatened(): void {
    if (this.phase !== 'approach' && this.phase !== 'sniff') return;
    this.scared = true;
    this.h.stats.bearsScared++;
    this.h.toast('The bear thinks better of it and crashes back into the woods.');
    this.h.unlockChecks();
    this.leave();
  }

  private leave(): void {
    const h = this.h;
    const bear = this.bear!;
    this.phase = 'leave';
    this.timer = 0;
    // lumber off the way it came (or the far side)
    const away = this.scared ? this.exit : new THREE.Vector3(bear.position.x + (bear.position.x - h.player.feet.x) * 6, 0, bear.position.z + (bear.position.z - h.player.feet.z) * 6);
    away.y = h.world.groundAt(away.x, away.z);
    bear.moveTo(away, this.scared ? 4.5 : 2.0);
    h.bus.emit('bearLeft', { scared: this.scared });
  }

  override render(dt: number): void {
    this.bear?.render(dt);
  }

  protected override cleanup(): void {
    for (const f of this.flying) f.mesh.removeFromParent();
    this.bear?.dispose();
  }
}
