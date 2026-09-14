// Weapons and confrontations in the world (plan §12.1–§12.3): the over-the-shoulder aim with a
// target under the crosshair, the trigger (knife arc, hitscan with spread, ammo, reloads), the
// 1.5 s aim reaction — hands up and the robbery dialogue, a thief's surrender, or a drawn weapon —
// hostile NPCs approaching, attacking with bad aim and retreating, the red poof with its loot bag
// and floating hat, and scaring an approaching animal. The rules live in src/sim/confrontation.ts.
import * as THREE from 'three';
import type { World } from '../world/world.ts';
import type { Player } from '../actors/player.ts';
import type { ThirdPersonCamera } from '../actors/camera.ts';
import type { Npc } from '../actors/npc.ts';
import type { NpcManager } from './npcs.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { Rng } from '../core/rng.ts';
import type { EventBus } from '../core/events.ts';
import { countItem, removeItem, type InventoryState, type ItemStack } from '../sim/inventory.ts';
import type { StatsState } from '../sim/journal.ts';
import type { DirectorState } from '../sim/director.ts';
import { markPoofed, type NpcMemory } from '../sim/npcMemory.ts';
import type { NpcDef } from '../data/npcs.ts';
import type { DialogueNode, DialogueTree } from '../data/dialogue.ts';
import { itemDef } from '../data/items.ts';
import { TUNABLES } from '../data/tunables.ts';
import { makeItemMesh } from './itemMesh.ts';
import type { EventRunner } from './events/host.ts';
import {
  aimBroken, aimTick, applyReaction, attack, createCombatant, createWeaponState, hostileDamage, hostileHits, hostileTick, isWeapon, poofLoot, pullTrigger, reactionFor, resetEngagement, robbable, robbery,
  stanceAllowsDamage, surrenderLoot, tickWeapon, wantedForFight, wantedForPoof, weaponItemFor, weaponKind, weaponRange, weaponSpread,
  type Combatant, type RobberyChoice, type Stance, type WeaponId,
} from '../sim/confrontation.ts';

const C = TUNABLES.confrontation;
const N = TUNABLES.npc;
const E = TUNABLES.events;

export interface CombatHost {
  readonly world: World;
  readonly npcs: NpcManager;
  readonly player: Player;
  readonly camera: ThirdPersonCamera;
  readonly audio: AudioEngine | null;
  readonly rng: Rng;
  readonly inventory: InventoryState;
  readonly stats: StatsState;
  readonly director: DirectorState;
  readonly bus: EventBus;
  memoryFor(npcId: string): NpcMemory;
  /** Their goods (stock + loot + stolen), initialised on first use. */
  npcGoods(def: NpcDef): ItemStack[];
  now(): number;
  toast(text: string, kind?: 'info' | 'catch' | 'achievement' | 'save' | 'warn'): void;
  caption(text: string): void;
  bubble(npc: Npc, text: string, seconds?: number): void;
  give(itemId: string, count: number, color?: string): boolean;
  damage(hearts: number, knockback?: THREE.Vector3): void;
  talk(npc: Npc, tree: DialogueTree, opts?: { name?: string }): Promise<string>;
  isDialogueOpen(): boolean;
  /** Drop a loot bag holding `contents` at a point. */
  spawnLoot(at: THREE.Vector3, contents: ItemStack[]): void;
  unlockChecks(): void;
  save(reason: string): Promise<void>;
  activeRunner(): EventRunner | null;
  /** The NPC's hands-up / fight-back lines from their dialogue sheet. */
  handsUpLine(def: NpcDef): string;
  fightBackLine(def: NpcDef): string;
}

interface Engagement {
  npc: Npc;
  c: Combatant;
  mode: 'handsup' | 'hostile' | 'leaving';
  /** Seconds in the current mode. */
  timer: number;
  retarget: number;
}

interface Poof {
  points: THREE.Points;
  vel: Float32Array;
  t: number;
}

interface Hat {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  ground: number;
  t: number;
}

export interface AimHud {
  aiming: boolean;
  aim: { name: string; kind: Stance | 'animal'; progress: number } | null;
  ammo: number | null;
  reloading: boolean;
}

const HURT_LINES = ['Ow!', 'Hey!', 'That HURT.', 'Okay, ow.'];
const RETREAT_LINES = ['Okay! Okay! I\'m going!', 'Not worth it. NOT worth it.', 'You win. This time.'];

