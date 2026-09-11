// Abduction rules (plan §11.4 "UFO"): the replacement outfit roll (odd pieces weighted), the
// missing time, and the glowing-perch window. Pure.
import { TUNABLES } from '../data/tunables.ts';
import { ITEMS, ODD_CLOTHING, itemDef } from '../data/items.ts';
import { rollGarmentColor, type InventoryState, type ItemStack } from './inventory.ts';

const E = TUNABLES.events;

function pickWeighted(ids: readonly string[], rng: () => number): string {
  let total = 0;
  const ws = ids.map((id) => {
    const w = ODD_CLOTHING.includes(id) ? E.ufoOddPieceWeight : 1;
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    if (r < ws[i]!) return ids[i]!;
    r -= ws[i]!;
  }
  return ids[ids.length - 1]!;
}

/** A random outfit: either a full-body piece or top + bottom, plus shoes and (sometimes) a hat. */
export function rollAbductionOutfit(rng: () => number): ItemStack[] {
  const clothing = ITEMS.filter((i) => i.kind === 'clothing' && i.slot && !i.bound);
  const bySlot = (slot: string): string[] => clothing.filter((i) => i.slot === slot).map((i) => i.id);
  const out: ItemStack[] = [];
  const add = (id: string): void => {
    const color = rollGarmentColor(id, rng);
    out.push({ id, count: 1, ...(color ? { color } : {}) });
  };
  if (rng() < 0.65) add(pickWeighted(bySlot('full'), rng));
  else {
    add(pickWeighted(bySlot('top'), rng));
    add(pickWeighted(bySlot('bottom'), rng));
  }
  add(pickWeighted(bySlot('shoes'), rng));
  if (rng() < 0.6) add(pickWeighted(bySlot('hat'), rng));
  return out;
}

/** Replace everything worn: the aliens keep the originals. Returns what they kept. */
export function applyAbductionOutfit(inv: InventoryState, outfit: readonly ItemStack[]): ItemStack[] {
  const kept = Object.values(inv.worn).filter((x): x is ItemStack => !!x);
  inv.worn = {};
  for (const s of outfit) {
    const def = itemDef(s.id);
    if (!def.slot) continue;
    inv.worn[def.slot] = { ...s, count: 1 };
  }
  return kept;
}

/** 1–3 in-game hours of missing time, in real seconds of clock. */
export function rollMissingHours(rng: () => number): number {
  return E.ufoMissingHoursMin + rng() * (E.ufoMissingHoursMax - E.ufoMissingHoursMin);
}
