// Thieves (plan §11.4 "Thief", §1 #8): sneak up (or stroll up), rummage for 3 s with a progress
// ring, take 1–4 valued items — or the clothes, or leave the pity barrel — then flee toward the
// boundary carrying the loot. A thief who escapes may turn up later still holding it.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { Npc } from '../../actors/npc.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { executeTheft, wearsBarrel } from '../../sim/theft.ts';
import { addStolen, markSeen } from '../../sim/npcMemory.ts';
import { itemDef } from '../../data/items.ts';
import { rollGarmentColor } from '../../sim/inventory.ts';

const E = TUNABLES.events;
const N = TUNABLES.npc;

export class ThiefRunner extends EventRunner {
  readonly type = 'thief' as const;
  private npc: Npc | null = null;
  private sneak = true;
  private rummage = 0;
  private chase = 0;
  private stepTimer = 0;
  private fleeTimer = 0;
  private retarget = 0;
  /** The scripted tutorial thief (no sneak roll, always Pete). */
  private scripted: boolean;
  /** Grudge return: take at most one item. */
  private maxItems: number | null = null;

  constructor(h: EventHost, preferred?: string, opts: { scripted?: boolean; maxItems?: number } = {}) {
    super(h, preferred);
    this.scripted = !!opts.scripted;
    if (opts.maxItems) this.maxItems = opts.maxItems;
  }

  async start(): Promise<void> {
    const h = this.h;
    const [def] = h.pickNpcsFor('thief', 1, this.scripted ? 'pete' : this.preferred);
    if (!def) return this.finish();
    this.sneak = this.scripted ? true : h.rng.chance(E.thiefSneakChance);
    const p = h.player.feet;
    let spawn: THREE.Vector3;
    if (this.sneak) {
      // behind the player, off the trail is fine
      const back = new THREE.Vector3(-Math.sin(h.player.yaw), 0, -Math.cos(h.player.yaw));
      spawn = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(back, 20);
      // in the water, or across it (the player facing away from a narrow stretch): sneak up along the trail instead
      if (h.world.valley.edgeDistance(spawn.x, spawn.z) < 2 || h.npcs.nav.side(spawn.x, spawn.z) !== h.npcs.nav.side(p.x, p.z)) spawn = h.npcs.spawnPoint(p, 22, () => h.rng.next());
      spawn.y = h.world.groundAt(spawn.x, spawn.z);
    } else spawn = h.npcs.spawnPoint(p, 30, () => h.rng.next());
    const npc = await h.npcs.spawn(def, spawn, 0);
    markSeen(h.memoryFor(def.id), h.clock.day);
    this.npc = npc;
    npc.tag = 'busy';
    this.phase = 'approach';
    if (this.sneak) {
      h.caption('*rustling behind you*');
      h.audio?.rustle();
    } else {
      const line = h.eventLine(def, 'approach');
      if (line) h.bubble(npc, line, 4);
    }
    this.approach();
  }

  private approach(): void {
    const npc = this.npc!;
    npc.goTo(this.h.npcs.approachPoint(this.h.player.feet, npc.feet, 0.9), this.sneak ? N.jogSpeed * 0.75 : N.walkSpeed * 1.2, { direct: true });
    npc.onArrive = null;
  }

  /** A wading player is robbed from the bank. */
  private reach(): number {
    return this.h.player.depth > 0.05 ? 4.5 : 1.7;
  }

