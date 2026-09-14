// Confrontation rules (plan §12.1–§12.3): every human NPC is Innocent, Threatening or Hostile;
// weapons never damage Innocents or animals; aiming at someone for 1.5 s makes them react (hands
// up, a surrender, or a drawn weapon); NPC hit points, hostile attacks with bad aim, the robbery
// outcomes and the wanted value. Pure: no DOM, no three.js. src/gameplay/combat.ts presents it.
import { TUNABLES } from '../data/tunables.ts';
import { itemDef } from '../data/items.ts';
import type { Armed, NpcDef } from '../data/npcs.ts';
import { removeAllFish, type InventoryState, type ItemStack } from './inventory.ts';
import { adjustRelationship, takeStolenBack, type NpcMemory } from './npcMemory.ts';

const C = TUNABLES.confrontation;

export type Stance = 'innocent' | 'threatening' | 'hostile';
export type WeaponId = 'pocket_knife' | 'handgun' | 'rifle';
export type WeaponKind = 'knife' | 'handgun' | 'rifle';
export type Reaction = 'hands_up' | 'surrender' | 'hostile' | 'none';

export function isWeapon(id: string): id is WeaponId {
  return id === 'pocket_knife' || id === 'handgun' || id === 'rifle';
}

export function weaponKind(id: WeaponId): WeaponKind {
  return id === 'pocket_knife' ? 'knife' : id;
}

/** The weapon item an armed NPC carries. */
export function weaponItemFor(armed: Armed): WeaponId | null {
  return armed === 'knife' ? 'pocket_knife' : armed === 'handgun' ? 'handgun' : armed === 'rifle' ? 'rifle' : null;
}

export interface Combatant {
  npcId: string;
  armed: Armed;
  stance: Stance;
  /** Hit points (knife and handgun hits take one, a rifle hit two). */
  hp: number;
  /** Seconds the player has held their aim on this NPC. */
  aimSeconds: number;
  /** The aim reaction has fired for this engagement. */
  reacted: boolean;
  /** Down to the retreat threshold: running away. */
  retreating: boolean;
  /** Seconds until a hostile's next attack. */
  attackTimer: number;
}

export function createCombatant(def: Pick<NpcDef, 'id' | 'armed'>, stance: Stance = 'innocent'): Combatant {
  return { npcId: def.id, armed: def.armed, stance, hp: C.npcHitPoints, aimSeconds: 0, reacted: false, retreating: false, attackTimer: C.hostileFirstAttackDelay };
}

export function weaponDamage(weapon: WeaponId): number {
  return C.playerHits[weaponKind(weapon)];
}

/** Weapons work against Threatening and Hostile NPCs only (§12.2). */
export function stanceAllowsDamage(s: Stance): boolean {
  return s !== 'innocent';
}

/** Animals are never damaged (§1 #9); a person only when Threatening or Hostile. */
export function canDamage(target: 'npc' | 'bear' | 'gator', c?: Combatant): boolean {
  if (target !== 'npc') return false;
  return !!c && stanceAllowsDamage(c.stance);
}

export type AttackResult = { outcome: 'blocked' } | { outcome: 'hit'; hp: number; retreating: boolean } | { outcome: 'poof' };

/** A trigger pull or stab that reached this NPC. Against an Innocent nothing hits (§12.2). */
export function attack(c: Combatant, weapon: WeaponId): AttackResult {
  if (!stanceAllowsDamage(c.stance)) return { outcome: 'blocked' };
  c.hp -= weaponDamage(weapon);
  if (c.hp <= 0) {
    c.hp = 0;
    return { outcome: 'poof' };
  }
  if (c.hp <= C.retreatAtHp) c.retreating = true;
  return { outcome: 'hit', hp: c.hp, retreating: c.retreating };
}

/** Advance the aim timer; true on the tick the reaction threshold is crossed (once per engagement). */
export function aimTick(c: Combatant, dt: number): boolean {
  if (c.reacted) return false;
  c.aimSeconds += dt;
  if (c.aimSeconds >= C.aimReactSeconds) {
    c.reacted = true;
    return true;
  }
  return false;
}

/** The aim was broken before the reaction: the timer starts over. */
export function aimBroken(c: Combatant): void {
  if (!c.reacted) c.aimSeconds = 0;
}

/** What an aimed-at (or attacked) NPC does: unarmed Innocents put their hands up, unarmed thieves
 *  surrender and hand the loot back, anyone armed draws and fights (§12.2). */
export function reactionFor(c: Combatant): Reaction {
  if (c.stance === 'hostile') return 'none';
  if (c.armed === 'none') return c.stance === 'innocent' ? 'hands_up' : 'surrender';
  return 'hostile';
}

