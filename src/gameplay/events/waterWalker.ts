// Water-walkers (plan §11.4): a roster water-walker rises from the river near the player, dripping,
// walks up the bank, delivers their bit, may trade or give a quest, then leaves by the trail.
import * as THREE from 'three';
import { EventRunner, type EventHost } from './host.ts';
import type { Npc } from '../../actors/npc.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { markSeen } from '../../sim/npcMemory.ts';

const E = TUNABLES.events;

export class WaterWalkerRunner extends EventRunner {
  readonly type = 'waterwalker' as const;
  private npc: Npc | null = null;
  private rise = 0;
  private linger = 0;
  private leaving = false;
  /** Seconds in the leave phase. */
  private timer = 0;
  private bank = new THREE.Vector3();

  constructor(h: EventHost, preferred?: string) {
    super(h, preferred);
  }

  async start(): Promise<void> {
    const h = this.h;
    const [def] = h.pickNpcsFor('waterwalker', 1, this.preferred);
    if (!def) return this.finish();
    const v = h.world.valley;
    const p = h.player.feet;
    // the water point: on the player's side of the channel, a little upstream
    const z = p.z + (h.rng.next() - 0.5) * 6;
    const cx = v.riverCenterX(z);
    const hw = v.riverHalfWidth(z);
    const side = Math.sign(p.x - cx) || 1;
    const start = new THREE.Vector3(cx + side * hw * 0.45, -1.6, z);
    this.bank.set(cx + side * (hw + 1.6), 0, z);
    this.bank.y = h.world.groundAt(this.bank.x, this.bank.z);
    const npc = await h.npcs.spawn(def, start, Math.atan2(this.bank.x - start.x, this.bank.z - start.z));
    markSeen(h.memoryFor(def.id), h.clock.day);
    this.npc = npc;
    npc.mode = 'emerge';
    npc.tag = 'busy';
    npc.waterLevelWalk = true;
    this.rise = 0;
    this.phase = 'rise';
    h.audio?.rise();
    h.caption('*something is surfacing*');
  }

  step(dt: number): void {
    const h = this.h;
    const npc = this.npc;
    if (this.done || !npc) return;
    if (this.phase === 'rise') {
      this.rise += dt;
      const u = Math.min(1, this.rise / E.waterWalkerEmergeSeconds);
      npc.place(new THREE.Vector3(npc.feet.x, -1.6 + u * 1.25, npc.feet.z));
      if (u >= 1) {
        this.phase = 'walk';
        npc.wet(25);
        h.audio?.bigSplash();
        const line = h.eventLine(npc.def, 'emerge') ?? npc.def.catchphrases[0]!;
        h.bubble(npc, line, 5);
        npc.goTo(this.bank.clone(), TUNABLES.npc.walkSpeed * 0.8, { direct: true, water: true });
        npc.onArrive = () => {
          npc.mode = 'idle';
          npc.waterLevelWalk = false;
          npc.tag = '';
          this.phase = 'linger';
          npc.goTo(h.npcs.approachPoint(h.player.feet, npc.feet, 2.3), TUNABLES.npc.walkSpeed, { direct: true });
          npc.onArrive = () => {
            npc.face(h.player.feet);
            npc.lookAt(h.player.feet);
            const bark = h.barkFor(npc.def);
            if (bark) h.bubble(npc, bark, 4);
          };
          this.linger = E.visitLingerMinSeconds + h.rng.next() * (E.visitLingerMaxSeconds - E.visitLingerMinSeconds);
        };
      }
      return;
    }
    if (this.phase === 'linger' && !this.leaving) {
      // blocked on the way up to the player (trunks, a wading player's bank): say the bit from here
      if (npc.isMoving && npc.stuckFor > E.stuckSeconds) npc.arriveNow();
      if (!h.isDialogueOpen()) this.linger -= dt;
      if (this.linger <= 0 && !h.isDialogueOpen()) {
        this.leaving = true;
        this.phase = 'leave';
        this.timer = 0;
        npc.tag = 'busy';
        npc.lookAt(null);
        npc.face(null);
        npc.goTo(h.npcs.exitPoint(npc.feet, () => h.rng.next()), TUNABLES.npc.walkSpeed);
        npc.onArrive = () => h.npcs.despawn(npc.def.id);
      }
    } else if (this.leaving) {
      this.timer += dt;
      // a leaver who is stuck, or still about after the timeout, goes home directly: the event must end
      if (h.npcs.get(npc.def.id) && (npc.stuckFor > E.stuckSeconds || this.timer > E.leaveTimeoutSeconds)) h.npcs.despawn(npc.def.id);
      if (!h.npcs.get(npc.def.id) || npc.feet.distanceTo(h.player.feet) > TUNABLES.npc.despawnDistance) this.finish();
    }
  }

  override onTalk(): void {
    this.linger = Math.max(this.linger, 45);
  }

  override onRobbed(npcId: string): void {
    if (this.npc && npcId === this.npc.def.id) this.linger = 0;
  }

  override onNpcGone(npcId: string): void {
    if (this.npc && npcId === this.npc.def.id) this.finish();
  }

  protected override cleanup(): void {
    if (this.npc) this.h.npcs.despawn(this.npc.def.id);
  }
}
