// Per-NPC memory (plan §10.2): counters, relationship, grudge, inventory, last seen, quest flags.
// Saved per roster id. Pure: no DOM, no three.js.
import { TUNABLES } from '../data/tunables.ts';
import type { ItemStack } from './inventory.ts';

export interface NpcMemory {
  /** Times the player talked to them. */
  met: number;
  /** Times the player robbed them (M3). */
  robbed: number;
  poofed: number;
  /** −100..100. */
  relationship: number;
  grudge: boolean;
  /** Their current inventory, including anything stolen from the player. */
  inventory: ItemStack[];
  /** Items stolen from the player they still carry (subset of inventory, by count). */
  stolen: ItemStack[];
  /** In-game day last seen (0 = never). */
  lastSeenDay: number;
  /** In-game day (with fraction) they were poofed; 0 = not poofed. */
  poofedAt: number;
  flags: Record<string, boolean>;
}

export function createMemory(): NpcMemory {
  return { met: 0, robbed: 0, poofed: 0, relationship: 0, grudge: false, inventory: [], stolen: [], lastSeenDay: 0, poofedAt: 0, flags: {} };
}

export function clampRelationship(v: number): number {
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export function adjustRelationship(m: NpcMemory, delta: number): void {
  m.relationship = clampRelationship(m.relationship + delta);
}

/** They were seen (spawned near the player) on `day`. */
export function markSeen(m: NpcMemory, day: number): void {
  m.lastSeenDay = day;
}

/** The player talked to them. Returns true on the first meeting. */
export function markMet(m: NpcMemory, day: number): boolean {
  m.met += 1;
  m.lastSeenDay = day;
  return m.met === 1;
}

/** Poofed at day+fraction `now`; back in the pool after `poofReturnDays`, with a grudge if hostile. */
export function markPoofed(m: NpcMemory, now: number, hostile: boolean): void {
  m.poofed += 1;
  m.poofedAt = now;
  if (hostile) m.grudge = true;
  m.flags.poofGreeted = false;
}

export function isOutOfPool(m: NpcMemory, now: number): boolean {
  return m.poofedAt > 0 && now < m.poofedAt + TUNABLES.events.poofReturnDays;
}

export function hasStolenLoot(m: NpcMemory): boolean {
  return m.stolen.some((s) => s.count > 0);
}

/** Add stolen items to both the inventory and the stolen ledger. */
export function addStolen(m: NpcMemory, items: readonly ItemStack[]): void {
  for (const it of items) {
    m.inventory.push({ ...it });
    m.stolen.push({ ...it });
  }
}

/** Hand every stolen item back (returns them and clears the ledger). */
export function takeStolenBack(m: NpcMemory): ItemStack[] {
  const out = m.stolen.map((s) => ({ ...s }));
  for (const s of m.stolen) {
    const i = m.inventory.findIndex((x) => x.id === s.id && (x.color ?? null) === (s.color ?? null) && x.count === s.count);
    if (i >= 0) m.inventory.splice(i, 1);
  }
  m.stolen = [];
  return out;
}

/** Eligible for a grudge-return event: a grudge, and last seen at least `days` in-game days ago. */
export function grudgeReady(m: NpcMemory, day: number, days = TUNABLES.events.grudgeReturnDays): boolean {
  return m.grudge && day - m.lastSeenDay >= days;
}