export class CombatSystem {
  aiming = false;
  target: Npc | null = null;
  animal: { position: THREE.Vector3; radius: number; name: string } | null = null;
  readonly weapon = createWeaponState();
  private h: CombatHost;
  private weaponId: WeaponId | null = null;
  private combatants = new Map<string, Combatant>();
  private engaged = new Map<string, Engagement>();
  private poofs: Poof[] = [];
  private hats: Hat[] = [];
  private flash: { mesh: THREE.Mesh; t: number } | null = null;
  private emptyToastAt = -10;
  private missCaptionAt = -10;
  private elapsed = 0;
  private reloadPending = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private rayO = new THREE.Vector3();
  private rayD = new THREE.Vector3();

  constructor(h: CombatHost) {
    this.h = h;
  }

  /** The selected weapon (or null) — the HUD and the dialogue context read it. */
  get weaponDrawn(): boolean {
    return this.weaponId !== null;
  }

  get selectedWeapon(): WeaponId | null {
    return this.weaponId;
  }

  stanceOf(npcId: string): Stance {
    return this.combatants.get(npcId)?.stance ?? 'innocent';
  }

  isEngaged(npcId: string): boolean {
    return this.engaged.has(npcId);
  }

  /** A runner marks its NPC Threatening (thief mid-theft, a grudge making demands). */
  setStance(npcId: string, stance: Stance): void {
    const npc = this.h.npcs.get(npcId);
    if (!npc) return;
    const c = this.combatantFor(npc);
    if (c.stance !== 'hostile') c.stance = stance;
  }

  private combatantFor(npc: Npc): Combatant {
    let c = this.combatants.get(npc.def.id);
    if (!c) {
      c = createCombatant(npc.def);
      this.combatants.set(npc.def.id, c);
    }
    return c;
  }

  // ---- the step ------------------------------------------------------------------------------

  /** Once per simulation step: `aimHeld` is the use button with a weapon selected. */
  step(dt: number, selected: ItemStack | null, aimHeld: boolean, attackPressed: boolean): void {
    const h = this.h;
    this.elapsed += dt;
    tickWeapon(this.weapon, dt);
    const weapon = selected && isWeapon(selected.id) ? selected.id : null;
    if (weapon !== this.weaponId) {
      this.weaponId = weapon;
      if (this.aiming) this.setAiming(false);
    }
    const wantAim = !!weapon && aimHeld && !h.isDialogueOpen() && !h.player.frozen;
    if (wantAim !== this.aiming) this.setAiming(wantAim);
    // forget combatants whose NPC left the world (a finished event) unless we hold them
    for (const [id] of this.combatants) if (!h.npcs.get(id) && !this.engaged.has(id)) this.combatants.delete(id);
    // targeting
    let target: Npc | null = null;
    this.animal = null;
    if (this.aiming && weapon) {
      target = this.pickTarget(weapon);
      this.animal = this.pickAnimal();
    }
    if (this.target && this.target !== target) {
      const prev = this.combatants.get(this.target.def.id);
      if (prev) aimBroken(prev);
    }
    this.target = target;
    if (target && this.aiming) {
      const c = this.combatantFor(target);
      if (aimTick(c, dt)) this.react(target, c);
    }
    if (attackPressed && this.aiming && weapon) this.fire(weapon, target);
    for (const e of [...this.engaged.values()]) this.stepEngagement(e, dt);
  }

  private setAiming(on: boolean): void {
    this.aiming = on;
    this.h.camera.aiming = on;
    const an = this.h.player.character.animator;
    if (on && this.weaponId) an.playUpper(weaponKind(this.weaponId) === 'knife' ? 'knife_idle' : 'pistol_idle', { loop: true, fade: 0.15 });
    else if (!on) {
      an.clearUpper(0.2);
      if (this.target) aimBroken(this.combatantFor(this.target));
      this.target = null;
      this.animal = null;
    }
  }

  private ray(): void {
    const cam = this.h.camera.camera;
    cam.getWorldPosition(this.rayO);
    cam.getWorldDirection(this.rayD);
  }

  private chest(n: Npc, out: THREE.Vector3): THREE.Vector3 {
    return out.set(n.feet.x, n.feet.y + 1.15 * n.def.look.scale, n.feet.z);
  }

