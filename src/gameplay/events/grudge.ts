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
    if (this.done) return;
    if (end === 'gave' && best) {
      h.takeItem(best.id, best.count);
      addStolen(mem, [{ ...best }]);
      mem.grudge = false;
      mem.relationship += 5;
      h.toast(`${def.name} takes the ${want}. The grudge is settled.`);
    } else if (end === 'refused') {
      // a punch (§12.2 hostile attacks: punch −1 heart), then they leave, still holding the grudge
      npc.act('punch_cross', { loop: false, onFinished: () => npc.act(null) });
      h.audio?.hurt();
      h.damage(1, new THREE.Vector3(h.player.feet.x - npc.feet.x, 0, h.player.feet.z - npc.feet.z).normalize().multiplyScalar(2));
      h.toast(`${def.name} punches you and storms off. The grudge stands.`, 'warn');
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
    npc.lookAt(null);
    npc.face(null);
    npc.goTo(h.npcs.exitPoint(h.player.feet, () => h.rng.next()), TUNABLES.npc.jogSpeed);
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
    if (this.leaving && this.npc && (!h.npcs.get(this.npc.def.id) || this.npc.feet.distanceTo(h.player.feet) > TUNABLES.npc.despawnDistance)) this.finish();
    if (this.phase === 'approach' && this.timer > 60) this.leave();
  }

  ringState(): ReturnType<ThiefRunner['ringState']> {
    return this.inner?.ringState() ?? null;
  }

  protected override cleanup(): void {
    this.inner?.abort();
    if (this.npc) this.h.npcs.despawn(this.npc.def.id);
  }
}
