// Item catalog (plan §8.3). Data only: the compiler checks ids through ItemId.
// Fish items are generated from src/data/fish.ts (ids `fish_<species>`), see ITEMS below.
import { FISH } from './fish.ts';

export type ItemKind = 'rod' | 'fish' | 'junk' | 'can' | 'weapon' | 'ammo' | 'clothing' | 'consumable' | 'misc';
export type ClothingSlot = 'hat' | 'top' | 'bottom' | 'full' | 'shoes';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Max stack size (§8.1). */
  stack: number;
  /** Hidden barter value (§10.3). */
  value: number;
  /** One-line joke description shown in tooltips. */
  description: string;
  /** Clothing: slot and the garment mesh id in the player GLB; palette of CSS colours a fished/traded copy rolls from (§8.2). */
  slot?: ClothingSlot;
  garment?: string;
  palette?: readonly string[];
  /** Consumables. */
  heal?: number;
  serenity?: number;
  /** Weapons/ammo (usable from M3). */
  range?: number;
  ammoFor?: string;
  ammoCount?: number;
  /** Can this item be stolen/confiscated/dropped? The starter rod can't (§8.1). */
  bound?: boolean;
  /** Misc flags. */
  emitsLight?: boolean;
}

const NEUTRALS = ['#e8e8e8', '#2b2b2b', '#8a6a4a', '#2b3350', '#6b7280'] as const;
const BRIGHTS = ['#c92f2f', '#e06a2a', '#e8c53a', '#3f9a4a', '#1aa7a1', '#2f5d8a', '#7a4bb0', '#d9407a'] as const;
const ALL_COLORS = [...NEUTRALS, ...BRIGHTS] as const;