  /** The person nearest the crosshair ray within the weapon's reach (a knife shows its target from a few metres). */
  private pickTarget(weapon: WeaponId): Npc | null {
    this.ray();
    const range = weaponKind(weapon) === 'knife' ? 6 : weaponRange(weapon);
    let best: Npc | null = null;
    let bt = Infinity;
    for (const n of this.h.npcs.active.values()) {
      if (n.mode === 'float' || n.mode === 'emerge') continue;
      const p = this.chest(n, this.tmp).sub(this.rayO);
      const t = p.dot(this.rayD);
      if (t < 0.3 || t > range) continue;
      const perp = this.tmp2.copy(this.rayD).multiplyScalar(t).sub(p).length();
      if (perp > C.targetRadius || t >= bt) continue;
      bt = t;
      best = n;
    }
    return best;
  }

  private pickAnimal(): { position: THREE.Vector3; radius: number; name: string } | null {
    const tt = this.h.activeRunner()?.threatTarget();
    if (!tt) return null;
    this.ray();
    const v = this.tmp.copy(tt.position).sub(this.rayO);
    const dist = v.length();
    if (dist > C.animalThreatRange || dist < 0.1) return null;
    return v.divideScalar(dist).dot(this.rayD) > Math.cos(C.animalThreatCone) ? tt : null;
  }

  // ---- the trigger (§12.1) --------------------------------------------------------------------

  private fire(weapon: WeaponId, target: Npc | null): void {
    const h = this.h;
    const kind = weaponKind(weapon);
    // an Innocent in the sights: the trigger pull or the stab stops short and nothing hits (§12.2)
    if (target) {
      const c = this.combatantFor(target);
      if (!stanceAllowsDamage(c.stance)) {
        h.audio?.dryClick();
        h.caption(kind === 'knife' ? '*the blade stops short*' : '*the trigger stops short*');
        if (!c.reacted) this.react(target, c);
        return;
      }
    }
    const ammoId = itemDef(weapon).ammoFor ?? null;
    const rounds = ammoId ? countItem(h.inventory, ammoId) : 0;
    const r = pullTrigger(this.weapon, weapon, rounds);
    if (!r.ok) {
      if (r.reason === 'empty') {
        h.audio?.dryClick();
        if (this.elapsed - this.emptyToastAt > 2) {
          this.emptyToastAt = this.elapsed;
          h.toast('Click. Out of ammo.', 'warn');
        }
      }
      return;
    }
    if (ammoId) removeItem(h.inventory, ammoId, 1);
    h.stats.shotsFired++;
    const an = h.player.character.animator;
    const idle = kind === 'knife' ? 'knife_idle' : 'pistol_idle';
    if (kind === 'knife') {
      h.audio?.knifeSwish();
      an.playUpper('knife_stab', { loop: false, fade: 0.05, onFinished: () => this.aiming && an.playUpper(idle, { loop: true, fade: 0.15 }) });
    } else {
      h.audio?.gunshot(kind);
      this.muzzleFlash();
      const after = (): void => {
        if (!this.aiming) return;
        if (this.reloadPending) {
          this.reloadPending = false;
          h.audio?.reloadClack();
          an.playUpper('pistol_reload', { loop: false, fade: 0.1, onFinished: () => this.aiming && an.playUpper(idle, { loop: true, fade: 0.15 }) });
        } else an.playUpper(idle, { loop: true, fade: 0.15 });
      };
      if (r.reload) this.reloadPending = true;
      an.playUpper('pistol_shoot', { loop: false, fade: 0.03, onFinished: after });
    }
    // scaring an approaching animal: any attack toward it (§11.4)
    if (this.animal) h.activeRunner()?.onThreatened();
    const hit = kind === 'knife' ? this.meleeHit() : this.hitscan(weapon);
    if (hit) this.hitNpc(hit, weapon);
    else if (kind !== 'knife' && target && this.elapsed - this.missCaptionAt > 1.5) {
      this.missCaptionAt = this.elapsed;
      h.caption('*miss*');
    }
  }

