// Validation on load/import (plan §14.5): saves are untrusted input. Type checks, clamped
// numbers, sanitized name, unknown ids dropped. Returns null for anything unrecoverable.
import { isKnownItem, itemDef } from '../../data/items.ts';
import { FISH_BY_ID } from '../../data/fish.ts';
import { TUNABLES } from '../../data/tunables.ts';
import { TOTAL_SLOTS, HOTBAR, type InventoryState, type ItemStack, type WornSlot } from '../inventory.ts';
import { createJournal, createStats, type JournalState, type StatsState } from '../journal.ts';
import { SCHEMA_VERSION, type SaveRecord } from './schema.ts';
import { migrateSave } from './migrate.ts';

export const NAME_MAX = 24;

/** Strip control characters, trim, clamp length; empty becomes a default. */
export function sanitizeName(raw: unknown, fallback = 'Angler'): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, '').trim().slice(0, NAME_MAX).trim();
  return cleaned.length ? cleaned : fallback;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const int = (v: unknown, def: number, min = -Infinity, max = Infinity): number => Math.round(num(v, def, min, max));
const str = (v: unknown, def: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const color = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : undefined);
const iso = (v: unknown, def: string): string => {
  if (typeof v !== 'string') return def;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : def;
};
const vec3 = (v: unknown, def: [number, number, number], limit = 5000): [number, number, number] => {
  if (!Array.isArray(v) || v.length < 3) return def;
  return [num(v[0], def[0], -limit, limit), num(v[1], def[1], -limit, limit), num(v[2], def[2], -limit, limit)];
};

function stack(v: unknown): ItemStack | null {
  if (!isObj(v) || !isKnownItem(v.id)) return null;
  const def = itemDef(v.id);
  const count = int(v.count, 1, 1, def.stack);
  const c = color(v.color);
  return { id: v.id, count, ...(c ? { color: c } : {}) };
}

export function validateInventory(v: unknown): InventoryState {
  const inv: InventoryState = { slots: Array.from({ length: TOTAL_SLOTS }, () => null), selected: 0, worn: {} };
  if (!isObj(v)) return inv;
  if (Array.isArray(v.slots)) {
    for (let i = 0; i < Math.min(TOTAL_SLOTS, v.slots.length); i++) inv.slots[i] = stack(v.slots[i]);
  }
  inv.selected = int(v.selected, 0, 0, HOTBAR - 1);
  if (isObj(v.worn)) {
    for (const slot of ['hat', 'top', 'bottom', 'full', 'shoes'] as WornSlot[]) {
      const s = stack(v.worn[slot]);
      if (s && itemDef(s.id).kind === 'clothing' && itemDef(s.id).slot === slot) inv.worn[slot] = { ...s, count: 1 };
    }
    // a full-body garment excludes top and bottom (§8.2)
    if (inv.worn.full) {
      delete inv.worn.top;
      delete inv.worn.bottom;
    }
  }
  return inv;
}

function validateJournal(v: unknown): JournalState {
  const j = createJournal();
  if (!isObj(v)) return j;
  if (isObj(v.species)) {
    for (const [id, rec] of Object.entries(v.species)) {
      if (!FISH_BY_ID.has(id) || !isObj(rec)) continue;
      j.species[id] = { caught: int(rec.caught, 1, 1, 1e6), recordLb: num(rec.recordLb, 0, 0, 1000), firstAt: iso(rec.firstAt, new Date(0).toISOString()) };
    }
  }
  if (Array.isArray(v.messages)) j.messages = v.messages.filter((m): m is string => typeof m === 'string').slice(0, 200).map((m) => m.slice(0, 64));
  if (Array.isArray(v.people)) j.people = v.people.filter((m): m is string => typeof m === 'string').slice(0, 200).map((m) => m.slice(0, 64));
  return j;
}

function validateStats(v: unknown): StatsState {
  const s = createStats();
  if (!isObj(v)) return s;
  for (const k of Object.keys(s) as (keyof StatsState)[]) s[k] = num(v[k], 0, 0, 1e9);
  return s;
}

/**
 * Validate an arbitrary decoded value into a SaveRecord. Applies migrations first.
 * Returns null if the value isn't a save at all.
 */