export function applyReaction(c: Combatant, r: Reaction): void {
  c.reacted = true;
  if (r === 'hostile') c.stance = 'hostile';
}

/** Released from an engagement (robbery over, threat gone): a later aim gets its own reaction. */
export function resetEngagement(c: Combatant): void {
  c.aimSeconds = 0;
  c.reacted = false;
}

// ---- the player's weapon (§12.1) ---------------------------------------------------------------

export interface WeaponState {
  shotsSinceReload: number;
  /** Seconds of reload animation left (0 = ready). */
  reloading: number;
}

export function createWeaponState(): WeaponState {
  return { shotsSinceReload: 0, reloading: 0 };
}

export type FireResult = { ok: true; reload: boolean } | { ok: false; reason: 'empty' | 'reloading' };

/** Pull the trigger. Firearms need a round; every N shots a short reload follows. The knife always swings. */
export function pullTrigger(w: WeaponState, weapon: WeaponId, rounds: number): FireResult {
  if (w.reloading > 0) return { ok: false, reason: 'reloading' };
  const kind = weaponKind(weapon);
  if (kind === 'knife') return { ok: true, reload: false };
  if (rounds <= 0) return { ok: false, reason: 'empty' };
  w.shotsSinceReload += 1;
  if (w.shotsSinceReload >= C.reloadEvery[kind]) {
    w.shotsSinceReload = 0;
    w.reloading = C.reloadSeconds;
    return { ok: true, reload: true };
  }
  return { ok: true, reload: false };
}

export function tickWeapon(w: WeaponState, dt: number): void {
  w.reloading = Math.max(0, w.reloading - dt);
}

export function ammoFor(weapon: WeaponId): string | null {
  return itemDef(weapon).ammoFor ?? null;
}

export function weaponRange(weapon: WeaponId): number {
  return itemDef(weapon).range ?? 1.8;
}

export function weaponSpread(weapon: WeaponId): number {
  const kind = weaponKind(weapon);
  return kind === 'knife' ? 0 : C.spread[kind];
}

/** The most valuable weapon in a bag (what a ranger confiscates, §12.3). */
export function bestWeapon(slots: readonly (ItemStack | null)[]): { index: number; stack: ItemStack } | null {
  let best: { index: number; stack: ItemStack } | null = null;
  slots.forEach((s, index) => {
    if (s && isWeapon(s.id) && (!best || itemDef(s.id).value > itemDef(best.stack.id).value)) best = { index, stack: s };
  });
  return best;
}

/** The most valuable unbound item that isn't a weapon (the ranger's fine; null when there is none). */
export function mostValuable(slots: readonly (ItemStack | null)[], opts: { excludeWeapons?: boolean } = {}): { index: number; stack: ItemStack } | null {
  let best: { index: number; stack: ItemStack } | null = null;
  slots.forEach((s, index) => {
    if (!s) return;
    const def = itemDef(s.id);
    if (def.bound || (opts.excludeWeapons && isWeapon(s.id))) return;
    if (!best || def.value > itemDef(best.stack.id).value) best = { index, stack: s };
  });
  return best;
}

// ---- hostile AI decisions (§12.2 "Hostile NPC attacks") ---------------------------------------

export type HostileAction = 'approach' | 'hold' | 'attack' | 'retreat';

/** What a hostile does this tick given the distance to the player. */
export function hostileTick(c: Combatant, dt: number, distance: number): HostileAction {
  if (c.retreating) return 'retreat';
  c.attackTimer -= dt;
  const melee = c.armed === 'none' || c.armed === 'knife';
  const reach = melee ? C.meleeReach : C.gunStandoff;
  if (distance > reach) return 'approach';
  if (c.attackTimer <= 0) {
    c.attackTimer = melee ? C.meleeSeconds : C.shotSeconds;
    return 'attack';
  }
  return 'hold';
}

/** Hearts a hostile attack costs: punch, knife, handgun, rifle. */
export function hostileDamage(armed: Armed): number {
  return armed === 'none' ? C.hostileHits.punch : C.hostileHits[armed];
}

/** Their aim is deliberately bad: a firearm lands `hostileAccuracy` of the time; melee within reach always does. */
export function hostileHits(armed: Armed, rng: () => number): boolean {
  if (armed === 'none' || armed === 'knife') return true;
  return rng() < C.hostileAccuracy;
}

// ---- wanted (§12.3) ----------------------------------------------------------------------------

