// The Park Ranger (plan §12.3, §11.4): forced by the Director at wanted ≥ 2. Ranger Rhonda (or
// rookie Tom when she was poofed recently; both once a ranger has been poofed) jogs in with a
// whistle, lectures the player in dialogue, confiscates their best weapon plus one item as a fine,
// and resets wanted to 0 (achievement Most Wanted on the first confiscation). Rangers are armed
// innocents: aiming at one makes them hostile. Every phase ends when the ranger is stuck or late.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { Npc } from '../../actors/npc.ts';
import type { NpcDef } from '../../data/npcs.ts';
import type { DialogueTree } from '../../data/dialogue.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { itemDef } from '../../data/items.ts';
import { isOutOfPool, markSeen } from '../../sim/npcMemory.ts';
import { bestWeapon, mostValuable } from '../../sim/confrontation.ts';

const E = TUNABLES.events;
const N = TUNABLES.npc;

export class RangerRunner extends EventRunner {
  readonly type = 'ranger' as const;
  private rangers: Npc[] = [];
  private lead: Npc | null = null;
  private timer = 0;
  private lectured = false;

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    // Rhonda leads unless she is out of the pool; both come once a ranger has been poofed (§12.3)
    const rhondaOut = isOutOfPool(h.memoryFor('rhonda'), h.now());
    const leadId = this.preferred ?? (rhondaOut ? 'tom' : 'rhonda');
    const defs: NpcDef[] = h.pickNpcsFor('ranger', h.director.rangersBoth ? 2 : 1, leadId).filter((d) => !isOutOfPool(h.memoryFor(d.id), h.now()) || d.id === leadId);
    if (!defs.length) return this.finish();
    const spawn = h.npcs.spawnPoint(h.player.feet, 30, () => h.rng.next());
    let i = 0;
    for (const def of defs) {
      const npc = await h.npcs.spawn(def, new THREE.Vector3(spawn.x + i * 1.3, spawn.y, spawn.z + i * 0.6), 0);
      markSeen(h.memoryFor(def.id), h.clock.day);
      npc.tag = 'busy';
      this.rangers.push(npc);
      npc.goTo(h.npcs.approachPoint(h.player.feet, spawn, 2.4, i ? 1.7 : 0), N.jogSpeed * 0.9);
      if (i === 0) {
        this.lead = npc;
        npc.onArrive = () => void this.lecture();
      } else {
        npc.onArrive = () => {
          npc.face(h.player.feet);
          npc.lookAt(h.player.feet);
          h.bubble(npc, h.eventLine(npc.def, 'wave') ?? "Everything's fine!", 4);
        };
      }
      i++;
    }
    this.phase = 'approach';
    this.timer = 0;
    h.audio?.whistle();
    h.caption('*a whistle, from up the trail*');
    if (this.lead) h.bubble(this.lead, this.lead.def.id === 'tom' ? 'S-stop! Park ranger! First week!' : 'Hold it right there.', 4);
  }

  private async lecture(): Promise<void> {
    const h = this.h;
    const lead = this.lead;
    if (!lead || this.done || this.lectured || this.phase === 'fight') return;
    this.lectured = true;
    this.phase = 'lecture';
    const def = lead.def;
    lead.face(h.player.feet);
    lead.lookAt(h.player.feet);
    const robberies = h.stats.robberies;
    const weapon = bestWeapon(h.inventory.slots);
    const tom = def.id === 'tom';
    const opener = tom
      ? `Okay. Okay! First week. Regulation 14-B: ${robberies} robber${robberies === 1 ? 'y' : 'ies'} on the trail. That's you. Hand over the ${weapon ? itemDef(weapon.stack.id).name : 'weapon'}. Please? There's a form.`
      : `Per park regulation 14-B: ${robberies} robber${robberies === 1 ? 'y' : 'ies'} on my trail. I have not slept since May. ${weapon ? `The ${itemDef(weapon.stack.id).name}.` : 'Weapon.'} Now. Thank you.`;
    const tree: DialogueTree = {
      id: `ranger_${def.id}`,
      start: 'demand',
      nodes: {
        demand: { say: [opener], choices: [{ text: 'Fine. Take it.', next: 'confiscate' }, { text: 'What weapon?', next: 'that_one' }, { text: 'Make me.', next: 'resist' }] },
        that_one: { say: [weapon ? 'That one. The one you keep looking at.' : tom ? "You don't have one? Oh thank goodness. Still a fine, though. Sorry." : "No weapon? Then this is a warning. And a fine. Regulation 14-C."], choices: [{ text: '...Fine.', next: 'confiscate' }, { text: 'Make me.', next: 'resist' }] },
        confiscate: { say: [tom ? 'Thank you thank you thank you. I have to file this. Seven forms.' : 'Thank you. Confiscated. Plus one item as a fine, per 14-C. Stay within regulations.'], next: 'end' },
        resist: { say: [tom ? 'Oh no. Oh no no no. Regulation 40-A. I fight back. Sort of!' : "Oh, it's like that? Regulation 40-A: I fight back."], next: 'end' },
      },
    };
    const end = await h.talk(lead, tree, { name: def.name });
    if (this.done || this.phase === 'fight') return;
    if (end === 'resist') {
      this.phase = 'fight';
      h.engageHostile(lead, true);
      return;
    }
    this.confiscate();
    this.leave();
  }

  /** The best weapon plus one item as a fine go into the ranger's pockets; wanted resets (§12.3). */
  private confiscate(): void {
    const h = this.h;
    const lead = this.lead!;
    const goods = h.npcGoods(lead.def);
    const weapon = bestWeapon(h.inventory.slots);
    const taken: string[] = [];
    if (weapon) {
      h.inventory.slots[weapon.index] = null;
      goods.push({ ...weapon.stack });
      taken.push(itemDef(weapon.stack.id).name);
    }
    let fineId: string | null = null;
    for (let i = 0; i < TUNABLES.ranger.fineItems; i++) {
      const fine = mostValuable(h.inventory.slots, { excludeWeapons: true }) ?? mostValuable(h.inventory.slots);
      if (!fine) break;
      h.inventory.slots[fine.index] = null;
      goods.push({ ...fine.stack });
      fineId = fine.stack.id;
      taken.push(`${itemDef(fine.stack.id).name}${fine.stack.count > 1 ? ` ×${fine.stack.count}` : ''} (the fine)`);
    }
    h.director.wanted = 0;
    if (weapon) h.stats.confiscations++;
    h.toast(taken.length ? `${lead.def.name} confiscates: ${taken.join(', ')}.` : `${lead.def.name} lets you off with a warning. This time.`, 'warn');
    h.applyWornOutfit();
    h.bus.emit('confiscation', { npcId: lead.def.id, weapon: weapon?.stack.id ?? null, fine: fineId });
    h.unlockChecks();
    void h.save('ranger');
  }

  private leave(): void {
    const h = this.h;
    this.phase = 'leave';
    this.timer = 0;
    this.rangers.forEach((npc, i) => {
      if (!h.npcs.get(npc.def.id)) return;
      npc.lookAt(null);
      npc.face(null);
      npc.tag = 'busy';
      npc.goTo(h.npcs.exitPoint(npc.feet, () => h.rng.next()), N.walkSpeed * (1.05 - 0.06 * i));
      npc.onArrive = () => void h.npcs.despawn(npc.def.id);
    });
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    this.timer += dt;
    if (this.phase === 'approach') {
      // a ranger who can't reach the player lectures from where they stand
      for (const n of this.rangers) if (n.isMoving && (n.stuckFor > E.stuckSeconds || this.timer > TUNABLES.ranger.approachTimeoutSeconds)) n.arriveNow();
      return;
    }
    if (this.phase === 'fight') {
      // the combat system has the lead; the event ends when every ranger is gone
      if (this.rangers.every((n) => !h.npcs.get(n.def.id))) this.finish();
      else if (this.timer > 240) this.finish();
      return;
    }
    if (this.phase === 'leave') {
      for (const n of this.rangers) if (h.npcs.get(n.def.id) && (n.stuckFor > E.stuckSeconds || this.timer > E.leaveTimeoutSeconds)) h.npcs.despawn(n.def.id);
      if (this.rangers.every((n) => !h.npcs.get(n.def.id) || n.feet.distanceTo(h.player.feet) > N.despawnDistance)) this.finish();
    }
  }

  /** Aimed at: rangers are armed innocents and draw (the combat system makes them hostile). */
  override onThreatened(npcId?: string): void {
    if (this.done || !npcId || !this.rangers.some((n) => n.def.id === npcId)) return;
    if (this.phase === 'approach' || this.phase === 'lecture') {
      this.phase = 'fight';
      this.timer = 0;
      if (this.h.isDialogueOpen()) this.h.closeDialogue();
      // the second ranger backs the first up
      for (const n of this.rangers) if (n.def.id !== npcId && this.h.npcs.get(n.def.id) && !n.engaged) this.h.engageHostile(n, true);
    }
  }

  override onNpcGone(npcId: string): void {
    this.rangers = this.rangers.filter((n) => n.def.id !== npcId);
    if (this.lead?.def.id === npcId) this.lead = this.rangers[0] ?? null;
    if (!this.rangers.length) this.finish();
  }

  protected override cleanup(): void {
    for (const n of this.rangers) this.h.npcs.despawn(n.def.id);
  }
}