  step(dt: number): void {
    const h = this.h;
    const npc = this.npc;
    if (this.done || !npc) return;
    const d = npc.feet.distanceTo(h.player.feet);
    if (this.phase === 'approach') {
      this.chase += dt;
      this.retarget -= dt;
      if (this.retarget <= 0) {
        this.retarget = 0.4;
        if (d > this.reach()) this.approach();
      }
      if (this.sneak) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0 && d < 14) {
          this.stepTimer = 0.55;
          h.audio?.softFootstep();
        }
      }
      if (d <= this.reach()) {
        npc.stop();
        npc.face(h.player.feet);
        npc.act('pickup', { loop: true, timeScale: 1.4 });
        this.phase = 'rummage';
        this.rummage = 0;
        const line = h.eventLine(npc.def, 'rummage');
        if (line) h.bubble(npc, line, E.thiefRummageSeconds);
        h.bus.emit('theftStarted', { npcId: npc.def.id });
      } else if (this.chase > 30) {
        // couldn't catch the player: give up
        this.flee(false);
      }
      return;
    }
    if (this.phase === 'rummage') {
      if (d > this.reach() + 1.5) {
        // the player pulled away: chase again
        npc.act(null);
        this.phase = 'approach';
        this.approach();
        this.h.hud.setRing(null);
        return;
      }
      this.rummage += dt;
      if (this.rummage >= E.thiefRummageSeconds) {
        this.h.hud.setRing(null);
        this.steal();
      }
      return;
    }
    if (this.phase === 'flee') {
      this.fleeTimer += dt;
      if (this.fleeTimer > E.thiefGetawaySeconds || !h.npcs.get(npc.def.id) || d > 90) this.finish();
    }
  }

  /** Progress ring position for the HUD (world point above the thief's head). */
  ringState(): { pos: THREE.Vector3; t: number } | null {
    if (this.phase !== 'rummage' || !this.npc) return null;
    return { pos: new THREE.Vector3(this.npc.feet.x, this.npc.feet.y + 2.05 * this.npc.def.look.scale, this.npc.feet.z), t: this.rummage / E.thiefRummageSeconds };
  }

  private steal(): void {
    const h = this.h;
    const npc = this.npc!;
    const def = npc.def;
    const mem = h.memoryFor(def.id);
    const wasBarrel = wearsBarrel(h.inventory);
    const plan = executeTheft(h.inventory, def, () => h.rng.next());
    if (this.maxItems && plan.taken.length > this.maxItems) {
      // grudge returns take a single item: put the rest back
      for (const extra of plan.taken.splice(this.maxItems)) h.give(extra.id, extra.count, extra.color);
    }
    const names = (list: { id: string; count: number }[]): string => list.map((s) => `${itemDef(s.id).name}${s.count > 1 ? ` ×${s.count}` : ''}`).join(', ');
    if (plan.taken.length) {
      addStolen(mem, plan.taken);
      h.stats.timesRobbed++;
      h.stats.worstDayRobbed = h.clock.day;
      h.toast(`${def.name} took: ${names(plan.taken)}`, 'warn');
      h.bus.emit('theft', { npcId: def.id, items: plan.taken, stripped: false, barrel: false });
      this.flee(true);
    } else if (plan.stripped.length) {
      addStolen(mem, plan.stripped);
      h.stats.timesRobbed++;
      h.stats.worstDayRobbed = h.clock.day;
      if (!wasBarrel && !h.inventory.worn.top && !h.inventory.worn.bottom && !h.inventory.worn.full) {
        h.stats.timesStripped++;
        h.stats.worstDayStripped = h.clock.day;
      }
      h.applyWornOutfit();
      const line = h.eventLine(def, 'strip');
      if (line) h.bubble(npc, line, 4);
      h.toast(`${def.name} took the clothes off your back: ${names(plan.stripped)}`, 'warn');
      h.bus.emit('theft', { npcId: def.id, items: plan.stripped, stripped: true, barrel: false });
      this.flee(true);
    } else if (plan.barrel) {
      const color = rollGarmentColor('barrel', () => h.rng.next());
      h.equipWorn({ id: 'barrel', count: 1, ...(color ? { color } : {}) });
      h.stats.barrelsReceived++;
      h.applyWornOutfit();
      const line = h.eventLine(def, 'pity');
      if (line) h.bubble(npc, line, 5);
      h.toast(`${def.name} gave you a barrel. Out of pity.`, 'warn');
      h.bus.emit('theft', { npcId: def.id, items: [], stripped: false, barrel: true });
      npc.act(null);
      npc.gesture('no');
      // they leave slowly, shaking their head
      this.flee(false);
    } else {
      const line = def.id === 'ricky' ? "No shoes? None? I'm not a monster. I'm leaving." : 'Nothing? Nothing. Wow.';
      h.bubble(npc, line, 4);
      h.bus.emit('theft', { npcId: def.id, items: [], stripped: false, barrel: false });
      this.flee(false);
    }
    h.unlockChecks();
    void h.save('theft');
  }

  private flee(fast: boolean): void {
    const h = this.h;
    const npc = this.npc!;
    npc.act(null);
    npc.face(null);
    this.phase = 'flee';
    this.fleeTimer = 0;
    const line = h.eventLine(npc.def, 'flee');
    if (line && fast) h.bubble(npc, line, 3);
    // along their own bank's trail (a thief who gave up the chase may be nowhere near the player)
    const exit = h.npcs.exitPoint(npc.feet, () => h.rng.next());
    npc.goTo(exit, fast ? N.fleeSpeed : N.walkSpeed, { direct: false });
    npc.onArrive = () => h.npcs.despawn(npc.def.id);
  }

  override onThreatened(): void {
    // M3: a thief caught mid-rummage or fleeing surrenders / returns the loot.
  }

  protected override cleanup(): void {
    this.h.hud.setRing(null);
    if (this.npc) this.h.npcs.despawn(this.npc.def.id);
  }
}
