// Trading rules (plan §10.3): personal valuation, the deal rule, and a mood for the live quips.
import { TUNABLES } from '../data/tunables.ts';
import { itemDef } from '../data/items.ts';
import type { NpcTrading } from '../data/npcs.ts';
import type { ItemStack } from './inventory.ts';

/** Does an item match an entry of a wants/dislikes/refuses list (item id or `kind:<kind>`)? */
export function matchesTag(itemId: string, tag: string): boolean {
  if (tag.startsWith('kind:')) return itemDef(itemId).kind === tag.slice(5);
  if (tag.startsWith('slot:')) return itemDef(itemId).slot === tag.slice(5);
  return itemId === tag;
}

export function matchesAny(itemId: string, tags: readonly string[] | undefined): boolean {
  return !!tags && tags.some((t) => matchesTag(itemId, t));
}

/** Their valuation of one unit of an item; null when they refuse it outright. */
export function personalValue(t: NpcTrading, itemId: string): number | null {
  const def = itemDef(itemId);
  if (def.bound) return null;
  if (matchesAny(itemId, t.refuses)) return null;
  let v = def.value;
  if (t.favorite && matchesTag(itemId, t.favorite)) v *= TUNABLES.trade.favoriteMultiplier;
  else if (matchesAny(itemId, t.wants)) v *= TUNABLES.trade.wantMultiplier;
  else if (matchesAny(itemId, t.dislikes)) v *= TUNABLES.trade.dislikeMultiplier;
  return v;
}

/** Value of an offer in the NPC's eyes; null if it contains something they refuse. */
export function offerValue(t: NpcTrading, offer: readonly ItemStack[]): number | null {
  let total = 0;
  for (const s of offer) {
    const v = personalValue(t, s.id);
    if (v === null) return null;
    total += v * s.count;
  }
  return total;
}

/** Base value of the items they'd hand over (their own goods use catalog value). */
export function askValue(items: readonly ItemStack[]): number {
  return items.reduce((a, s) => a + itemDef(s.id).value * s.count, 0);
}

/** `offer ≥ theirs × (1 + greed) − relationship bonus`. */
export function dealThreshold(t: NpcTrading, theirs: readonly ItemStack[], relationship: number): number {
  return Math.max(0, askValue(theirs) * (1 + t.greed) - relationship * TUNABLES.trade.relationshipBonusPerPoint);
}

export type TradeMood = 'refuse' | 'no' | 'meh' | 'yes' | 'love' | 'empty';

export interface TradeEvaluation {
  offer: number | null;
  threshold: number;
  ok: boolean;
  mood: TradeMood;
}

export function evaluateTrade(t: NpcTrading, yourOffer: readonly ItemStack[], theirs: readonly ItemStack[], relationship: number): TradeEvaluation {
  const offer = offerValue(t, yourOffer);
  const threshold = dealThreshold(t, theirs, relationship);
  if (offer === null) return { offer, threshold, ok: false, mood: 'refuse' };
  if (yourOffer.length === 0 && theirs.length === 0) return { offer, threshold, ok: false, mood: 'empty' };
  if (theirs.length === 0) return { offer, threshold, ok: offer > 0, mood: offer > 0 ? 'love' : 'empty' };
  const ratio = threshold > 0 ? offer / threshold : offer > 0 ? 2 : 0;
  const ok = offer >= threshold;
  const mood: TradeMood = ratio >= 1.6 ? 'love' : ok ? 'yes' : ratio >= 0.6 ? 'meh' : 'no';
  return { offer, threshold, ok, mood };
}

/** Did the player give junk (value < 5) for something worth ≥ 10? (achievement One Man's Trash) */
export function isJunkForTreasure(yourOffer: readonly ItemStack[], theirs: readonly ItemStack[]): boolean {
  const gaveOnlyJunk = yourOffer.length > 0 && yourOffer.every((s) => itemDef(s.id).kind === 'junk' || itemDef(s.id).kind === 'can');
  return gaveOnlyJunk && theirs.some((s) => itemDef(s.id).value >= 10);
}

export const MOOD_QUIPS: Record<TradeMood, readonly string[]> = {
  refuse: ['I won\'t take that. Not that. Anything but that.', 'No. Put it away.'],
  no: ['That\'s... not going to do it.', 'You\'re joking. You\'re not joking.', 'I\'ve been offered better by a raccoon.'],
  meh: ['Getting warmer.', 'Hmm. Almost.', 'Sweeten it a little.'],
  yes: ['Alright. Deal.', 'Fair enough.', 'You\'ve got yourself a trade.'],
  love: ['A *boot*? Now we\'re talking.', 'Oh, I LIKE that. Deal. Deal deal deal.', 'Take it. Take it before I change my mind.'],
  empty: ['Put something on the table.', 'We trading or staring?'],
};