  /** The knife: an arc in front of the player. */
  private meleeHit(): Npc | null {
    const p = this.h.player.feet;
    const reach = weaponRange('pocket_knife') + 0.3;
    const fx = Math.sin(this.h.player.yaw);
    const fz = Math.cos(this.h.player.yaw);
    let best: Npc | null = null;
    let bd = Infinity;
    for (const n of this.h.npcs.active.values()) {
      const dx = n.feet.x - p.x;
      const dz = n.feet.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 1e-3) continue;
      if ((dx * fx + dz * fz) / d < 0.5) continue;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** A firearm: the crosshair ray with a little spread (the rifle is tighter). */
  private hitscan(weapon: WeaponId): Npc | null {
    this.ray();
    const spread = weaponSpread(weapon);
    if (spread > 0) {
      const a = (this.h.rng.next() - 0.5) * 2 * spread;
      const b = (this.h.rng.next() - 0.5) * 2 * spread;
      const right = this.tmp.set(-this.rayD.z, 0, this.rayD.x).normalize();
      const up = this.tmp2.crossVectors(right, this.rayD).normalize();
      this.rayD.addScaledVector(right, a).addScaledVector(up, b).normalize();
    }
    const range = weaponRange(weapon);
    let best: Npc | null = null;
    let bt = Infinity;
    for (const n of this.h.npcs.active.values()) {
      if (n.mode === 'float' || n.mode === 'emerge') continue;
      const p = this.chest(n, this.tmp).sub(this.rayO);
      const t = p.dot(this.rayD);
      if (t < 0.3 || t > range) continue;
      const perp = this.tmp2.copy(this.rayD).multiplyScalar(t).sub(p).length();
      if (perp > C.hitRadius || t >= bt) continue;
      bt = t;
      best = n;
    }
    return best;
  }

  private hitNpc(npc: Npc, weapon: WeaponId): void {
    const h = this.h;
    const c = this.combatantFor(npc);
    const r = attack(c, weapon);
    if (r.outcome === 'blocked') {
      if (!c.reacted) this.react(npc, c);
      return;
    }
    h.audio?.thump();
    if (r.outcome === 'poof') {
      this.poof(npc, c);
      return;
    }
    npc.gesture('hit_chest');
    h.bubble(npc, HURT_LINES[Math.floor(h.rng.next() * HURT_LINES.length)]!, 1.5);
    if (r.retreating) this.startRetreat(npc, c);
    else if (c.armed !== 'none' && c.stance !== 'hostile') this.makeHostile(npc, false);
  }

  // ---- reactions (§12.2) -------------------------------------------------------------------------

  private react(npc: Npc, c: Combatant): void {
    const r = reactionFor(c);
    const wasInnocent = c.stance === 'innocent';
    applyReaction(c, r);
    this.h.activeRunner()?.onThreatened(npc.def.id);
    if (r === 'hands_up') this.handsUp(npc, c, false);
    else if (r === 'surrender') this.handsUp(npc, c, true);
    else if (r === 'hostile') this.makeHostile(npc, wasInnocent);
  }

  /** Hands up and the robbery dialogue (a surrendering thief also hands the loot back). */
  private handsUp(npc: Npc, c: Combatant, surrender: boolean): void {
    const h = this.h;
    const def = npc.def;
    npc.engaged = true;
    npc.tag = 'busy';
    npc.stop();
    npc.face(h.player.feet);
    npc.lookAt(h.player.feet);
    npc.act('hands_up', { loop: true, fade: 0.2 });
    const mem = h.memoryFor(def.id);
    h.npcGoods(def);
    let opener = surrender ? "Okay! Okay! I give up! Here — it's all yours!" : h.handsUpLine(def);
    if (surrender) {
      const back = surrenderLoot(mem);
      let n = 0;
      for (const s of back) {
        h.give(s.id, s.count, s.color);
        n += s.count;
      }
      if (n) {
        h.stats.stolenRecovered += n;
        h.toast(`${def.name} hands back: ${back.map((s) => `${itemDef(s.id).name}${s.count > 1 ? ` ×${s.count}` : ''}`).join(', ')}`, 'catch');
      } else opener = "Okay! Okay! Hands up! I hadn't even taken anything yet!";
    }
    this.engaged.set(def.id, { npc, c, mode: 'handsup', timer: 0, retarget: 0 });
    h.bus.emit('hostile', { npcId: def.id });
    void this.robberyDialogue(npc, c, opener, surrender);
  }

  private async robberyDialogue(npc: Npc, c: Combatant, opener: string, surrender: boolean): Promise<void> {
    const h = this.h;
    const def = npc.def;
    const mem = h.memoryFor(def.id);
    const victim: Stance = surrender ? 'threatening' : c.stance;
    const tree = robberyTree(def, mem, opener);
    const end = await h.talk(npc, tree, { name: def.name });
    if (!this.engaged.has(def.id) || !h.npcs.get(def.id)) return;
    let choice: RobberyChoice = { kind: 'leave' };
    if (end.startsWith('rob_one_')) choice = { kind: 'one', index: Number(end.slice('rob_one_'.length)) };
    else if (end === 'rob_all') choice = { kind: 'all' };
    else if (end === 'rob_kidding') choice = { kind: 'kidding' };
    const res = robbery(mem, victim, choice, () => h.rng.next());
    for (const s of res.taken) h.give(s.id, s.count, s.color);
    if (res.taken.length) {
      h.stats.robberies++;
      h.stats.stolenRecovered += res.recovered;
      h.director.wanted += res.wanted;
      const names = res.taken.map((s) => `${itemDef(s.id).name}${s.count > 1 ? ` ×${s.count}` : ''}`).join(', ');
      h.toast(`You took ${names} from ${def.name}.${res.wanted ? ' The park will hear about this.' : ''}`, 'warn');
      h.bus.emit('robbery', { npcId: def.id, items: res.taken, wanted: res.wanted });
    } else if (choice.kind === 'kidding') h.toast(`${def.name} did not find that funny.`);
    else if (choice.kind !== 'leave') h.toast(`${def.name} had nothing to give.`);
    h.unlockChecks();
    void h.save('robbery');
    this.release(npc, 'robbed');
  }

  /** The engagement is over: hand the NPC back to its event (or send them home ourselves). */
  private release(npc: Npc, why: 'robbed'): void {
    const h = this.h;
    const e = this.engaged.get(npc.def.id);
    if (!e) return;
    this.engaged.delete(npc.def.id);
    npc.engaged = false;
    npc.tag = '';
    npc.act(null);
    npc.lookAt(null);
    npc.face(null);
    resetEngagement(e.c);
    if (why === 'robbed') h.activeRunner()?.onRobbed(npc.def.id);
    // nobody sent them anywhere (a console-spawned NPC, a visit that ended): they leave on their own
    if (!npc.isMoving && h.npcs.get(npc.def.id)) {
      npc.tag = 'busy';
      npc.goTo(h.npcs.exitPoint(npc.feet, () => h.rng.next()), N.jogSpeed);
      npc.onArrive = () => void h.npcs.despawn(npc.def.id);
      this.engaged.set(npc.def.id, { npc, c: e.c, mode: 'leaving', timer: 0, retarget: 0 });
      npc.engaged = true;
    }
  }

  /** Draw and fight (§12.2): an armed Innocent aimed at, a refused grudge demand, a threatened ranger. */
  makeHostile(npc: Npc, wasInnocent: boolean): void {
    const h = this.h;
    const def = npc.def;
    const c = this.combatantFor(npc);
    if (c.stance === 'hostile' && this.engaged.get(def.id)?.mode === 'hostile') return;
    c.stance = 'hostile';
    c.reacted = true;
    c.retreating = false;
    c.attackTimer = C.hostileFirstAttackDelay;
    h.director.wanted += wantedForFight(wasInnocent);
    npc.engaged = true;
    npc.tag = 'busy';
    npc.act(null);
    npc.stop();
    npc.face(h.player.feet);
    npc.lookAt(h.player.feet);
    const w = weaponItemFor(def.armed);
    npc.holdWeapon(w ? makeItemMesh(w) : null);
    const idle = def.armed === 'knife' ? 'knife_idle' : def.armed === 'none' ? null : 'pistol_idle';
    if (idle) npc.character.animator.playUpper(idle, { loop: true, fade: 0.2 });
    h.bubble(npc, h.fightBackLine(def), 3);
    h.audio?.clickOn();
    this.engaged.set(def.id, { npc, c, mode: 'hostile', timer: 0, retarget: 0 });
    h.bus.emit('hostile', { npcId: def.id });
  }

  private stepEngagement(e: Engagement, dt: number): void {
    const h = this.h;
    const npc = e.npc;
    if (!h.npcs.get(npc.def.id)) {
      this.engaged.delete(npc.def.id);
      return;
    }
    e.timer += dt;
    const dist = npc.feet.distanceTo(h.player.feet);
    if (e.mode === 'handsup') {
      npc.face(h.player.feet);
      // the dialogue never opened (a menu was up, the player died): don't hold them forever
      if (e.timer > 30 && !h.isDialogueOpen()) this.release(npc, 'robbed');
      return;
    }
    if (e.mode === 'hostile') {
      const melee = e.c.armed === 'none' || e.c.armed === 'knife';
      // blocked for good (water between us, a wall of trunks) or fighting for too long: they give up
      if ((melee && npc.stuckFor > E.stuckSeconds) || e.timer > 90) {
        this.startRetreat(npc, e.c);
        return;
      }
      const action = hostileTick(e.c, dt, dist);
      if (action === 'approach') {
        // a gunman who can't get closer shoots from where they stand
        if (!melee && npc.stuckFor > E.stuckSeconds) {
          npc.stop();
          npc.face(h.player.feet);
          e.c.attackTimer = Math.min(e.c.attackTimer, 0.2);
          return;
        }
        e.retarget -= dt;
        if (e.retarget <= 0) {
          e.retarget = 0.4;
          const reach = melee ? C.meleeReach * 0.6 : C.gunStandoff * 0.8;
          npc.goTo(h.npcs.approachPoint(h.player.feet, npc.feet, reach), N.jogSpeed, { direct: true });
        }
        npc.face(null);
      } else if (action === 'hold') {
        if (npc.isMoving) npc.stop();
        npc.face(h.player.feet);
        npc.lookAt(h.player.feet);
      } else if (action === 'attack') {
        if (npc.isMoving) npc.stop();
        npc.face(h.player.feet);
        this.hostileAttack(npc, e.c, dist);
      } else this.startRetreat(npc, e.c);
      return;
    }
    // leaving: a fled hostile or a robbed victim on their way out
    if (!npc.isMoving || npc.stuckFor > E.stuckSeconds || e.timer > C.leaveSeconds || dist > N.despawnDistance) this.gone(npc, 'fled');
  }

  private hostileAttack(npc: Npc, c: Combatant, dist: number): void {
    const h = this.h;
    const an = npc.character.animator;
    const armed = c.armed;
    const melee = armed === 'none' || armed === 'knife';
    if (armed === 'none') an.playUpper('punch_cross', { loop: false, fade: 0.05, onFinished: () => an.clearUpper(0.2) });
    else if (armed === 'knife') {
      h.audio?.knifeSwish();
      an.playUpper('knife_stab', { loop: false, fade: 0.05, onFinished: () => an.playUpper('knife_idle', { loop: true, fade: 0.15 }) });
    } else {
      h.audio?.gunshot(armed);
      an.playUpper('pistol_shoot', { loop: false, fade: 0.03, onFinished: () => an.playUpper('pistol_idle', { loop: true, fade: 0.15 }) });
    }
    if (melee && dist > C.meleeReach + 0.5) return;
    if (!hostileHits(armed, () => h.rng.next())) {
      if (this.elapsed - this.missCaptionAt > 1.5) {
        this.missCaptionAt = this.elapsed;
        h.caption(melee ? '*a wild swing*' : '*a shot whistles past*');
      }
      return;
    }
    const knock = new THREE.Vector3(h.player.feet.x - npc.feet.x, 0, h.player.feet.z - npc.feet.z).normalize().multiplyScalar(2.2);
    h.damage(hostileDamage(armed), knock);
  }

  private startRetreat(npc: Npc, c: Combatant): void {
    const h = this.h;
    const e = this.engaged.get(npc.def.id);
    c.retreating = true;
    h.memoryFor(npc.def.id).grudge = true;
    npc.character.animator.clearUpper(0.2);
    npc.act(null);
    npc.lookAt(null);
    npc.face(null);
    h.bubble(npc, RETREAT_LINES[Math.floor(h.rng.next() * RETREAT_LINES.length)]!, 3);
    npc.goTo(h.npcs.exitPoint(npc.feet, () => h.rng.next()), N.fleeSpeed);
    npc.onArrive = null;
    if (e) {
      e.mode = 'leaving';
      e.timer = 0;
    } else this.engaged.set(npc.def.id, { npc, c, mode: 'leaving', timer: 0, retarget: 0 });
    npc.engaged = true;
  }

  /** Gone for good: despawn and tell the event. */
  private gone(npc: Npc, reason: 'poofed' | 'fled'): void {
    this.engaged.delete(npc.def.id);
    npc.engaged = false;
    this.h.npcs.despawn(npc.def.id, true);
    this.combatants.delete(npc.def.id);
    this.h.activeRunner()?.onNpcGone(npc.def.id, reason);
  }

  // ---- the red poof (§12.2) ------------------------------------------------------------------------

  poof(npc: Npc, c?: Combatant): void {
    const h = this.h;
    const def = npc.def;
    const mem = h.memoryFor(def.id);
    const comb = c ?? this.combatantFor(npc);
    const hostile = comb.stance === 'hostile';
    const stolen = mem.stolen.reduce((n, s) => n + s.count, 0);
    markPoofed(mem, h.now(), hostile);
    const loot = poofLoot(mem, def);
    h.stats.poofs++;
    if (hostile) h.stats.hostilesPoofed++;
    if (stolen) h.stats.stolenRecovered += stolen;
    h.director.wanted += wantedForPoof(def);
    if (def.archetypes.includes('ranger')) h.director.rangersBoth = true;
    const at = npc.feet.clone();
    this.spawnPoof(new THREE.Vector3(at.x, at.y + 1.0 * def.look.scale, at.z));
    const hatId = def.look.outfit.hat;
    if (hatId) this.dropHat(new THREE.Vector3(at.x, at.y + 1.75 * def.look.scale, at.z), def.look.colors[hatId] ?? '#6b7280');
    h.audio?.poofPop();
    if (loot.length) h.spawnLoot(at, loot);
    h.toast(`${def.name} poofs.${loot.length ? ' They left a bag.' : ''}${stolen ? ' Your things are in it.' : ''}`, 'warn');
    h.bus.emit('poof', { npcId: def.id, hostile });
    this.gone(npc, 'poofed');
    h.unlockChecks();
    void h.save('poof');
  }

  private spawnPoof(at: THREE.Vector3): void {
    const n = 80;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = 1.2 + Math.random() * 2.2;
      pos[i * 3] = at.x + (Math.random() - 0.5) * 0.3;
      pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.8;
      pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.3;
      vel[i * 3] = Math.cos(a) * Math.cos(b) * s;
      vel[i * 3 + 1] = Math.sin(b) * s + 1.0;
      vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe23b3b, size: 0.22, transparent: true, opacity: 1, depthWrite: false }));
    points.frustumCulled = false;
    this.h.world.scene.add(points);
    this.poofs.push({ points, vel, t: 0 });
  }

  private dropHat(at: THREE.Vector3, color: string): void {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8, transparent: true });
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 12), mat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 16), mat);
    brim.position.y = -0.06;
    hat.add(brim);
    hat.castShadow = true;
    hat.position.copy(at);
    this.h.world.scene.add(hat);
    this.hats.push({ mesh: hat, from: at.clone(), ground: this.h.world.groundAt(at.x, at.z) + 0.02, t: 0 });
  }

  private muzzleFlash(): void {
    const hand = this.h.player.character.bone('hand_r');
    if (!hand) return;
    if (!this.flash) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
      this.h.world.scene.add(mesh);
      this.flash = { mesh, t: 0 };
    }
    hand.getWorldPosition(this.flash.mesh.position);
    const dir = this.tmp.set(Math.sin(this.h.player.yaw), 0.1, Math.cos(this.h.player.yaw));
    this.flash.mesh.position.addScaledVector(dir, 0.35);
    this.flash.mesh.visible = true;
    this.flash.t = 0.07;
  }

  render(dt: number): void {
    for (const p of [...this.poofs]) {
      p.t += dt;
      const u = p.t / C.poofSeconds;
      const pos = p.points.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        arr[i * 3] += p.vel[i * 3]! * dt;
        arr[i * 3 + 1] += p.vel[i * 3 + 1]! * dt;
        arr[i * 3 + 2] += p.vel[i * 3 + 2]! * dt;
        p.vel[i * 3 + 1]! -= 3.5 * dt;
        p.vel[i * 3]! *= 1 - 2.5 * dt;
        p.vel[i * 3 + 2]! *= 1 - 2.5 * dt;
      }
      pos.needsUpdate = true;
      const m = p.points.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - u);
      m.size = 0.22 + u * 0.35;
      if (u >= 1) {
        p.points.removeFromParent();
        p.points.geometry.dispose();
        m.dispose();
        this.poofs.splice(this.poofs.indexOf(p), 1);
      }
    }
    for (const hat of [...this.hats]) {
      hat.t += dt;
      const t = hat.t;
      if (t < 0.5) hat.mesh.position.y = hat.from.y + Math.sin((t / 0.5) * Math.PI * 0.5) * 0.7;
      else if (t < 1.3) {
        const u = (t - 0.5) / 0.8;
        hat.mesh.position.y = hat.from.y + 0.7 + (hat.ground - hat.from.y - 0.7) * u * u;
        hat.mesh.rotation.y += dt * 6;
        hat.mesh.rotation.x = Math.min(0.5, hat.mesh.rotation.x + dt * 0.5);
      } else if (t > 5) {
        const m = hat.mesh.material as THREE.MeshStandardMaterial;
        m.opacity = Math.max(0, 1 - (t - 5));
        if (m.opacity <= 0) {
          hat.mesh.removeFromParent();
          hat.mesh.geometry.dispose();
          m.dispose();
          this.hats.splice(this.hats.indexOf(hat), 1);
        }
      }
    }
    if (this.flash && this.flash.mesh.visible) {
      this.flash.t -= dt;
      if (this.flash.t <= 0) this.flash.mesh.visible = false;
    }
  }

  // ---- HUD and lifecycle ---------------------------------------------------------------------------

  hudState(): AimHud {
    const weapon = this.weaponId;
    const ammoId = weapon ? (itemDef(weapon).ammoFor ?? null) : null;
    let aim: AimHud['aim'] = null;
    if (this.aiming && this.target) {
      const c = this.combatantFor(this.target);
      aim = { name: this.target.def.name, kind: c.stance, progress: c.reacted ? 1 : Math.min(1, c.aimSeconds / C.aimReactSeconds) };
    } else if (this.aiming && this.animal) aim = { name: this.animal.name, kind: 'animal', progress: 0 };
    return { aiming: this.aiming, aim, ammo: ammoId ? countItem(this.h.inventory, ammoId) : null, reloading: this.weapon.reloading > 0 };
  }

  /** The HUD target ring's world anchor (the target's chest), if any. */
  targetAnchor(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.aiming) return null;
    if (this.target) return this.chest(this.target, out);
    if (this.animal) return out.copy(this.animal.position);
    return null;
  }

  /** The player died or the session ends: every engagement is dropped (hostiles simply leave). */
  reset(): void {
    for (const e of [...this.engaged.values()]) {
      e.npc.engaged = false;
      e.npc.tag = '';
      e.npc.act(null);
      e.npc.holdWeapon(null);
      if (e.mode !== 'handsup') this.h.npcs.despawn(e.npc.def.id, true);
    }
    this.engaged.clear();
    this.combatants.clear();
    if (this.aiming) this.setAiming(false);
  }

  dispose(): void {
    this.reset();
    for (const p of this.poofs) {
      p.points.removeFromParent();
      p.points.geometry.dispose();
    }
    for (const h of this.hats) h.mesh.removeFromParent();
    this.flash?.mesh.removeFromParent();
    this.poofs = [];
    this.hats = [];
  }

  /** For the debug hooks. */
  debugState(): Record<string, unknown> {
    return {
      aiming: this.aiming, weapon: this.weaponId, target: this.target?.def.id ?? null, animal: this.animal?.name ?? null,
      stances: Object.fromEntries([...this.combatants].map(([id, c]) => [id, { stance: c.stance, hp: c.hp, aim: Number(c.aimSeconds.toFixed(2)), reacted: c.reacted, retreating: c.retreating }])),
      engaged: Object.fromEntries([...this.engaged].map(([id, e]) => [id, e.mode])),
      reloading: this.weapon.reloading,
    };
  }
}