export function validateSave(input: unknown): SaveRecord | null {
  if (!isObj(input)) return null;
  const migrated = migrateSave(input);
  if (!migrated) return null;
  const v = migrated;
  if (!isObj(v.character) || !isObj(v.player) || !isObj(v.world)) return null;
  const now = new Date().toISOString();
  const ch = v.character;
  const character: SaveRecord['character'] = {
    name: sanitizeName(ch.name),
    sex: ch.sex === 'female' ? 'female' : 'male',
    skin: int(ch.skin, 2, 0, 9),
    hairColor: color(ch.hairColor) ?? '#3b2416',
    hairStyle: str(ch.hairStyle, 'short', 32),
    outfitColors: {},
  };
  if (isObj(ch.outfitColors)) {
    for (const [k, c] of Object.entries(ch.outfitColors)) {
      const cc = color(c);
      if (cc && /^[a-z_]{1,32}$/.test(k)) character.outfitColors[k] = cc;
    }
  }
  const p = v.player;
  const player: SaveRecord['player'] = {
    position: vec3(p.position, [0, 0, 0]),
    facing: num(p.facing, 0, -Math.PI * 2, Math.PI * 2),
    health: num(p.health, TUNABLES.health.maxHearts, 0, TUNABLES.health.maxHearts),
    inBoat: bool(p.inBoat, false),
    inventory: validateInventory(p.inventory),
  };
  const w = v.world;
  const clockIn = isObj(w.clock) ? w.clock : {};
  const world: SaveRecord['world'] = {
    clock: { day: int(clockIn.day, 1, 1, 1e6), time: num(clockIn.time, 0, 0, TUNABLES.clock.dayLengthSeconds - 0.001) },
    zones: {},
    boat: null,
    pickups: [],
  };
  if (isObj(w.zones)) {
    for (const [id, z] of Object.entries(w.zones)) {
      if (!isObj(z) || !/^[a-z0-9_]{1,32}$/.test(id)) continue;
      world.zones[id] = { population: num(z.population, 1, 0, 1), trash: num(z.trash, 0, 0, 1) };
    }
  }
  if (Array.isArray(w.boat) && w.boat.length >= 4) {
    const b = vec3(w.boat, [0, 0, 0]);
    world.boat = [b[0], b[1], b[2], num(w.boat[3], 0, -Math.PI * 2, Math.PI * 2)];
  }
  if (Array.isArray(w.pickups)) {
    for (const pk of w.pickups.slice(0, 500)) {
      if (!isObj(pk)) continue;
      const s = stack({ id: pk.itemId, count: pk.count, color: pk.color });
      if (!s) continue;
      world.pickups.push({ id: str(pk.id, '', 64) || `${world.pickups.length}`, itemId: s.id, count: s.count, ...(s.color ? { color: s.color } : {}), position: vec3(pk.position, [0, 0, 0]) });
    }
  }
  const d = isObj(v.director) ? v.director : {};
  const pr = isObj(v.progress) ? v.progress : {};
  const achievements: Record<string, string> = {};
  if (isObj(pr.achievements)) {
    for (const [k, t] of Object.entries(pr.achievements)) if (/^[a-z0-9_]{1,48}$/.test(k)) achievements[k] = iso(t, now);
  }
  const rng = isObj(v.rng) ? v.rng : {};
  const createdAt = iso(v.createdAt, now);
  return {
    id: str(v.id, '', 64) || 'save',
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    savedAt: iso(v.savedAt, createdAt),
    playTimeSeconds: num(v.playTimeSeconds, 0, 0, 1e9),
    ...(typeof v.thumbnail === 'string' && v.thumbnail.startsWith('data:image/png;base64,') && v.thumbnail.length < 200_000 ? { thumbnail: v.thumbnail } : {}),
    character,
    player,
    world,
    npcs: isObj(v.npcs) ? v.npcs : {},
    director: { wanted: int(d.wanted, 0, 0, 10), ufoRecentUntil: num(d.ufoRecentUntil, 0, 0, 1e9), lull: bool(d.lull, false) },
    progress: { achievements, stats: validateStats(pr.stats), journal: validateJournal(pr.journal), serenity: num(pr.serenity, TUNABLES.serenity.start, 0, 1) },
    rng: { seed: int(rng.seed, 1, 0, 4294967295), state: int(rng.state, 1, 0, 4294967295) },
  };
}

/** Parse + validate JSON text (import). Enforces the size limit. */
export function parseSaveJson(text: string): { save: SaveRecord | null; error?: string } {
  if (text.length > TUNABLES.save.maxBytes) return { save: null, error: 'File is too large.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { save: null, error: 'Not a valid save file.' };
  }
  const save = validateSave(parsed);
  return save ? { save } : { save: null, error: 'Not a Solitude Springs save.' };
}
