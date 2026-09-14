// Plan §20 M3 acceptance: every non-secret achievement is unlockable via a scripted or console path.
// Each entry below is that path expressed as the state change it produces; the test proves the
// trigger fires for it and that no non-secret achievement is left without a path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS } from '../src/data/achievements.ts';
import { checkAchievements, achievementProgress, CHECKED_ACHIEVEMENTS, type AchievementContext } from '../src/sim/achievements.ts';
import { createJournal, createStats, recordCatch, recordPerson, recordMessage } from '../src/sim/journal.ts';
import { FISH } from '../src/data/fish.ts';
import { NPCS } from '../src/data/npcs.ts';
import { MESSAGES } from '../src/data/messages.ts';
import { TUNABLES } from '../src/data/tunables.ts';
import { DIALOGUE } from '../src/data/dialogue/index.ts';
import { validateSave } from '../src/sim/save/validate.ts';

function ctx(): AchievementContext {
  return { stats: createStats(), journal: createJournal(), serenity: 0.5, calmSeconds: 0, playTimeSeconds: 0 };
}

/** id → the console/scripted path, as the state it leaves behind. */
const PATHS: Record<string, (c: AchievementContext) => void> = {
  first_catch: (c) => void (c.stats.fishCaught = 1),
  dinner_is_served: (c) => void (c.stats.fishCaught = 10),
  seasoned_angler: (c) => void (c.stats.fishCaught = 50),
  reel_legend: (c) => void (c.stats.fishCaught = 250),
  gotta_log_em_all: (c) => FISH.filter((f) => !f.legendary).forEach((f) => recordCatch(c.journal, f.id, 1, 'x')),
  the_big_one: (c) => void (c.stats.bestFishLb = 10.5),
  old_gus: (c) => void recordCatch(c.journal, 'old_gus', 30, 'x'),
  night_shift: (c) => void (c.stats.nightCatches = 10),
  boat_life: (c) => void (c.stats.boatCatches = 1),
  sole_survivor: (c) => void (c.stats.bootsCaught = 1),
  armed_angler: (c) => void (c.stats.firearmsCaught = 1),
  too_eager: (c) => void (c.stats.nibbleReels = 10),
  it_got_away: (c) => void (c.stats.bitesMissed = 25),
  casting_into_the_trees: (c) => void (c.stats.treesHit = 10),
  not_today: (c) => void (c.stats.thievesStopped = 1),
  repo_man: (c) => void (c.stats.stolenRecovered = 1),
  poof_there_it_is: (c) => void (c.stats.hostilesPoofed = 1),
  bear_necessities: (c) => void (c.stats.bearsScared = 1),
  see_you_later: (c) => void (c.stats.gatorsScared = 1),
  buzzkill: (c) => void (c.stats.partiesBroken = 1),
  grudge_match: (c) => void (c.stats.grudgesHandled = 1),
  robbed_blind: (c) => void (c.stats.timesRobbed = 10),
  emperors_new_clothes: (c) => void (c.stats.timesStripped = 1),
  barrel_of_laughs: (c) => void (c.stats.barrelsReceived = 1),
  close_encounter: (c) => void (c.stats.abductions = 1),
  frequent_flyer: (c) => void (c.stats.abductions = 3),
  gator_bait: (c) => void (c.stats.gatorBites = 5),
  grizzly_tax: (c) => void (c.stats.fishLostToBears = 50),
  hope_springs_eternal: (c) => void (c.stats.beerCasts = 10),
  worst_day_ever: (c) => {
    c.stats.worstDayRobbed = 3;
    c.stats.worstDayStripped = 3;
    c.stats.worstDayBear = 3;
  },
  poof: (c) => void (c.stats.deaths = 1),
  hello_neighbor: (c) => NPCS.slice(0, 10).forEach((n) => recordPerson(c.journal, n.id)),
  social_butterfly: (c) => NPCS.forEach((n) => recordPerson(c.journal, n.id)),
  shrewd_barterer: (c) => void (c.stats.tradesCompleted = 25),
  one_mans_trash: (c) => void (c.stats.junkForTreasure = 1),
  leave_no_trace: (c) => void (c.stats.zonesCleaned = 1),
  trailway_robbery: (c) => void (c.stats.robberies = 1),
  most_wanted: (c) => void (c.stats.confiscations = 1),
  actual_solitude: (c) => {
    c.serenity = 1;
    c.calmSeconds = TUNABLES.legend.calmSecondsRequired;
  },
  breezy: (c) => void (c.stats.dressWornSeconds = TUNABLES.clock.dayLengthSeconds),
  dapper: (c) => void (c.stats.tuxedoWornSeconds = TUNABLES.clock.dayLengthSeconds),
  dressed_by_the_river: (c) => void (c.stats.riverOutfits = 1),
  believer: (c) => void (c.stats.tinfoilTalks = 1),
  castaway: (c) => MESSAGES.forEach((m) => recordMessage(c.journal, m.id)),
  oarsome: (c) => void (c.stats.boatMetres = 1000),
  tranquil_experience: (c) => void (c.playTimeSeconds = 3600),
  // the secrets (not required by the acceptance, but they have triggers too)
  did_anyone_see_that: (c) => void (c.stats.abductedMidConversation = 1),
  conga: (c) => void (c.stats.congas = 1),
};

