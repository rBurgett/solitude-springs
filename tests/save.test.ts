import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSave, parseSaveJson, sanitizeName, validateInventory } from '../src/sim/save/validate.ts';
import { formatSaveDate, formatPlayTime } from '../src/sim/save/format.ts';
import { migrateSave } from '../src/sim/save/migrate.ts';
import { SCHEMA_VERSION, type SaveRecord } from '../src/sim/save/schema.ts';
import { createInventory, addItem, equipFromSlot } from '../src/sim/inventory.ts';
import { createClock } from '../src/sim/clock.ts';
import { createJournal, createStats, recordCatch } from '../src/sim/journal.ts';

function sample(): SaveRecord {
  const inventory = createInventory();
  addItem(inventory, { id: 'old_rod', count: 1 });
  addItem(inventory, { id: 'short_dress', count: 1, color: '#d9407a' });
  equipFromSlot(inventory, 1);
  addItem(inventory, { id: 'fish_bluegill', count: 2 });
  const journal = createJournal();
  recordCatch(journal, 'bluegill', 0.8, '2026-09-05T17:54:00.000Z');
  return {
    id: 'abc',
    schemaVersion: SCHEMA_VERSION,
    createdAt: '2026-09-05T17:00:00.000Z',
    savedAt: '2026-09-05T17:54:00.000Z',
    playTimeSeconds: 3240,
    character: { name: 'Ryaaaaaaan', sex: 'male', skin: 3, hairColor: '#3b2416', hairStyle: 'short', outfitColors: { tshirt: '#1aa7a1' } },
    player: { position: [12, 3.5, -40], facing: 1.2, health: 4, inBoat: false, inventory },
    world: { clock: { ...createClock(), day: 3 }, zones: { pool: { population: 0.8, trash: 0 }, sandy_bend: { population: 0.2, trash: 0.7 } }, boat: [1, 0, 2, 0.5], pickups: [{ id: 'p1', itemId: 'beer_can', count: 1, position: [1, 0, 1] }] },
    npcs: { barb: { met: 2, robbed: 0, poofed: 1, relationship: 12, grudge: false, inventory: [{ id: 'lucky_lure', count: 1 }], stolen: [], lastSeenDay: 2, poofedAt: 2.5, flags: { poofGreeted: true } } },
    director: { wanted: 0, ufoRecentUntil: 0, lull: false, sessionSeconds: 1200, cooldownsRemaining: { thief: 120 }, lullScheduledDay: 3, lullAtFraction: 0.4, recent: { party: 2.9 }, eventsRun: 4, rangersBoth: false },
    progress: { achievements: { first_catch: '2026-09-05T17:10:00.000Z' }, stats: { ...createStats(), fishCaught: 3 }, journal, serenity: 0.7 },
    rng: { seed: 123, state: 456 },
  };
}

test('round trip through JSON keeps everything', () => {
  const s = sample();
  const back = validateSave(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
});

test('garbage and malicious input are rejected or clamped', () => {
  assert.equal(validateSave(null), null);
  assert.equal(validateSave('nope'), null);
  assert.equal(validateSave({ schemaVersion: 99, character: {}, player: {}, world: {} }), null);
  assert.equal(parseSaveJson('{not json').save, null);
  assert.equal(parseSaveJson('x'.repeat(6 * 1024 * 1024)).save, null);
  const evil = JSON.parse(JSON.stringify(sample()));
  evil.character.name = '  <script>alert(1)</script>  very very very long name indeed ';
  evil.character.skin = 999;
  evil.player.health = 1e9;
  evil.player.position = ['a', null, 1e12];
  evil.player.inventory.slots[0] = { id: 'plutonium', count: 5 };
  evil.player.inventory.slots[1] = { id: 'beer_can', count: 9999 };
  evil.player.inventory.worn.top = { id: 'pants', count: 1 };
  evil.world.zones.pool.population = -3;
  evil.progress.journal.species.dragon = { caught: 1, recordLb: 1, firstAt: 'x' };
  evil.progress.achievements['../../etc'] = 'now';
  evil.rng.seed = -1;
  const v = validateSave(evil)!;
  assert.equal(v.character.name, '<script>alert(1)</script');
  assert.equal(v.character.skin, 9);
  assert.equal(v.player.health, 5);
  assert.deepEqual(v.player.position, [0, 0, 5000]);
  assert.equal(v.player.inventory.slots[0], null);
  assert.equal(v.player.inventory.slots[1]?.count, 20);
  assert.equal(v.player.inventory.worn.top, undefined);
  assert.equal(v.world.zones.pool?.population, 0);
  assert.equal(v.progress.journal.species.dragon, undefined);
  assert.equal(v.progress.achievements['../../etc'], undefined);
  assert.equal(v.rng.seed, 0);
  // unknown npc ids and event types are dropped; memories are clamped
  const evil2 = JSON.parse(JSON.stringify(sample()));
  evil2.npcs.dragon = { met: 1 };
  evil2.npcs.barb.relationship = 9999;
  evil2.npcs.barb.inventory = [{ id: 'plutonium', count: 1 }, { id: 'beer_can', count: 3 }];
  evil2.director.cooldownsRemaining.volcano = 5;
  const v2 = validateSave(evil2)!;
  assert.equal(v2.npcs.dragon, undefined);
  assert.equal(v2.npcs.barb?.relationship, 100);
  assert.deepEqual(v2.npcs.barb?.inventory, [{ id: 'beer_can', count: 3 }]);
  assert.equal((v2.director.cooldownsRemaining as Record<string, number>).volcano, undefined);
});

test('a version-1 save migrates to version 2 with empty memories', () => {
  const v1 = JSON.parse(JSON.stringify(sample()));
  v1.schemaVersion = 1;
  v1.director = { wanted: 1, ufoRecentUntil: 3.5, lull: true };
  delete v1.npcs;
  const v = validateSave(v1)!;
  assert.equal(v.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(v.npcs, {});
  assert.equal(v.director.wanted, 1);
  assert.equal(v.director.ufoRecentUntil, 3.5);
  assert.equal(v.director.lull, false);
});

test('names are sanitized', () => {
  assert.equal(sanitizeName('  Bob\tthe   Angler\u200b '), 'Bob the Angler');
  assert.equal(sanitizeName('ding'), 'ding');
  assert.equal(sanitizeName(''), 'Angler');
  assert.equal(sanitizeName(42), 'Angler');
  assert.equal(sanitizeName('a'.repeat(40)).length, 24);
});

test('migrations upgrade old versions and refuse future ones', () => {
  const v0 = migrateSave({ character: {} });
  assert.equal(v0?.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrateSave({ schemaVersion: SCHEMA_VERSION + 1 }), null);
});

test('a full-body garment in the worn slots drops top and bottom', () => {
  const inv = validateInventory({ slots: [], selected: 3, worn: { full: { id: 'tuxedo', count: 1 }, top: { id: 'tshirt', count: 1 } } });
  assert.equal(inv.worn.full?.id, 'tuxedo');
  assert.equal(inv.worn.top, undefined);
  assert.equal(inv.selected, 3);
});

test('dates format in the player locale and time zone', () => {
  assert.equal(formatSaveDate('2026-09-05T17:54:00.000Z', 'en-US', 'America/New_York'), 'September 5, 2026 at 1:54 PM');
  assert.equal(formatSaveDate('2026-09-05T17:54:00.000Z', 'en-GB', 'Europe/London'), '5 September 2026 at 18:54');
  assert.equal(formatSaveDate('garbage'), 'Unknown date');
  assert.equal(formatPlayTime(3240), '54m');
  assert.equal(formatPlayTime(7300), '2h 1m');
});