/** Robbing an Innocent raises wanted; robbing a thief who surrendered doesn't. */
export function wantedForRobbery(victim: Stance): number {
  return victim === 'innocent' ? C.wantedRobbery : 0;
}

/** Threatening an armed Innocent into a fight. */
export function wantedForFight(wasInnocent: boolean): number {
  return wasInnocent ? C.wantedFight : 0;
}

/** Poofing Hostile or Threatening NPCs never raises wanted; a ranger does. */
export function wantedForPoof(def: Pick<NpcDef, 'archetypes'>): number {
  return def.archetypes.includes('ranger') ? C.wantedRangerPoof : 0;
}

// ---- robbery (§12.2) ---------------------------------------------------------------------------

export type RobberyChoice = { kind: 'one'; index: number } | { kind: 'all' } | { kind: 'kidding' } | { kind: 'leave' };

export interface RobberyResult {
  taken: ItemStack[];
  relationship: number;
  wanted: number;
  /** Items taken that the victim had stolen from the player (back where they belong). */
  recovered: number;
}

/** The victim's stacks a robber may pick from, most valuable first. */
export function robbable(mem: NpcMemory): { index: number; stack: ItemStack }[] {
  return mem.inventory
    .map((stack, index) => ({ index, stack }))
    .filter((e) => e.stack.count > 0 && !itemDef(e.stack.id).bound)
    .sort((a, b) => itemDef(b.stack.id).value * b.stack.count - itemDef(a.stack.id).value * a.stack.count);
}

function takeFromVictim(mem: NpcMemory, index: number): { stack: ItemStack; recovered: number } {
  const stack = mem.inventory[index]!;
  mem.inventory.splice(index, 1);
  let recovered = 0;
  const i = mem.stolen.findIndex((s) => s.id === stack.id && (s.color ?? null) === (stack.color ?? null));
  if (i >= 0) {
    const s = mem.stolen[i]!;
    recovered = Math.min(s.count, stack.count);
    s.count -= recovered;
    if (s.count <= 0) mem.stolen.splice(i, 1);
  }
  return { stack: { ...stack }, recovered };
}

/**
 * Resolve a robbery dialogue choice against the victim's memory (mutates it): what changes hands,
 * the relationship hit, the wanted added. Any robbery that takes something gives them a grudge.
 */
export function robbery(mem: NpcMemory, victim: Stance, choice: RobberyChoice, rng: () => number): RobberyResult {
  const out: RobberyResult = { taken: [], relationship: 0, wanted: 0, recovered: 0 };
  if (choice.kind === 'one') {
    if (mem.inventory[choice.index]) {
      const t = takeFromVictim(mem, choice.index);
      out.taken.push(t.stack);
      out.recovered += t.recovered;
    }
    out.relationship = C.robOneRelationship;
  } else if (choice.kind === 'all') {
    const n = Math.min(C.robAllMaxItems, mem.inventory.length);
    for (let k = 0; k < n; k++) {
      const list = robbable(mem);
      if (!list.length) break;
      const pick = list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
      const t = takeFromVictim(mem, pick.index);
      out.taken.push(t.stack);
      out.recovered += t.recovered;
    }
    out.relationship = C.robAllRelationship;
  } else if (choice.kind === 'kidding') {
    out.relationship = C.kiddingRelationship;
  }
  adjustRelationship(mem, out.relationship);
  if (out.taken.length) {
    mem.robbed += 1;
    mem.grudge = true;
    mem.flags.robbedGreeted = false;
    out.wanted = wantedForRobbery(victim);
  }
  return out;
}

// ---- surrender and poof loot -------------------------------------------------------------------

/** A surrendering thief hands back everything they stole (§11.4 "Recovery"). */
export function surrenderLoot(mem: NpcMemory): ItemStack[] {
  return takeStolenBack(mem);
}

/** What a poofed NPC leaves in the loot bag: their whole inventory, stolen items included (§12.2). */
export function poofLoot(mem: NpcMemory, def: Pick<NpcDef, 'loot' | 'trading'>): ItemStack[] {
  if (!mem.flags.stockInit) {
    mem.flags.stockInit = true;
    for (const s of def.trading?.stock ?? []) mem.inventory.push({ ...s });
    for (const s of def.loot) mem.inventory.push({ ...s });
  }
  const out = mem.inventory.filter((s) => s.count > 0).map((s) => ({ ...s }));
  mem.inventory = [];
  mem.stolen = [];
  return out;
}

// ---- death (§12.4) -----------------------------------------------------------------------------

/** At zero hearts only the carried fish are lost; everything else (and every achievement) is kept. */
export function deathLosses(inv: InventoryState): number {
  return removeAllFish(inv);
}
