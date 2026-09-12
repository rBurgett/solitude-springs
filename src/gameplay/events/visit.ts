// Camper / hiker visits (plan §11.4): 1–2 roster NPCs walk in along the nearest trail, greet with
// an outfit/context bark, hang around for 60–90 s unless engaged, then drift off.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { EventType } from '../../data/events.ts';
import type { Npc } from '../../actors/npc.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { markSeen } from '../../sim/npcMemory.ts';

const E = TUNABLES.events;

export class VisitRunner extends EventRunner {
  readonly type: EventType;
  private visitors: Npc[] = [];
  private linger = 0;
  private leaving = false;
  private reapproached = new Set<string>();
  /** Seconds in the current phase. */
  private timer = 0;

  constructor(h: EventHost, type: 'visit' | 'hiker', preferred?: string) {
    super(h, preferred);
    this.type = type;
  }

  async start(): Promise<void> {
    const h = this.h;
    const count = this.type === 'visit' && h.rng.chance(0.4) ? 2 : 1;
    const defs = h.pickNpcsFor(this.type, count, this.preferred);
    if (defs.length === 0) return this.finish();
    const spawn = h.npcs.spawnPoint(h.player.feet, 26, () => h.rng.next());
    let i = 0;
    for (const def of defs) {
      const npc = await h.npcs.spawn(def, spawn.clone().add(new THREE.Vector3(i * 1.2, 0, i * 0.8)), 0);
      markSeen(h.memoryFor(def.id), h.clock.day);
      this.visitors.push(npc);
      this.approach(npc, i);
      i++;
    }
    this.linger = E.visitLingerMinSeconds + h.rng.next() * (E.visitLingerMaxSeconds - E.visitLingerMinSeconds);
    this.phase = 'approach';
  }

  private approach(npc: Npc, index: number): void {
    const h = this.h;
    const target = h.npcs.approachPoint(h.player.feet, npc.feet, 2.4, index ? 1.6 : 0);
    npc.goTo(target, TUNABLES.npc.walkSpeed * 1.15);
    npc.onArrive = () => {
      npc.face(h.player.feet);
      npc.lookAt(h.player.feet);
      const bark = h.barkFor(npc.def) ?? h.eventLine(npc.def, 'wave') ?? npc.def.catchphrases[0]!;
      h.bubble(npc, bark, 4);
      npc.gesture('yes');
      if (this.phase === 'approach') this.phase = 'linger';
    };
  }

  override onTalk(): void {
    this.linger = Math.max(this.linger, 45);
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    this.timer += dt;
    if (!this.leaving) {
      // the visit clock only runs once somebody has arrived (a long route mustn't eat the visit) — but a
      // visitor who can't get here (the far bank of the pool, a wall of trunks) waves from where they are,
      // whether on the first approach, still walking after the first one arrived, or following the player
      for (const n of this.visitors) {
        if (n.isMoving && (n.stuckFor > E.stuckSeconds || (this.phase === 'approach' && this.timer > E.visitApproachTimeoutSeconds))) n.arriveNow();
      }
      if (this.phase === 'linger' && !h.isDialogueOpen()) this.linger -= dt;
      else if (this.phase === 'approach' && this.visitors.every((n) => !n.isMoving)) {
        this.phase = 'linger';
        this.timer = 0;
      }
      // if the player wanders off, follow once
      for (const npc of this.visitors) {
        if (!npc.isMoving && npc.mode !== 'act' && !this.reapproached.has(npc.def.id) && npc.feet.distanceTo(h.player.feet) > 12) {
          this.reapproached.add(npc.def.id);
          this.approach(npc, this.visitors.indexOf(npc)); // each to their own spot, not both to the first one's
        }
      }
      if (this.linger <= 0 && !h.isDialogueOpen()) {
        this.leaving = true;
        this.phase = 'leave';
        this.timer = 0;
        this.visitors.forEach((npc, i) => {
          // leave along their own bank's trail, not the player's
          const exit = h.npcs.exitPoint(npc.feet, () => h.rng.next());
          npc.lookAt(null);
          npc.face(null);
          npc.tag = 'busy';
          const bye = h.eventLine(npc.def, 'wave');
          if (bye) h.bubble(npc, bye, 3);
          // a slightly different pace each, so a pair strings out instead of walking off as one body
          npc.goTo(exit, TUNABLES.npc.walkSpeed * (1 - 0.08 * i));
          npc.onArrive = () => h.npcs.despawn(npc.def.id);
        });
      }
    } else {
      // a leaver who is stuck, or still about after the timeout, goes home directly: the event must end
      for (const n of this.visitors) if (h.npcs.get(n.def.id) && (n.stuckFor > E.stuckSeconds || this.timer > E.leaveTimeoutSeconds)) h.npcs.despawn(n.def.id);
      const gone = this.visitors.every((n) => !h.npcs.get(n.def.id) || n.feet.distanceTo(h.player.feet) > TUNABLES.npc.despawnDistance);
      if (gone) this.finish();
    }
  }

  protected override cleanup(): void {
    for (const n of this.visitors) this.h.npcs.despawn(n.def.id);
  }
}
