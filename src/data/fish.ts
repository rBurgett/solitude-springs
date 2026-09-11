// The 13 species (plan §9.4). Weights in pounds, skewed toward the low end by the catch logic.
export type Rarity = 'common' | 'uncommon' | 'rare' | 'veryRare' | 'legendary';
export type WaterKind = 'pool' | 'river' | 'marsh';
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface FishDef {
  id: string;
  name: string;
  rarity: Rarity;
  /** Water kinds the species lives in. */
  where: readonly WaterKind[];
  /** Phases it bites in. */
  when: readonly DayPhase[];
  /** Phases with a bite bonus (×2 weight in the species roll). */
  bestWhen?: readonly DayPhase[];
  minLb: number;
  maxLb: number;
  value: number;
  description: string;
  /** Only within one in-game day after a UFO visit (§9.4 #12). */
  needsUfo?: boolean;
  /** Only while serenity has been 100% for the calm window (§9.4 #13). */
  legendary?: boolean;
}

const ALL: readonly WaterKind[] = ['pool', 'river', 'marsh'];
const ANY: readonly DayPhase[] = ['dawn', 'day', 'dusk', 'night'];
const DAY: readonly DayPhase[] = ['dawn', 'day', 'dusk'];

export const FISH: readonly FishDef[] = [
  { id: 'bluegill', name: 'Bluegill', rarity: 'common', where: ALL, when: DAY, minLb: 0.2, maxLb: 1.2, value: 2, description: 'Small, brave, and convinced it is a shark.' },
  { id: 'redear_sunfish', name: 'Redear Sunfish', rarity: 'common', where: ['river'], when: DAY, minLb: 0.2, maxLb: 1.5, value: 2, description: 'Has red ears. Does not listen.' },
  { id: 'golden_shiner', name: 'Golden Shiner', rarity: 'common', where: ALL, when: ANY, minLb: 0.1, maxLb: 0.6, value: 1, description: 'Bait that got promoted.' },
  { id: 'black_crappie', name: 'Black Crappie', rarity: 'common', where: ['river'], when: ['dusk', 'night'], minLb: 0.3, maxLb: 2.5, value: 3, description: 'Pronounced "croppie". It insists.' },
  { id: 'striped_mullet', name: 'Striped Mullet', rarity: 'uncommon', where: ['pool', 'river'], when: ANY, minLb: 1, maxLb: 5, value: 4, description: 'Business in the front. Also business in the back.' },
  { id: 'chain_pickerel', name: 'Chain Pickerel', rarity: 'uncommon', where: ['river'], when: DAY, minLb: 1, maxLb: 5, value: 5, description: 'All teeth and opinions.' },
  { id: 'largemouth_bass', name: 'Largemouth Bass', rarity: 'uncommon', where: ALL, when: ANY, bestWhen: ['dawn', 'dusk'], minLb: 1, maxLb: 12, value: 6, description: 'The one everyone talks about.' },
  { id: 'channel_catfish', name: 'Channel Catfish', rarity: 'uncommon', where: ['river', 'marsh'], when: ['night'], minLb: 1, maxLb: 20, value: 6, description: 'Whiskers. Grudges. Night shifts.' },
  { id: 'bowfin', name: 'Bowfin', rarity: 'uncommon', where: ['marsh'], when: ANY, minLb: 2, maxLb: 12, value: 5, description: 'A living fossil with a bad attitude.' },
  { id: 'longnose_gar', name: 'Longnose Gar', rarity: 'rare', where: ['marsh'], when: ANY, minLb: 3, maxLb: 25, value: 10, description: 'Basically a stick that bites.' },
  { id: 'alligator_gar', name: 'Alligator Gar', rarity: 'rare', where: ['marsh'], when: ['night'], minLb: 20, maxLb: 120, value: 25, description: 'Not an alligator. Close enough to be worrying.' },
  { id: 'glowing_perch', name: 'Suspiciously Glowing Perch', rarity: 'veryRare', where: ALL, when: ['night'], minLb: 0.5, maxLb: 2, value: 40, needsUfo: true, description: 'Do not eat. Do not ask.' },
  { id: 'old_gus', name: 'Old Gus', rarity: 'legendary', where: ['pool'], when: ANY, minLb: 25, maxLb: 40, value: 100, legendary: true, description: 'The legend. Only bites when the world is truly, completely quiet.' },
];

export const FISH_BY_ID: ReadonlyMap<string, FishDef> = new Map(FISH.map((f) => [f.id, f]));

export function fishDef(id: string): FishDef {
  const f = FISH_BY_ID.get(id);
  if (!f) throw new Error(`unknown fish ${id}`);
  return f;
}