const BASE_ITEMS = [
  // --- tools ---
  { id: 'old_rod', name: 'Old Fishing Rod', kind: 'rod', stack: 1, value: 0, bound: true, description: 'Been in the family for years. Nobody wanted it.' },
  // --- junk (§8.3) ---
  { id: 'old_boot', name: 'Old Boot', kind: 'junk', stack: 10, value: 1, description: 'Left foot. Some people out here will love it.' },
  { id: 'glass_bottle', name: 'Glass Bottle', kind: 'junk', stack: 10, value: 1, description: 'Empty. The river drank it.' },
  { id: 'message_bottle', name: 'Message in a Bottle', kind: 'junk', stack: 10, value: 3, description: 'A note inside. Readable in the Journal.' },
  { id: 'beer_can', name: 'Beer Can', kind: 'can', stack: 20, value: 0, description: 'Somebody had a great time. The river did not.' },
  { id: 'rubber_duck', name: 'Rubber Duck', kind: 'junk', stack: 10, value: 2, description: 'It has seen things.' },
  { id: 'traffic_cone', name: 'Traffic Cone', kind: 'junk', stack: 10, value: 1, description: 'How.' },
  { id: 'garden_gnome', name: 'Garden Gnome', kind: 'junk', stack: 10, value: 3, description: 'Smiling. Always smiling.' },
  { id: 'smartphone', name: 'Waterlogged Smartphone', kind: 'junk', stack: 10, value: 2, description: '37 missed calls from Mom.' },
  { id: 'car_keys', name: "Someone's Car Keys", kind: 'junk', stack: 10, value: 1, description: 'A keychain that says LARRY. Return them?' },
  { id: 'trophy', name: "'World's Best Fisherman' Trophy", kind: 'junk', stack: 10, value: 4, description: 'Somebody threw this in on purpose.' },
  { id: 'toilet_seat', name: 'Toilet Seat', kind: 'junk', stack: 10, value: 1, description: 'Please do not think about it.' },
  { id: 'bowling_ball', name: 'Bowling Ball', kind: 'junk', stack: 10, value: 2, description: 'Heavy. Purple. Somebody misses it.' },
  // --- weapons & ammo (usable from M3; catchable in M1) ---
  { id: 'pocket_knife', name: 'Pocket Knife', kind: 'weapon', stack: 1, value: 8, range: 1.8, description: 'Good for cutting line. And other things.' },
  { id: 'handgun', name: 'Handgun', kind: 'weapon', stack: 1, value: 20, range: 40, ammoFor: 'pistol_ammo', description: 'Somebody lost this. Somebody is going to want it back.' },
  { id: 'rifle', name: 'Rifle', kind: 'weapon', stack: 1, value: 30, range: 120, ammoFor: 'rifle_ammo', description: 'Bolt action. Reaches all the way across the river.' },
  { id: 'pistol_ammo', name: 'Pistol Ammo', kind: 'ammo', stack: 50, value: 4, ammoCount: 12, description: 'A box of twelve. Still dry, somehow.' },
  { id: 'rifle_ammo', name: 'Rifle Ammo', kind: 'ammo', stack: 50, value: 5, ammoCount: 6, description: 'A box of six.' },
  // --- clothing (§8.3) — garment ids match assets-src/characters/players.json ---
  { id: 'tshirt', name: 'T-shirt', kind: 'clothing', stack: 1, value: 3, slot: 'top', garment: 'tshirt', palette: ALL_COLORS, description: 'Slightly damp. Everything here is slightly damp.' },
  { id: 'polo', name: 'Hawaiian Shirt', kind: 'clothing', stack: 1, value: 4, slot: 'top', garment: 'polo', palette: BRIGHTS, description: 'Loud enough to scare the fish.' },
  { id: 'tank_top', name: 'Tank Top', kind: 'clothing', stack: 1, value: 2, slot: 'top', garment: 'tank_top', palette: ALL_COLORS, description: 'Sun\'s out.' },
  { id: 'sweater', name: 'Fisherman Sweater', kind: 'clothing', stack: 1, value: 5, slot: 'top', garment: 'sweater', palette: NEUTRALS, description: 'Knitted by somebody who loved a fisherman.' },
  { id: 'pants', name: 'Jeans', kind: 'clothing', stack: 1, value: 3, slot: 'bottom', garment: 'pants', palette: ['#2b3350', '#2b2b2b', '#4a5a7a', '#8a6a4a'], description: 'Sturdy. Wet jeans are a lifestyle.' },
  { id: 'cargo_pants', name: 'Cargo Pants', kind: 'clothing', stack: 1, value: 3, slot: 'bottom', garment: 'cargo_pants', palette: ['#8a6a4a', '#5a6a3a', '#6b7280', '#2b2b2b'], description: 'Fourteen pockets. All of them full of sand.' },
  { id: 'shorts', name: 'Cargo Shorts', kind: 'clothing', stack: 1, value: 2, slot: 'bottom', garment: 'shorts', palette: ['#8a6a4a', '#2b3350', '#e8e8e8', '#5a6a3a'], description: 'Dad energy.' },
  { id: 'sweatpants', name: 'Sweatpants', kind: 'clothing', stack: 1, value: 2, slot: 'bottom', garment: 'sweatpants', palette: NEUTRALS, description: 'Giving up, but comfortably.' },
  { id: 'short_dress', name: 'Short Dress', kind: 'clothing', stack: 1, value: 4, slot: 'full', garment: 'short_dress', palette: ALL_COLORS, description: 'Flattering on absolutely anyone. Yes, you.' },
  { id: 'sundress', name: 'Sundress', kind: 'clothing', stack: 1, value: 4, slot: 'full', garment: 'sundress', palette: BRIGHTS, description: 'Breezy. Very breezy.' },
  { id: 'ball_gown', name: 'Ball Gown', kind: 'clothing', stack: 1, value: 12, slot: 'full', garment: 'ball_gown', palette: ['#e8e8e8', '#d9407a', '#7a4bb0', '#1aa7a1', '#e8c53a'], description: 'Somebody had a very bad night at a very fancy party.' },
  { id: 'swimsuit', name: 'Swimsuit', kind: 'clothing', stack: 1, value: 4, slot: 'full', garment: 'swimsuit', palette: BRIGHTS, description: 'Wrong lake, but the right idea.' },
  { id: 'tuxedo', name: 'Tuxedo', kind: 'clothing', stack: 1, value: 15, slot: 'full', garment: 'tuxedo', palette: ['#2b2b2b', '#2b3350', '#e8e8e8'], description: 'Formal fishing.' },
  { id: 'jumpsuit', name: 'Silver Jumpsuit', kind: 'clothing', stack: 1, value: 10, slot: 'full', garment: 'jumpsuit', palette: ['#c8ccd6'], description: 'Not from around here. Or anywhere.' },
  { id: 'sneakers', name: 'Sneakers', kind: 'clothing', stack: 1, value: 3, slot: 'shoes', garment: 'sneakers', palette: ['#e8e8e8', '#2b2b2b', '#c92f2f', '#2f5d8a'], description: 'They squelch now.' },
  { id: 'hiking_boots', name: 'Hiking Boots', kind: 'clothing', stack: 1, value: 4, slot: 'shoes', garment: 'hiking_boots', palette: ['#8a6a4a', '#2b2b2b'], description: 'For hiking. Or standing in mud with confidence.' },
  { id: 'flats', name: 'Flats', kind: 'clothing', stack: 1, value: 3, slot: 'shoes', garment: 'flats', palette: ['#2b2b2b', '#d9407a', '#8a6a4a', '#e8e8e8'], description: 'Practical. Quiet. Suspiciously dry.' },
  { id: 'fedora', name: 'Fedora', kind: 'clothing', stack: 1, value: 3, slot: 'hat', garment: 'fedora', palette: ['#8a6a4a', '#2b2b2b', '#6b7280'], description: 'Tips itself.' },
  // --- consumables & misc (§8.3) ---
  { id: 'bandage', name: 'Bandage', kind: 'consumable', stack: 5, value: 3, heal: 2, description: 'Mostly clean.' },
  { id: 'granola_bar', name: 'Granola Bar', kind: 'consumable', stack: 5, value: 2, heal: 1, description: 'Trail-hardened.' },
  { id: 'burger', name: 'Burger', kind: 'consumable', stack: 5, value: 3, heal: 2, description: 'Campground special. Cooked, probably.' },
  { id: 'pizza_slice', name: 'Pizza Slice', kind: 'consumable', stack: 5, value: 3, heal: 2, description: 'Delivered to a river, somehow.' },
  { id: 'lavender_oil', name: 'Lavender Oil', kind: 'consumable', stack: 5, value: 4, serenity: 0.2, description: 'Breathe in. Breathe out. Ignore everything.' },
  { id: 'lucky_lure', name: 'Lucky Lure', kind: 'misc', stack: 1, value: 12, description: 'Rare fish find it irresistible. So do thieves.' },
  { id: 'trash_bag', name: 'Trash Bag', kind: 'misc', stack: 1, value: 2, description: 'Cleaning counts double while you carry it.' },
  { id: 'headlamp', name: 'Headlamp', kind: 'clothing', stack: 1, value: 5, slot: 'hat', garment: 'fedora', emitsLight: true, palette: ['#2b2b2b'], description: 'For seeing. Also for being seen by aliens.' },
  // --- M2 clothing: the pity barrel, the tinfoil hat and the wetsuit (§11.4; procedural meshes, see character.ts) ---
  { id: 'barrel', name: 'Barrel', kind: 'clothing', stack: 1, value: 1, slot: 'full', garment: 'barrel', palette: ['#8a6a4a'], description: 'Suspenders included. Dignity not included.' },
  { id: 'tinfoil_hat', name: 'Tinfoil Hat', kind: 'clothing', stack: 1, value: 2, slot: 'hat', garment: 'tinfoil', palette: ['#d8dde6'], description: 'Blocks the rays. Which rays? Exactly.' },
  { id: 'wetsuit', name: 'Wetsuit', kind: 'clothing', stack: 1, value: 6, slot: 'full', garment: 'jumpsuit', palette: ['#1c1c1c', '#1f3550'], description: 'Somebody was down there a long time.' },
  // --- M2 consumables and trade goods (§10.5) ---
  { id: 'mre', name: 'MRE', kind: 'consumable', stack: 5, value: 3, heal: 2, description: 'Meal, Ready to Eat. Eventually.' },
  { id: 'jerky', name: 'Homemade Jerky', kind: 'consumable', stack: 5, value: 3, heal: 1, description: "Jolene's recipe. Chewy for a reason." },
  { id: 'mushrooms', name: 'Probably Fine Mushrooms', kind: 'consumable', stack: 5, value: 2, heal: 1, description: 'Rosa says they are probably fine.' },
  { id: 'business_card', name: 'Business Card', kind: 'junk', stack: 10, value: 1, description: '"Velvet Vivian — Acquisitions." There is a lipstick mark.' },
  { id: 'merit_badge', name: 'Merit Badge', kind: 'junk', stack: 10, value: 1, description: 'Awarded for standing there.' },
  { id: 'vibes', name: 'Vibes', kind: 'junk', stack: 10, value: 2, description: 'Kai insists this is a real thing you can hold.' },
] as const satisfies readonly ItemDef[];

