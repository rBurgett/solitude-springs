import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { createDirector, tickDirector, onEventStarted, onEventEnded, serenityTick, serenityAfterEvent, serenityAfterHurt, isEligible, pickEvent, candidates, meanGap, pickNpcs, toDirectorSave, fromDirectorSave, recentEvent, type Situation } from '../src/sim/director.ts';
import { EVENT_BY_TYPE } from '../src/data/events.ts';
import { TUNABLES } from '../src/data/tunables.ts';
import { NPCS } from '../src/data/npcs.ts';
import { createMemory } from '../src/sim/npcMemory.ts';

function situation(over: Partial<Situation> = {}): Situation {
  return { phase: 'day', now: 1.3, areaId: 'campground', waterDistance: 5, waterKind: 'river', hasFish: false, inBoat: false, underBridge: false, saveMinutes: 30, lineOut: false, grudgeReady: false, wadingMarshNight: false, ...over };
}

test('serenity rises only when quiet, drops per event class, UFO zeroes it', () => {
  assert.equal(serenityTick(0.5, 3, true), 0.5 + 3 * TUNABLES.serenity.regenPerSecond);
  assert.equal(serenityTick(0.5, 3, false), 0.5);
  assert.equal(serenityTick(0.999, 100, true), 1);
  assert.equal(serenityAfterEvent(0.5, 'minor', 'visit'), 0.5 - TUNABLES.serenity.dropMinor);
  assert.equal(serenityAfterEvent(0.5, 'major', 'thief'), 0.5 - TUNABLES.serenity.dropMajor);
  assert.equal(serenityAfterEvent(0.9, 'major', 'ufo'), 0);
  assert.equal(serenityAfterHurt(0.05), 0);
});

test('eligibility follows the event table conditions', () => {
  const E = (t: string) => EVENT_BY_TYPE.get(t as never)!;
  assert.ok(isEligible(E('visit'), situation({ phase: 'day' })));
  assert.ok(!isEligible(E('visit'), situation({ phase: 'night' })));
  assert.ok(!isEligible(E('waterwalker'), situation({ waterDistance: 40 })));
  assert.ok(!isEligible(E('party'), situation({ areaId: 'marsh' })));
  assert.ok(!isEligible(E('party'), situation({ phase: 'night' })));
  assert.ok(!isEligible(E('bear'), situation({ hasFish: false })));
  assert.ok(isEligible(E('bear'), situation({ hasFish: true })));
  assert.ok(!isEligible(E('bear'), situation({ hasFish: true, inBoat: true })));
  assert.ok(!isEligible(E('gator'), situation({ waterKind: 'pool' })));
  assert.ok(isEligible(E('gator'), situation({ waterKind: 'marsh', waterDistance: 3 })));
  assert.ok(!isEligible(E('ufo'), situation({ saveMinutes: 5 })));
  assert.ok(!isEligible(E('ufo'), situation({ underBridge: true })));
  assert.ok(!isEligible(E('grudge'), situation()));
  assert.ok(isEligible(E('grudge'), situation({ grudgeReady: true })));
  assert.ok(isEligible(E('thief'), situation({ phase: 'night', waterDistance: 500, areaId: null, waterKind: null })));
});

test('cooldowns, concurrency (one active event) and the ranger override', () => {
  const rng = new Rng(5);
  const r = () => rng.next();
  const d = createDirector(true, r);
  const s = situation();
  assert.ok(candidates(d, s).some((e) => e.type === 'visit'));
  onEventStarted(d, 'visit', 1.2);
  assert.equal(tickDirector(d, 1, s, 1, 0.2, r).startEvent, undefined, 'nothing starts while an event is active');
  onEventEnded(d, 'visit', r);
  assert.ok(!candidates(d, s).some((e) => e.type === 'visit'), 'on cooldown after ending');
  d.sessionSeconds += EVENT_BY_TYPE.get('visit')!.cooldownSeconds + 1;
  assert.ok(candidates(d, s).some((e) => e.type === 'visit'), 'cooldown expired');
  d.wanted = TUNABLES.director.rangerWantedThreshold;
  assert.equal(pickEvent(d, s, r), 'ranger');
});

