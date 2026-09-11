// Catch rolls (plan §8.4, §9.4): category shares by zone state, then species by water/time/rarity.
import { TUNABLES } from '../data/tunables.ts';
import { FISH, type DayPhase, type FishDef, type Rarity, type WaterKind } from '../data/fish.ts';
import { FISHABLE_CLOTHING, FISHABLE_JUNK } from '../data/items.ts';
import { rollGarmentColor } from './inventory.ts';

export interface CatchContext {
  water: WaterKind;
  phase: DayPhase;
  /** Zone population 0..1 and trash 0..1. */
  population: number;
  trash: number;
  ufoRecent: boolean;
  /** Serenity has been 100% for the calm window (Old Gus, §9.4). */
  legendReady: boolean;
  luckyLure: boolean;
  rng: () => number;
}

export type CatchResult =
  | { kind: 'fish'; fishId: string; weightLb: number; rarity: Rarity }
  | { kind: 'item'; itemId: string; color?: string; rarity: 'common' };

export type CatchCategory = 'fish' | 'junk' | 'clothing' | 'weapon';

/** Category shares for a zone: low population shifts fish → junk; a trashed zone yields junk only. */
export function categoryShares(population: number, trash: number): Record<CatchCategory, number> {
  const base = TUNABLES.catch.shares;
  if (trash >= 0.5) return { fish: 0, junk: 1, clothing: 0, weapon: 0 };
  const shift = TUNABLES.catch.lowPopulationShift;
  const factor = population >= shift ? 1 : Math.max(0, population / shift);
  const fish = base.fish * factor;
  return { fish, junk: base.junk + (base.fish - fish), clothing: base.clothing, weapon: base.weapon };
}

function pickWeighted<T>(entries: readonly [T, number][], r: number): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x <= 0) return v;
  }
  return entries[entries.length - 1]![0];
}

export function rollCategory(ctx: CatchContext): CatchCategory {
  const s = categoryShares(ctx.population, ctx.trash);
  return pickWeighted<CatchCategory>([['fish', s.fish], ['junk', s.junk], ['clothing', s.clothing], ['weapon', s.weapon]], ctx.rng());
}

/** Species eligible in this water/phase given the special conditions. */
export function eligibleFish(ctx: Pick<CatchContext, 'water' | 'phase' | 'ufoRecent' | 'legendReady'>): FishDef[] {
  return FISH.filter((f) => f.where.includes(ctx.water) && f.when.includes(ctx.phase) && (!f.needsUfo || ctx.ufoRecent) && (!f.legendary || ctx.legendReady));
}

const RARE: readonly Rarity[] = ['rare', 'veryRare', 'legendary'];

export function speciesWeight(f: FishDef, ctx: Pick<CatchContext, 'phase' | 'luckyLure'>): number {
  let w = TUNABLES.catch.rarityWeights[f.rarity];
  if (f.bestWhen?.includes(ctx.phase)) w *= 2;
  if (ctx.luckyLure && RARE.includes(f.rarity)) w *= TUNABLES.catch.luckyLureRareMultiplier;
  return w;
}

/** Weight in pounds, skewed toward the low end. */
export function rollWeight(f: FishDef, r: number): number {
  const lb = f.minLb + (f.maxLb - f.minLb) * Math.pow(r, 2.2);
  return Math.round(lb * 10) / 10;
}

export function rollFish(ctx: CatchContext): CatchResult | null {
  const pool = eligibleFish(ctx);
  if (pool.length === 0) return null;
  const f = pickWeighted(pool.map((x) => [x, speciesWeight(x, ctx)] as [FishDef, number]), ctx.rng());
  return { kind: 'fish', fishId: f.id, weightLb: rollWeight(f, ctx.rng()), rarity: f.rarity };
}

export function rollJunk(ctx: CatchContext): CatchResult {
  // cans dominate trashed water
  const entries = FISHABLE_JUNK.map((id) => [id, id === 'beer_can' ? 1 + ctx.trash * 12 : 1] as [string, number]);
  return { kind: 'item', itemId: pickWeighted(entries, ctx.rng()), rarity: 'common' };
}

export function rollClothing(ctx: CatchContext): CatchResult {
  const id = FISHABLE_CLOTHING[Math.min(FISHABLE_CLOTHING.length - 1, Math.floor(ctx.rng() * FISHABLE_CLOTHING.length))]!;
  const color = rollGarmentColor(id, ctx.rng);
  return { kind: 'item', itemId: id, ...(color ? { color } : {}), rarity: 'common' };
}

export function rollWeapon(ctx: CatchContext): CatchResult {
  const w = TUNABLES.catch.weaponShares;
  const id = pickWeighted<string>([['pocket_knife', w.knife], ['pistol_ammo', w.pistolAmmo], ['rifle_ammo', w.rifleAmmo], ['handgun', w.handgun], ['rifle', w.rifle]], ctx.rng());
  return { kind: 'item', itemId: id, rarity: 'common' };
}

/** One complete catch roll. Returns null only when nothing at all is available (no eligible fish and category fish). */
export function rollCatch(ctx: CatchContext): CatchResult {
  const cat = rollCategory(ctx);
  if (cat === 'fish') return rollFish(ctx) ?? rollJunk(ctx);
  if (cat === 'clothing') return rollClothing(ctx);
  if (cat === 'weapon') return rollWeapon(ctx);
  return rollJunk(ctx);
}

/** Bite window for a catch (§9.2). */
export function biteWindowFor(c: CatchResult): number {
  return TUNABLES.bite.windowSeconds[c.rarity];
}