test('every non-secret achievement has a path that unlocks it (and only it, from a fresh state)', () => {
  for (const a of ACHIEVEMENTS) {
    if (a.id === 'is_this_yours') continue; // unlocked by Larry's dialogue effect (below)
    const path = PATHS[a.id];
    assert.ok(path, `${a.id} has no path`);
    const c = ctx();
    assert.deepEqual(checkAchievements({}, c), [], `${a.id}: nothing unlocks from a fresh state`);
    path!(c);
    const ids = checkAchievements({}, c);
    assert.ok(ids.includes(a.id), `${a.id} unlocks via its path (got ${ids.join(', ') || 'nothing'})`);
  }
});

test("Is This Yours? is unlocked by returning Larry's keys in his dialogue", () => {
  const larry = DIALOGUE.larry!.tree;
  const unlocks = Object.values(larry.nodes).flatMap((n) => (n.choices ?? []).flatMap((ch) => (ch.effects ?? []).filter((e) => 'unlock' in e).map((e) => (e as { unlock: string }).unlock)));
  assert.ok(unlocks.includes('is_this_yours'));
  const keyChoice = Object.values(larry.nodes).flatMap((n) => n.choices ?? []).find((ch) => (ch.effects ?? []).some((e) => 'unlock' in e));
  assert.ok(keyChoice?.require?.some((r) => 'hasItem' in r && r.hasItem === 'car_keys'), 'needs the keys');
  assert.ok(keyChoice?.effects?.some((e) => 'take' in e && e.take === 'car_keys'), 'takes the keys');
});

test('every checked achievement is a real one; progress counters stay within their targets', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const id of CHECKED_ACHIEVEMENTS) assert.ok(ids.has(id), `check for unknown achievement ${id}`);
  const c = ctx();
  c.stats.fishCaught = 7;
  assert.deepEqual(achievementProgress('dinner_is_served', c), { current: 7, target: 10 });
  c.stats.fishCaught = 400;
  assert.deepEqual(achievementProgress('reel_legend', c), { current: 250, target: 250 });
  assert.equal(achievementProgress('first_catch', c), null);
  assert.equal(achievementProgress('poof', c), null);
});

test('achievements survive a save round trip and a death (only fish are lost, §12.4)', () => {
  const rec = validateSave({
    schemaVersion: 2, id: 's', character: { name: 'A', sex: 'male' }, player: { position: [0, 0, 0], inventory: { slots: [{ id: 'fish_bluegill', count: 3 }, { id: 'rifle', count: 1 }] } }, world: { clock: { day: 3, time: 10 } },
    progress: { achievements: { poof: '2026-09-12T00:00:00.000Z', trailway_robbery: '2026-09-12T00:00:00.000Z' }, stats: { deaths: 1, robberies: 2, hostilesPoofed: 1, boatMetres: 40.5 } },
  });
  assert.ok(rec);
  assert.deepEqual(Object.keys(rec!.progress.achievements).sort(), ['poof', 'trailway_robbery']);
  assert.equal(rec!.progress.stats.robberies, 2);
  assert.equal(rec!.progress.stats.hostilesPoofed, 1);
  assert.equal(rec!.progress.stats.boatMetres, 40.5);
  // a loot bag's contents and the ranger flag survive too
  const rec2 = validateSave({
    schemaVersion: 2, id: 's', character: {}, player: { inventory: {} }, world: { clock: {}, pickups: [{ id: 'p1', itemId: 'loot_bag', count: 1, position: [1, 0, 2], contents: [{ id: 'trophy', count: 1 }, { id: 'nonsense', count: 1 }] }] },
    director: { rangersBoth: true, wanted: 2 },
  });
  assert.ok(rec2);
  assert.deepEqual(rec2!.world.pickups[0]!.contents, [{ id: 'trophy', count: 1 }]);
  assert.equal(rec2!.director.rangersBoth, true);
  assert.equal(rec2!.director.wanted, 2);
});