test('grace period and pacing: no events during grace, then gaps that ramp from ~150 s to ~60 s', () => {
  const rng = new Rng(11);
  const r = () => rng.next();
  const d = createDirector(true, r);
  const s = situation({ phase: 'day' });
  let t = 0;
  const starts: number[] = [];
  const dt = 1;
  for (let i = 0; i < 4 * 3600; i++) {
    const day = 1 + Math.floor(t / TUNABLES.clock.dayLengthSeconds);
    const frac = (t % TUNABLES.clock.dayLengthSeconds) / TUNABLES.clock.dayLengthSeconds;
    const intent = tickDirector(d, dt, s, day, frac, r);
    if (intent.startEvent) {
      starts.push(t);
      onEventStarted(d, intent.startEvent, day + frac);
      // events last 20 s in this model
      d.sessionSeconds += 20;
      t += 20;
      onEventEnded(d, intent.startEvent, r);
    }
    t += dt;
  }
  assert.ok(starts[0]! >= TUNABLES.director.graceSecondsNewGame, `first event after grace (${starts[0]})`);
  const early = starts.filter((x) => x < 600);
  const late = starts.filter((x) => x > 3600 && x < 7200);
  const gapsLate = late.slice(1).map((x, i) => x - late[i]!);
  const meanLate = gapsLate.reduce((a, b) => a + b, 0) / gapsLate.length;
  assert.ok(early.length <= 4, `few events early (${early.length})`);
  // ramp target 60 s mean gap + 20 s event + min gaps + lulls: expect a mean gap under ~120 s at full ramp
  assert.ok(meanLate < 130 && meanLate > 50, `late mean gap ${meanLate.toFixed(1)}`);
  assert.equal(meanGap(0), TUNABLES.director.gapMeanStart);
  assert.equal(meanGap(TUNABLES.director.rampSeconds * 2), TUNABLES.director.gapMeanEnd);
});

test('lulls: roughly one per in-game day, 3–6 minutes, no events inside', () => {
  const rng = new Rng(3);
  const r = () => rng.next();
  const d = createDirector(true, r);
  const s = situation();
  let lulls = 0;
  let inLull = false;
  let lullSeconds = 0;
  let eventsInLull = 0;
  const total = TUNABLES.clock.dayLengthSeconds * 5;
  for (let t = 0; t < total; t++) {
    const day = 1 + Math.floor(t / TUNABLES.clock.dayLengthSeconds);
    const frac = (t % TUNABLES.clock.dayLengthSeconds) / TUNABLES.clock.dayLengthSeconds;
    const intent = tickDirector(d, 1, s, day, frac, r);
    if (intent.lullStarted) {
      lulls++;
      inLull = true;
    }
    if (intent.lullEnded) inLull = false;
    if (inLull) lullSeconds++;
    if (intent.startEvent) {
      if (inLull) eventsInLull++;
      onEventStarted(d, intent.startEvent, day + frac);
      onEventEnded(d, intent.startEvent, r);
    }
  }
  assert.ok(lulls >= 3 && lulls <= 6, `lulls over 5 days: ${lulls}`);
  assert.equal(eventsInLull, 0);
  const avg = lullSeconds / lulls;
  assert.ok(avg >= TUNABLES.director.lullMinSeconds - 1 && avg <= TUNABLES.director.lullMaxSeconds + 1, `average lull ${avg}`);
});

test('fishing raises event odds: the line out shortens the wait', () => {
  const rng = new Rng(9);
  const r = () => rng.next();
  const run = (lineOut: boolean): number => {
    const d = createDirector(false, r);
    d.graceUntil = 0;
    d.nextEventAt = 100;
    const s = situation({ lineOut });
    let t = 0;
    while (t < 1000) {
      if (tickDirector(d, 1, s, 1, 0.3, r).startEvent) return t;
      t++;
    }
    return t;
  };
  const idle = run(false);
  const fishing = run(true);
  assert.ok(fishing < idle, `fishing ${fishing} < idle ${idle}`);
  assert.ok(Math.abs(fishing - 100 / TUNABLES.director.fishingOddsMultiplier) < 3);
});

test('npc picks avoid recently seen and poofed npcs; the save round-trips pacing', () => {
  const rng = new Rng(21);
  const r = () => rng.next();
  const pool = NPCS.filter((n) => n.archetypes.includes('camper'));
  const memories: Record<string, ReturnType<typeof createMemory>> = {};
  for (const n of pool) memories[n.id] = createMemory();
  memories.barb!.poofedAt = 2.5; // out of the pool until day 3.5
  memories.mike!.lastSeenDay = 3;
  let barb = 0;
  let mike = 0;
  let others = 0;
  for (let i = 0; i < 400; i++) {
    const [p] = pickNpcs(pool, memories, 3, 3.1, 1, r);
    if (p!.id === 'barb') barb++;
    else if (p!.id === 'mike') mike++;
    else others++;
  }
  assert.equal(barb, 0);
  assert.ok(mike < others / 12, `mike picked ${mike} vs others ${others}`);
  const two = pickNpcs(pool, memories, 3, 3.1, 2, r);
  assert.equal(two.length, 2);
  assert.notEqual(two[0]!.id, two[1]!.id);
  const d = createDirector(true, r);
  d.sessionSeconds = 500;
  d.wanted = 1;
  d.cooldowns.party = 900;
  d.recent.ufo = 1.2;
  const saved = toDirectorSave(d);
  assert.equal(saved.cooldownsRemaining.party, 400);
  const back = fromDirectorSave(JSON.parse(JSON.stringify(saved)), r);
  assert.equal(back.sessionSeconds, 500);
  assert.equal(back.cooldowns.party, 900);
  assert.equal(back.wanted, 1);
  assert.ok(recentEvent(back, 'ufo', 1.9));
  assert.ok(!recentEvent(back, 'ufo', 2.5));
  assert.ok(back.graceUntil >= 500 + TUNABLES.director.graceSecondsAfterLoad - 1);
});
