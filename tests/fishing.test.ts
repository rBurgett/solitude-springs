import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { createFishing, startCharge, releaseCast, landedOnWater, landedOnGround, reelPressed, updateFishing, autoReel, rollBiteDelay, castDistance, lineOut, triangular } from '../src/sim/fishing.ts';
import type { CatchContext } from '../src/sim/catchTable.ts';
import { TUNABLES } from '../src/data/tunables.ts';

function ctx(rng: Rng, over: Partial<CatchContext> = {}): CatchContext {
  return { water: 'river', phase: 'day', population: 1, trash: 0, ufoRecent: false, legendReady: false, luckyLure: false, rng: () => rng.next(), ...over };
}

test('bite delays follow the tunable distribution and population rules', () => {
  const rng = new Rng(1);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const n = 5000;
  for (let i = 0; i < n; i++) {
    const d = rollBiteDelay(1, () => rng.next());
    min = Math.min(min, d);
    max = Math.max(max, d);
    sum += d;
  }
  assert.ok(min >= TUNABLES.bite.delayMinSeconds && max <= TUNABLES.bite.delayMaxSeconds);
  const mean = sum / n;
  const expected = (TUNABLES.bite.delayMinSeconds + TUNABLES.bite.delayMaxSeconds + TUNABLES.bite.delayModeSeconds) / 3;
  assert.ok(Math.abs(mean - expected) < 2, `mean ${mean} vs ${expected}`);
  const slow = rollBiteDelay(0.2, () => 0.5);
  const normal = rollBiteDelay(0.8, () => 0.5);
  assert.equal(slow, normal * TUNABLES.bite.lowPopulationDelayMultiplier);
  assert.equal(rollBiteDelay(0, () => 0.5), Infinity);
  assert.ok(triangular(0, 10, 5, 0.5) > 4.9 && triangular(0, 10, 5, 0.5) < 5.1);
});

test('charge, cast, wait, bite, reel: a full catch', () => {
  const rng = new Rng(42);
  const s = createFishing();
  assert.ok(startCharge(s));
  updateFishing(s, 0.75, null);
  assert.ok(Math.abs(s.charge - 0.5) < 1e-6);
  const cast = releaseCast(s)!;
  assert.equal(cast.type, 'cast');
  assert.ok(cast.type === 'cast' && Math.abs(cast.distance - castDistance(0.5)) < 1e-9);
  landedOnWater(s, ctx(rng));
  assert.equal(s.phase, 'waiting');
  assert.ok(lineOut(s));
  const events: string[] = [];
  let t = 0;
  while (s.phase === 'waiting' && t < 200) {
    events.push(...updateFishing(s, 0.1, ctx(rng)).map((e) => e.type));
    t += 0.1;
  }
  assert.equal(s.phase, 'bite');
  assert.ok(events.includes('bite'));
  assert.ok(t >= TUNABLES.bite.delayMinSeconds - 0.2);
  const reel = reelPressed(s)!;
  assert.equal(reel.type, 'reelStart');
  let landed = null;
  for (let i = 0; i < 40 && !landed; i++) landed = updateFishing(s, 0.1, ctx(rng)).find((e) => e.type === 'landed');
  assert.ok(landed && landed.type === 'landed' && landed.result === 'caught' && landed.catch);
  assert.equal(s.phase, 'idle');
});

test('missing the window leaves the line out and rolls a new wait; reeling early retrieves empty', () => {
  const rng = new Rng(7);
  const s = createFishing();
  startCharge(s);
  releaseCast(s);
  landedOnWater(s, ctx(rng));
  s.biteAt = 1;
  s.nibbleTimes = [];
  updateFishing(s, 1.1, ctx(rng));
  assert.equal(s.phase, 'bite');
  const ev = updateFishing(s, s.window + 0.01, ctx(rng));
  assert.ok(ev.some((e) => e.type === 'missed'));
  assert.equal(s.phase, 'waiting');
  assert.equal(s.missedStreak, 1);
  assert.ok(lineOut(s));
  const r = reelPressed(s)!;
  assert.ok(r.type === 'reelStart' && r.result === 'empty');
  let landed = null;
  for (let i = 0; i < 40 && !landed; i++) landed = updateFishing(s, 0.1, ctx(rng)).find((e) => e.type === 'landed');
  assert.ok(landed && landed.type === 'landed' && landed.result === 'empty' && landed.catch === null);
});

test('hitting ground thunks and auto-reels; pausing freezes the bite timer; auto-reel works from any phase', () => {
  const rng = new Rng(3);
  const s = createFishing();
  startCharge(s);
  releaseCast(s);
  const ev = landedOnGround(s);
  assert.ok(ev.some((e) => e.type === 'thunk'));
  assert.equal(s.phase, 'reeling');
  const s2 = createFishing();
  startCharge(s2);
  releaseCast(s2);
  landedOnWater(s2, ctx(rng));
  const before = s2.timer;
  updateFishing(s2, 5, ctx(rng), true);
  assert.equal(s2.timer, before);
  autoReel(s2);
  assert.equal(s2.phase, 'reeling');
  const s3 = createFishing();
  startCharge(s3);
  autoReel(s3);
  assert.equal(s3.phase, 'idle');
});

test('an empty zone never bites', () => {
  const rng = new Rng(9);
  const s = createFishing();
  startCharge(s);
  releaseCast(s);
  landedOnWater(s, ctx(rng, { population: 0 }));
  updateFishing(s, 1000, ctx(rng, { population: 0 }));
  assert.equal(s.phase, 'waiting');
  assert.equal(s.pending, null);
});
