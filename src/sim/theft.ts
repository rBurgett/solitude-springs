// Thief rules (plan §11.4 "Thief" 3–5): what they take, the strip, the pity barrel. Pure over the
// inventory state; the game presents the beats.
import { TUNABLES } from '../data/tunables.ts';
import { itemDef } from '../data/items.ts';
import type { NpcDef } from '../data/npcs.ts';
import { stripAll, type InventoryState, type ItemStack } from './inventory.ts';
import { matchesAny } from './trading.ts';

export interface TheftPlan {
  /** Items taken from the backpack/hotbar. */
  taken: ItemStack[];
  /** Worn clothing taken (nothing else wanted). */
  stripped: ItemStack[];
  /** The player was already in underwear: the thief leaves the barrel instead. */
  barrel: boolean;
  /** A specialist (shoes only) found nothing and leaves empty-handed. */
  nothing: boolean;
}

/** In underwear = nothing worn on top, bottom or full-body (hat and shoes don't count). */
export function inUnderwear(inv: InventoryState): boolean {
  return !inv.worn.top && !inv.worn.bottom && !inv.worn.full;
}

export function wearsBarrel(inv: InventoryState): boolean {
  return inv.worn.full?.id === 'barrel';
}

/** Weight of a stack for a thief: value × wants, `prefers` ×3; bound items never. */
function weightFor(s: ItemStack, npc: NpcDef): number {
  const def = itemDef(s.id);
  if (def.bound) return 0;
  const only = npc.theft?.only;
  if (only && !matchesAny(s.id, only)) return 0;
  let w = Math.max(0.5, def.value) * s.count;
  if (npc.theft?.prefers && matchesAny(s.id, npc.theft.prefers)) w *= 3;
  if (npc.trading && matchesAny(s.id, npc.trading.wants)) w *= 2;
  return w;
}

/** Plan and apply a theft. Mutates the inventory. */
export function executeTheft(inv: InventoryState, npc: NpcDef, rng: () => number): TheftPlan {
  const plan: TheftPlan = { taken: [], stripped: [], barrel: false, nothing: false };
  const E = TUNABLES.events;
  const count = E.thiefItemsMin + Math.floor(rng() * (E.thiefItemsMax - E.thiefItemsMin + 1));
  for (let n = 0; n < count; n++) {
    const entries = inv.slots.map((s, i) => ({ s, i, w: s ? weightFor(s, npc) : 0 })).filter((e) => e.w > 0);
    if (entries.length === 0) break;
    let total = 0;
    for (const e of entries) total += e.w;
    let r = rng() * total;
    let pick = entries[entries.length - 1]!;
    for (const e of entries) {
      if (r < e.w) {
        pick = e;
        break;
      }
      r -= e.w;
    }
    const s = pick.s!;
    // take the whole stack for singles, a handful for stacks
    const take = s.count === 1 ? 1 : Math.max(1, Math.min(s.count, Math.ceil(s.count * (0.4 + rng() * 0.6))));
    plan.taken.push({ id: s.id, count: take, ...(s.color ? { color: s.color } : {}) });
    s.count -= take;
    if (s.count <= 0) inv.slots[pick.i] = null;
  }
  if (plan.taken.length > 0) return plan;
  // a specialist who only takes one thing checks the worn slots for it, otherwise leaves
  if (npc.theft?.only) {
    for (const [slot, w] of Object.entries(inv.worn) as [keyof InventoryState['worn'], ItemStack | undefined][]) {
      if (w && matchesAny(w.id, npc.theft.only)) {
        plan.stripped.push(w);
        delete inv.worn[slot];
      }
    }
    if (plan.stripped.length === 0) plan.nothing = true;
    return plan;
  }
  if (inUnderwear(inv)) {
    plan.barrel = true;
    return plan;
  }
  plan.stripped = stripAll(inv);
  return plan;
}
