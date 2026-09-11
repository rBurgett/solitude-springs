import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceClock, createClock, phaseOf, clockHours, setClockTime, formatClock, sunFactor, SECONDS_PER_GAME_HOUR } from '../src/sim/clock.ts';
import { TUNABLES } from '../src/data/tunables.ts';

test('phases follow the 2/12/2/8 split and days roll over', () => {
  const c = createClock();
  c.time = 0;
  assert.equal(phaseOf(c), 'dawn');
  c.time = TUNABLES.clock.dawnSeconds + 1;
  assert.equal(phaseOf(c), 'day');
  c.time = TUNABLES.clock.dawnSeconds + TUNABLES.clock.daySeconds + 1;
  assert.equal(phaseOf(c), 'dusk');
  c.time = TUNABLES.clock.dawnSeconds + TUNABLES.clock.daySeconds + TUNABLES.clock.duskSeconds + 1;
  assert.equal(phaseOf(c), 'night');
  const hours = advanceClock(c, TUNABLES.clock.dayLengthSeconds);
  assert.equal(c.day, 2);
  assert.ok(Math.abs(hours - 24) < 1e-9);
  assert.equal(TUNABLES.clock.dawnSeconds + TUNABLES.clock.daySeconds + TUNABLES.clock.duskSeconds + TUNABLES.clock.nightSeconds, TUNABLES.clock.dayLengthSeconds);
});

test('the clock reads 05:00 at dawn and one real minute is one hour', () => {
  const c = createClock();
  c.time = 0;
  assert.deepEqual(clockHours(c), { hour: 5, minute: 0 });
  advanceClock(c, SECONDS_PER_GAME_HOUR * 7.5);
  assert.deepEqual(clockHours(c), { hour: 12, minute: 30 });
  assert.equal(formatClock(c), '12:30 PM');
  assert.ok(setClockTime(c, '23:15'));
  assert.deepEqual(clockHours(c), { hour: 23, minute: 15 });
  assert.equal(phaseOf(c), 'night');
  assert.ok(!setClockTime(c, '25:00'));
  assert.ok(sunFactor(c) < 0);
  setClockTime(c, '12:00');
  assert.ok(sunFactor(c) > 0.9);
});
