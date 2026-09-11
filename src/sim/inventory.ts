// Inventory and clothing rules (plan §8.1, §8.2). Pure logic: no DOM, no three.js.
import { TUNABLES } from '../data/tunables.ts';
import { itemDef, type ClothingSlot } from '../data/items.ts';

export interface ItemStack {
  id: string;
  count: number;
  /** Rolled colour for clothing (CSS hex). */
  color?: string;
}

export type WornSlot = ClothingSlot;

export interface InventoryState {
  /** Hotbar first (0..hotbarSlots-1), then the backpack. */
  slots: (ItemStack | null)[];
  selected: number;
  worn: Partial<Record<WornSlot, ItemStack>>;
}

export const HOTBAR = TUNABLES.inventory.hotbarSlots;
export const TOTAL_SLOTS = TUNABLES.inventory.hotbarSlots + TUNABLES.inventory.backpackSlots;

export function createInventory(): InventoryState {
  return { slots: Array.from({ length: TOTAL_SLOTS }, () => null), selected: 0, worn: {} };
}

export function stackSize(id: string): number {
  return itemDef(id).stack;
}

function canMerge(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && (a.color ?? null) === (b.color ?? null) && stackSize(a.id) > 1;
}

/** Add items: tops up matching stacks first, then empty slots (hotbar first). Returns what didn't fit. */
export function addItem(inv: InventoryState, item: ItemStack): { added: number; leftover: number } {
  let remaining = item.count;
  const max = stackSize(item.id);
  if (max > 1) {
    for (const s of inv.slots) {
      if (!s || !canMerge(s, item) || s.count >= max) continue;
      const take = Math.min(max - s.count, remaining);
      s.count += take;
      remaining -= take;
      if (remaining === 0) break;
    }
  }
  for (let i = 0; i < inv.slots.length && remaining > 0; i++) {
    if (inv.slots[i]) continue;
    const take = Math.min(max, remaining);
    inv.slots[i] = { id: item.id, count: take, ...(item.color ? { color: item.color } : {}) };
    remaining -= take;
  }
  return { added: item.count - remaining, leftover: remaining };
}

export function countItem(inv: InventoryState, id: string): number {
  let n = 0;
  for (const s of inv.slots) if (s && s.id === id) n += s.count;
  return n;
}

export function hasItem(inv: InventoryState, id: string): boolean {
  return countItem(inv, id) > 0;
}

/** Remove up to `count` of an item across stacks. Returns how many were removed. */
export function removeItem(inv: InventoryState, id: string, count: number): number {
  let remaining = count;
  for (let i = inv.slots.length - 1; i >= 0 && remaining > 0; i--) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.count, remaining);
    s.count -= take;
    remaining -= take;
    if (s.count === 0) inv.slots[i] = null;
  }
  return count - remaining;
}

/** Move/swap/merge between two slots (drag and drop). */
export function moveSlot(inv: InventoryState, from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= inv.slots.length || to >= inv.slots.length) return;
  const a = inv.slots[from];
  const b = inv.slots[to];
  if (!a) return;
  if (b && canMerge(a, b)) {
    const max = stackSize(a.id);
    const take = Math.min(max - b.count, a.count);
    b.count += take;
    a.count -= take;
    if (a.count === 0) inv.slots[from] = null;
    return;
  }
  inv.slots[to] = a;
  inv.slots[from] = b ?? null;
}

/** Split half a stack into an empty slot (shift-click). */
export function splitSlot(inv: InventoryState, from: number, to: number): boolean {
  const a = inv.slots[from];
  if (!a || inv.slots[to] || a.count < 2 || from === to) return false;
  const half = Math.floor(a.count / 2);
  a.count -= half;
  inv.slots[to] = { ...a, count: half };
  return true;
}

/** Take a whole stack out of a slot (drop). The starter rod is bound and stays. */
export function takeSlot(inv: InventoryState, index: number): ItemStack | null {
  const s = inv.slots[index];
  if (!s) return null;
  if (itemDef(s.id).bound) return null;
  inv.slots[index] = null;
  return s;
}

export function selectedStack(inv: InventoryState): ItemStack | null {
  return inv.slots[inv.selected] ?? null;
}

export function selectSlot(inv: InventoryState, index: number): void {
  inv.selected = ((index % HOTBAR) + HOTBAR) % HOTBAR;
}

/** Which worn slots an item occupies (a full-body item occupies top + bottom, §8.2). */
export function occupiedSlots(slot: ClothingSlot): WornSlot[] {
  return slot === 'full' ? ['full', 'top', 'bottom'] : slot === 'top' || slot === 'bottom' ? [slot, 'full'] : [slot];
}

/**
 * Equip the clothing in a slot. Displaced garments go back into the inventory; fails (no change)
 * if they wouldn't fit. Returns the list of displaced item ids on success.
 */
export function equipFromSlot(inv: InventoryState, index: number): { ok: boolean; displaced: ItemStack[] } {
  const s = inv.slots[index];
  if (!s) return { ok: false, displaced: [] };
  const def = itemDef(s.id);
  if (def.kind !== 'clothing' || !def.slot) return { ok: false, displaced: [] };
  const displaced: ItemStack[] = [];
  for (const w of occupiedSlots(def.slot)) {
    const cur = inv.worn[w];
    if (cur) displaced.push(cur);
  }
  // the item's own slot frees up first, so a swap in place always fits
  inv.slots[index] = null;
  const free = inv.slots.filter((x) => !x).length;
  if (displaced.length > free) {
    inv.slots[index] = s;
    return { ok: false, displaced: [] };
  }
  for (const w of occupiedSlots(def.slot)) delete inv.worn[w];
  inv.worn[def.slot] = { id: s.id, count: 1, ...(s.color ? { color: s.color } : {}) };
  for (const d of displaced) addItem(inv, d);
  return { ok: true, displaced };
}

/** Unequip into the inventory. Fails if there's no room. */
export function unequip(inv: InventoryState, slot: WornSlot): boolean {
  const cur = inv.worn[slot];
  if (!cur) return false;
  if (!inv.slots.some((x) => !x)) return false;
  delete inv.worn[slot];
  addItem(inv, cur);
  return true;
}

/** Strip every garment (thief, §11.4). Returns what was taken. Underwear isn't an item, so it stays. */
export function stripAll(inv: InventoryState): ItemStack[] {
  const taken = Object.values(inv.worn).filter((x): x is ItemStack => !!x);
  inv.worn = {};
  return taken;
}

/** Garment ids + colours for the character renderer. */
export function outfitOf(inv: InventoryState): { garments: Partial<Record<WornSlot, string>>; colors: Record<string, string> } {
  const garments: Partial<Record<WornSlot, string>> = {};
  const colors: Record<string, string> = {};
  for (const [slot, stack] of Object.entries(inv.worn) as [WornSlot, ItemStack | undefined][]) {
    if (!stack) continue;
    const def = itemDef(stack.id);
    if (!def.garment) continue;
    garments[slot] = def.garment;
    if (stack.color) colors[def.garment] = stack.color;
  }
  return { garments, colors };
}

/** Roll a colour for a fished/traded garment from its palette (§8.2). */
export function rollGarmentColor(id: string, rng: () => number): string | undefined {
  const p = itemDef(id).palette;
  if (!p || p.length === 0) return undefined;
  return p[Math.min(p.length - 1, Math.floor(rng() * p.length))];
}

/** Remove all fish (death, §12.4). */
export function removeAllFish(inv: InventoryState): number {
  let n = 0;
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s && itemDef(s.id).kind === 'fish') {
      n += s.count;
      inv.slots[i] = null;
    }
  }
  return n;
}
