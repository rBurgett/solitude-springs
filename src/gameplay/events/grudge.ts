// Grudge returns (plan §11.4 "Grudge return", §2.2 "Grudges"): a previously robbed or poofed NPC
// walks up with a callback line. Armed: they demand something (hand over an item, or refuse and
// take a punch). Unarmed: they try to steal one item back (the thief flow) and run.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { Npc } from '../../actors/npc.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { markSeen, addStolen } from '../../sim/npcMemory.ts';
import type { DialogueTree } from '../../data/dialogue.ts';
import { itemDef } from '../../data/items.ts';
import { ThiefRunner } from './thief.ts';

const E = TUNABLES.events;

export class GrudgeRunner extends EventRunner {
  readonly type = 'grudge' as const;
  private npc: Npc | null = null;
  private inner: ThiefRunner | null = null;
  private timer = 0;
  private leaving = false;

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    const def = (this.preferred && h.pickNpcsFor('grudge', 1, this.preferred)[0]) || h.grudgeCandidate();
    if (!def) return this.finish();
    if (def.armed === 'none') {
      // an unarmed grudge: a single-item theft with the grudge line
      this.inner = new ThiefRunner(h, def.id, { maxItems: 1 });
      this.phase = 'thief';
      await this.inner.start();
      return;
    }
    const spawn = h.npcs.spawnPoint(h.player.feet, 30, () => h.rng.next());
    const npc = await h.npcs.spawn(def, spawn, 0);
    markSeen(h.memoryFor(def.id), h.clock.day);
    this.npc = npc;
    npc.tag = 'busy';
    this.phase = 'approach';
    npc.goTo(h.npcs.approachPoint(h.player.feet, spawn, 2.2), TUNABLES.npc.jogSpeed * 0.8);
    npc.onArrive = () => void this.confront();
    const line = h.eventLine(def, 'grudge') ?? 'Remember me?';
    h.bubble(npc, line, 4);
  }

  private async confront(): Promise<void> {
    const h = this.h;
    const npc = this.npc!;
    const def = npc.def;
    const mem = h.memoryFor(def.id);
    npc.face(h.player.feet);
    npc.lookAt(h.player.feet);
    this.phase = 'demand';
    // making demands: Threatening, so a drawn weapon works on them without raising wanted (§12.2)
    h.setStance(def.id, 'threatening');
    // the most valuable thing the player carries that isn't bound
    let best: { id: string; count: number; color?: string } | null = null;
    for (const s of h.inventory.slots) if (s && !itemDef(s.id).bound && (!best || itemDef(s.id).value > itemDef(best.id).value)) best = s;
    const want = best ? itemDef(best.id).name : 'something';
    const tree: DialogueTree = {
      id: `grudge_${def.id}`,
      start: 'demand',
      nodes: {
        demand: {
          say: [`${h.eventLine(def, 'grudge') ?? 'We have unfinished business.'} Hand over the ${want}. Now.`],
          choices: [
            { text: `Fine. Take the ${want}.`, next: 'gave' },
            { text: 'No.', next: 'refused' },
            { text: 'Who are you again?', next: 'who' },
          ],
        },
        who: { say: ['WHO AM I? Unbelievable. The ' + want + '. Now.'], choices: [{ text: 'Fine.', next: 'gave' }, { text: 'No.', next: 'refused' }] },
        gave: { say: ['Smart. We\'re even. For now.'], next: 'end' },
        refused: { say: ['Wrong answer.'], next: 'end' },
      },
    };
    const end = await h.talk(npc, tree);
    if (this.done || this.phase === 'fight') return;
    if (end === 'gave' && best) {
      h.takeItem(best.id, best.count);
      addStolen(mem, [{ ...best }]);
      mem.grudge = false;
      mem.relationship += 5;
      h.toast(`${def.name} takes the ${want}. The grudge is settled.`);
    } else if (end === 'refused') {
      // "or fight" (§11.4): they draw; the combat system runs the fight from here (§12.2)
      this.phase = 'fight';
      h.toast(`${def.name} draws. Wrong answer.`, 'warn');
      h.engageHostile(npc, false);
      return;
    } else {
      h.toast(`${def.name} storms off.`);
    }
    h.stats.grudgesHandled++;
    h.unlockChecks();
    this.leave();
  }

  private leave(): void {
    const h = this.h;
    const npc = this.npc!;
    this.leaving = true;
    this.phase = 'leave';
    this.timer = 0;
    npc.lookAt(null);
    npc.face(null);
    // along their own bank's trail (after the approach timeout they may not be anywhere near the player)
    npc.goTo(h.npcs.exitPoint(npc.feet, () => h.rng.next()), TUNABLES.npc.jogSpeed);
    npc.onArrive = () => h.npcs.despawn(npc.def.id);
  }

  step(dt: number): void {
    const h = this.h;
    if (this.done) return;
    if (this.inner) {
      this.inner.step(dt);
      if (this.inner.done) {
        h.stats.grudgesHandled++;
        h.unlockChecks();
        this.finish();
      }
      return;
    }
    this.timer += dt;
    const npc = this.npc;
    if (this.phase === 'fight') {
      // the combat system has them; it despawns them when the fight resolves (onNpcGone)
      if (!npc || !h.npcs.get(npc.def.id)) this.finish();
      return;
    }
    if (this.leaving && npc) {
      // a leaver who is stuck, or still about after the timeout, goes home directly: the event must end
      if (h.npcs.get(npc.def.id) && (npc.stuckFor > E.stuckSeconds || this.timer > E.leaveTimeoutSeconds)) h.npcs.despawn(npc.def.id);
      if (!h.npcs.get(npc.def.id) || npc.feet.distanceTo(h.player.feet) > TUNABLES.npc.despawnDistance) this.finish();
    }
    // can't reach the player (or blocked for good): the grudge keeps, they storm off
    if (this.phase === 'approach' && npc && (this.timer > 60 || npc.stuckFor > E.stuckSeconds)) this.leave();
  }

  ringState(): ReturnType<ThiefRunner['ringState']> {
    return this.inner?.ringState() ?? null;
  }

  /** Aimed at while approaching or demanding: an armed grudge draws (the combat system makes them hostile). */
  override onThreatened(npcId?: string): void {
    if (this.inner) return this.inner.onThreatened(npcId);
    if (!this.npc || (npcId && npcId !== this.npc.def.id) || this.done) return;
    if (this.phase === 'approach' || this.phase === 'demand') {
      this.phase = 'fight';
      if (this.h.isDialogueOpen()) this.h.closeDialogue();
    }
  }

  override onRobbed(npcId: string): void {
    this.inner?.onRobbed(npcId);
  }

  override onNpcGone(npcId: string, reason: 'poofed' | 'fled'): void {
    if (this.inner) return this.inner.onNpcGone(npcId, reason);
    if (!this.npc || npcId !== this.npc.def.id) return;
    this.h.stats.grudgesHandled++;
    this.h.unlockChecks();
    this.finish();
  }

  protected override cleanup(): void {
    this.inner?.abort();
    if (this.npc) this.h.npcs.despawn(this.npc.def.id);
  }
}