const FISH_ITEMS: ItemDef[] = FISH.map((f) => ({
  id: `fish_${f.id}`,
  name: f.name,
  kind: 'fish',
  stack: 10,
  value: f.value,
  description: f.description,
}));

export const ITEMS: readonly ItemDef[] = [...BASE_ITEMS, ...FISH_ITEMS];
export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export type BaseItemId = (typeof BASE_ITEMS)[number]['id'];

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}

export function isKnownItem(id: unknown): id is string {
  return typeof id === 'string' && ITEM_BY_ID.has(id);
}

const ICONS: Record<string, string> = {
  old_rod: '🎣', old_boot: '🥾', glass_bottle: '🍾', message_bottle: '📜', beer_can: '🥫', rubber_duck: '🦆', traffic_cone: '🔶', garden_gnome: '🧙', smartphone: '📱', car_keys: '🔑', trophy: '🏆', toilet_seat: '🚽', bowling_ball: '🎳',
  pocket_knife: '🔪', handgun: '🔫', rifle: '🎯', pistol_ammo: '📦', rifle_ammo: '📦', bandage: '🩹', granola_bar: '🍫', burger: '🍔', pizza_slice: '🍕', lavender_oil: '🧴', lucky_lure: '🪝', trash_bag: '🗑️', headlamp: '🔦',
  fedora: '🎩', sneakers: '👟', hiking_boots: '🥾', flats: '🥿', short_dress: '👗', sundress: '👗', ball_gown: '👗', swimsuit: '🩱', tuxedo: '🤵', jumpsuit: '👽', tshirt: '👕', polo: '👕', tank_top: '🎽', sweater: '🧥', pants: '👖', cargo_pants: '👖', shorts: '🩳', sweatpants: '👖',
  barrel: '🛢️', tinfoil_hat: '🥫', wetsuit: '🤿', mre: '🥫', jerky: '🥩', mushrooms: '🍄', business_card: '💳', merit_badge: '🎖️', vibes: '✨',
};

