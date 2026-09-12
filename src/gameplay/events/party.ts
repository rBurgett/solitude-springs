// Parties (plan §11.4 "Party", §1 #10): 4–6 partiers arrive with a speaker and a cooler, 30 s of
// bass-heavy music, dancing and whooping with a flamingo floaty in the water; afterwards a ~35 m
// radius is trashed — brown grass, 15–30 scattered cans, beer-coloured water, zone population 0.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { Npc } from '../../actors/npc.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { markSeen } from '../../sim/npcMemory.ts';
import { PartyMusic } from '../../audio/party.ts';
import { whoop } from '../../audio/voices.ts';

const E = TUNABLES.events;

export class PartyRunner extends EventRunner {
  readonly type = 'party' as const;
  private group: Npc[] = [];
  private center = new THREE.Vector3();
  private zoneId: string | null = null;
  private timer = 0;
  private arrived = 0;
  private music: PartyMusic | null = null;
  private props = new THREE.Group();
  private flamingo: THREE.Group | null = null;
  private whoopTimer = 1.5;
  private cansGiven = new Set<string>();
  private brokeUp = false;

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    const v = h.world.valley;
    const p = h.player.feet;
    // the party spot: on the bank near the player, ~4 m from the water's edge on the player's side
    const cx = v.riverCenterX(p.z);
    const side = Math.sign(p.x - cx) || 1;
    const hw = v.riverHalfWidth(p.z);
    let x = cx + side * (hw + 4.5);
    if (Math.abs(p.x - x) > 12) x = p.x + side * 3;
    const z = p.z + (h.rng.next() - 0.5) * 8;
    this.center.set(x, h.world.groundAt(x, z), z);
    this.zoneId = v.zoneForZ(z)?.id ?? null;
    const count = E.partyGroupMin + Math.floor(h.rng.next() * (E.partyGroupMax - E.partyGroupMin + 1));
    const defs = h.pickNpcsFor('party', count, this.preferred);
    if (defs.length < 2) return this.finish();
    const spawn = h.npcs.spawnPoint(this.center, 36, () => h.rng.next());
    h.world.scene.add(this.props);
    let i = 0;
    for (const def of defs) {
      const npc = await h.npcs.spawn(def, spawn.clone().add(new THREE.Vector3((i % 3) * 1.1, 0, Math.floor(i / 3) * 1.1)), 0);
      markSeen(h.memoryFor(def.id), h.clock.day);
      this.group.push(npc);
      if (i === 0) this.carry(npc, 'speaker');
      else if (i === 1) this.carry(npc, 'cooler');
      const a = (i / defs.length) * Math.PI * 2;
      const r = 2.2 + h.rng.next() * 1.8;
      const target = new THREE.Vector3(this.center.x + Math.cos(a) * r, 0, this.center.z + Math.sin(a) * r);
      if (v.edgeDistance(target.x, target.z) < 1.5) target.set(this.center.x + Math.cos(a) * 0.8, 0, this.center.z + Math.sin(a) * 0.8);
      target.y = h.world.groundAt(target.x, target.z);
      npc.goTo(target, TUNABLES.npc.walkSpeed * 1.15);
      npc.onArrive = () => this.onArrive(npc);
      i++;
    }
    this.phase = 'arrive';
    h.caption('*voices and a bass line, getting closer*');
  }

  private carry(npc: Npc, what: 'speaker' | 'cooler'): void {
    const mesh = what === 'speaker'
      ? new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: 0xd9eaf5, roughness: 0.5 }));
    mesh.castShadow = true;
    mesh.name = what;
    mesh.position.set(0, -0.1, 0.25);
    npc.character.attach(mesh, 'hand_l');
    npc.tag = 'busy';
  }

  private onArrive(npc: Npc): void {
    const h = this.h;
    this.arrived++;
    npc.tag = '';
    // put the props down
    for (const name of ['speaker', 'cooler']) {
      const carried = npc.character.root.getObjectByName(name);
      if (carried) {
        carried.removeFromParent();
        carried.position.set(npc.feet.x + Math.sin(npc.yaw) * 0.6, npc.feet.y + 0.16, npc.feet.z + Math.cos(npc.yaw) * 0.6);
        carried.rotation.set(0, npc.yaw, 0);
        this.props.add(carried);
      }
    }
    npc.face(this.center);
    npc.act('dance', { loop: true, timeScale: 0.95 + h.rng.next() * 0.15 });
    if (this.arrived === 1) this.beginParty();
  }

  private beginParty(): void {
    const h = this.h;
    this.phase = 'party';
    this.timer = 0;
    if (h.audio) {
      h.audio.recordScratch();
      h.music?.duck(E.partySeconds + 8);
      this.music = new PartyMusic(h.audio);
      this.music.start();
    }
    // the flamingo floaty lands on the water near the spot
    const v = h.world.valley;
    const cx = v.riverCenterX(this.center.z);
    const side = Math.sign(this.center.x - cx) || 1;
    const fx = cx + side * v.riverHalfWidth(this.center.z) * 0.45;
    this.flamingo = makeFlamingo();
    this.flamingo.position.set(fx, 0.02, this.center.z + 2);
    this.props.add(this.flamingo);
    h.bus.emit('partyStarted', { zoneId: this.zoneId ?? '' });
  }

  override onTalk(npcId: string): void {
    const h = this.h;
    const npc = this.group.find((n) => n.def.id === npcId);
    if (!npc || this.phase !== 'party' || this.cansGiven.has(npcId)) return;
    if (h.rng.chance(0.5)) {
      this.cansGiven.add(npcId);
      h.give('beer_can', 1);
      h.toast(`${npc.def.name} hands you a beer can.`);
    }
  }

  /** M3: threatening the group scatters them early; the damage is still done (achievement Buzzkill). */
  breakUp(): void {
    if (this.phase !== 'party' && this.phase !== 'arrive') return;
    this.brokeUp = true;
    this.h.stats.partiesBroken++;
    this.endParty();
  }

  override onThreatened(): void {
    this.breakUp();
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    if (this.phase === 'arrive' || this.phase === 'party') {
      // a partier who can't reach their spot (water, trunks, a crowd) dances where they stand
      for (const n of this.group) if (n.isMoving && n.stuckFor > E.stuckSeconds) n.arriveNow();
    }
    if (this.phase === 'party') {
      this.timer += dt;
      this.whoopTimer -= dt;
      if (this.whoopTimer <= 0) {
        this.whoopTimer = 1.2 + h.rng.next() * 2.2;
        const npc = this.group[Math.floor(h.rng.next() * this.group.length)]!;
        const line = h.eventLine(npc.def, 'party');
        if (line) h.bubble(npc, line, 2.5);
        if (h.audio) whoop(h.audio, npc.def.voice.pitch, 0.18 / (1 + Math.max(0, npc.feet.distanceTo(h.player.feet) - 8) * 0.1));
      }
      if (this.flamingo) this.flamingo.position.y = 0.02 + Math.sin(this.timer * 1.6) * 0.05;
      if (this.timer >= E.partySeconds) this.endParty();
    } else if (this.phase === 'leave') {
      this.timer += dt;
      // a leaver who is stuck, or still about after the timeout, goes home directly: the event must end
      for (const n of this.group) if (h.npcs.get(n.def.id) && (n.stuckFor > E.stuckSeconds || this.timer > E.leaveTimeoutSeconds)) h.npcs.despawn(n.def.id);
      const gone = this.group.every((n) => !h.npcs.get(n.def.id) || n.feet.distanceTo(this.center) > 60);
      if (gone) this.finish();
    } else if (this.phase === 'arrive') {
      this.timer += dt;
      if (this.timer > 60 && this.arrived === 0) this.beginParty(); // stuck somewhere: start anyway
    }
  }

  override render(): void {
    if (this.music) this.music.update(this.h.player.feet.distanceTo(this.center));
  }

  private endParty(): void {
    const h = this.h;
    this.phase = 'leave';
    this.timer = 0;
    this.music?.stop();
    this.music = null;
    // aftermath: brown grass + beer water + cans + population 0 (§11.4)
    if (this.zoneId) {
      const z = h.zones.get(this.zoneId);
      if (z) {
        z.trash = 1;
        z.population = 0;
      }
      h.setZoneTrash(this.zoneId, 1, [this.center.x, this.center.z]);
    }
    const cans = E.partyCansMin + Math.floor(h.rng.next() * (E.partyCansMax - E.partyCansMin + 1));
    const v = h.world.valley;
    let placed = 0;
    let tries = 0;
    while (placed < cans && tries < cans * 12) {
      tries++;
      const a = h.rng.next() * Math.PI * 2;
      const r = 2 + Math.sqrt(h.rng.next()) * Math.min(18, E.partyRadius * 0.5);
      const x = this.center.x + Math.cos(a) * r;
      const zz = this.center.z + Math.sin(a) * r;
      if (v.edgeDistance(x, zz) < 0.6) continue;
      h.spawnPickup('beer_can', 1, new THREE.Vector3(x, h.world.groundAt(x, zz), zz));
      placed++;
    }
    h.toast(this.brokeUp ? 'The party scatters. The mess stays.' : 'The party moves on. The river is the colour of beer.', 'warn');
    h.bus.emit('partyEnded', { zoneId: this.zoneId ?? '', cans: placed, brokeUp: this.brokeUp });
    // the partiers leave (the speaker and cooler go with the first two)
    const exit = h.npcs.exitPoint(this.center, () => h.rng.next());
    this.group.forEach((npc, i) => {
      npc.act(null);
      npc.face(null);
      npc.tag = 'busy';
      // a slightly different pace each, so the group strings out along the trail instead of leaving as one clump
      npc.goTo(exit, this.brokeUp ? TUNABLES.npc.fleeSpeed : TUNABLES.npc.walkSpeed * (1 - 0.04 * i));
      npc.onArrive = () => h.npcs.despawn(npc.def.id);
    });
    for (const name of ['speaker', 'cooler']) this.props.getObjectByName(name)?.removeFromParent();
    this.flamingo?.removeFromParent();
    this.flamingo = null;
    h.unlockChecks();
    void h.save('party');
  }

  protected override cleanup(): void {
    this.music?.stop();
    this.props.removeFromParent();
    for (const n of this.group) this.h.npcs.despawn(n.def.id);
  }
}

function makeFlamingo(): THREE.Group {
  const g = new THREE.Group();
  const pink = new THREE.MeshStandardMaterial({ color: 0xff6aa8, roughness: 0.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.3, 10, 24), pink);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  g.add(ring);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.1, 10), pink);
  neck.position.set(0.7, 0.85, 0);
  neck.rotation.z = 0.25;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), pink);
  head.position.set(0.85, 1.42, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(1.1, 1.38, 0);
  g.add(beak);
  for (const m of [ring, neck, head]) m.castShadow = true;
  return g;
}
