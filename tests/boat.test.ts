import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, stepBoat, canCastFromBoat, seatPosition } from '../src/sim/boat.ts';
import { TUNABLES } from '../src/data/tunables.ts';

const B = TUNABLES.boat;
/** A channel 6 m wide around x = 0, deep in the middle, dry beyond. */
const depthAt = (x: number): number => (Math.abs(x) < 3 ? 2.4 : 0);

test('rowing forward and back accelerates toward the row speeds, drag slows the boat, distance accumulates', () => {
  const b = createBoat(0, 0, 0);
  for (let i = 0; i < 60; i++) stepBoat(b, { forward: 1, turn: 0 }, 1 / 30, depthAt);
  assert.ok(b.speed > B.rowSpeed * 0.8 && b.speed <= B.rowSpeed, `rowing up to speed (${b.speed.toFixed(2)})`);
  assert.ok(b.z > 3, 'moved forward along +z');
  assert.ok(b.distance > 3);
  assert.ok(!canCastFromBoat(b), 'no casting while under way');
  for (let i = 0; i < 120; i++) stepBoat(b, { forward: 0, turn: 0 }, 1 / 30, depthAt);
  assert.ok(Math.abs(b.speed) < 0.01, 'drag stops the boat');
  assert.ok(canCastFromBoat(b));
  for (let i = 0; i < 60; i++) stepBoat(b, { forward: -1, turn: 0 }, 1 / 30, depthAt);
  assert.ok(b.speed < 0 && Math.abs(b.speed) <= B.reverseSpeed + 1e-6, 'reverse is slower');
});

test('one oar turns the boat, even from a standstill', () => {
  const b = createBoat(0, 0, 0);
  for (let i = 0; i < 30; i++) stepBoat(b, { forward: 0, turn: 1 }, 1 / 30, depthAt);
  assert.ok(Math.abs(b.yaw) > 0.5, `turned (${b.yaw.toFixed(2)})`);
  assert.equal(b.x, 0);
  assert.equal(b.z, 0);
});

test('the hull needs the minimum depth under bow and stern: shallow water stops it', () => {
  const b = createBoat(0, 0, Math.PI / 2); // facing +x, toward the bank at x = 3
  let bumped = false;
  for (let i = 0; i < 200; i++) if (stepBoat(b, { forward: 1, turn: 0 }, 1 / 30, depthAt).bumped) bumped = true;
  assert.ok(bumped, 'it bumps the shallows');
  assert.ok(b.x < 3 - B.hullRadius + 0.01, `the bow stays in deep water (x=${b.x.toFixed(2)})`);
  assert.ok(depthAt(b.x + B.hullRadius) >= TUNABLES.water.boatMinDepth || b.x + B.hullRadius <= 3);
});

test('the rower sits at the seat height above the water', () => {
  const b = createBoat(4, -2, 1);
  assert.deepEqual(seatPosition(b), { x: 4, y: B.seatHeight, z: -2 });
});