/** Emoji glyph for the hotbar and inventory. */
export function itemIcon(id: string): string {
  if (ICONS[id]) return ICONS[id]!;
  const d = ITEM_BY_ID.get(id);
  if (!d) return '❔';
  return d.kind === 'fish' ? '🐟' : d.kind === 'clothing' ? '👕' : '📦';
}

/** Junk items that can be fished up (cans included, they count as junk in the catch table). */
export const FISHABLE_JUNK: readonly string[] = ['old_boot', 'glass_bottle', 'message_bottle', 'beer_can', 'rubber_duck', 'traffic_cone', 'garden_gnome', 'smartphone', 'car_keys', 'trophy', 'toilet_seat', 'bowling_ball'];
/** Odd pieces the aliens favour when replacing an abductee's outfit (§11.4). */
export const ODD_CLOTHING: readonly string[] = ['jumpsuit', 'tinfoil_hat', 'ball_gown', 'tuxedo', 'wetsuit', 'swimsuit', 'barrel'];
/** Clothing that can be fished up. */
export const FISHABLE_CLOTHING: readonly string[] = ['tshirt', 'polo', 'tank_top', 'sweater', 'pants', 'cargo_pants', 'shorts', 'sweatpants', 'short_dress', 'sundress', 'ball_gown', 'swimsuit', 'tuxedo', 'sneakers', 'hiking_boots', 'flats', 'fedora'];