/** The hands-up robbery tree (§12.2): pick one of their things, everything, just kidding, or leave. */
function robberyTree(def: NpcDef, mem: NpcMemory, opener: string): DialogueTree {
  const goods = robbable(mem).slice(0, 3);
  const menu = [
    { text: 'Hand something over.', next: goods.length ? 'pick' : 'rob_nothing' },
    { text: 'Everything!', next: goods.length ? 'rob_all' : 'rob_nothing' },
    { text: 'Just kidding!', next: 'rob_kidding' },
    { text: 'Leave.', next: 'rob_leave' },
  ];
  const nodes: Record<string, DialogueNode> = {
    start: { say: [opener], choices: menu },
    again: { choices: menu },
    pick: { say: ['T-take what you want. Please. Just... take it.'], choices: [...goods.map((g) => ({ text: `${itemDef(g.stack.id).name}${g.stack.count > 1 ? ` ×${g.stack.count}` : ''}`, next: `rob_one_${g.index}` })), { text: 'Never mind.', next: 'again' }] },
    rob_all: { say: ['Everything?! ...Fine. FINE. Take it. Take all of it.'], next: 'end' },
    rob_nothing: { say: ["I don't HAVE anything! Look! Pockets! Nothing!"], next: 'end' },
    rob_kidding: { say: ['...That is not funny. That is the opposite of funny.'], next: 'end' },
    rob_leave: { say: ['Okay. Okay. Going. Gone. Never here.'], next: 'end' },
  };
  for (const g of goods) nodes[`rob_one_${g.index}`] = { say: [`(${def.name} hands over the ${itemDef(g.stack.id).name}.)`], next: 'end' };
  return { id: `robbery_${def.id}`, start: 'start', nodes };
}
