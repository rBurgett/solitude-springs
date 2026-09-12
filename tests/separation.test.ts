import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOverlaps } from '../src/sim/separation.ts';

test('separation: two people on the same spot end up a full separation apart', () => {
  const d = resolveOverlaps([{ x: 3, z: 3, movable: true }, { x: 3, z: 3, movable: true }], 0.9);
  const ax = 3 + d[0]!.dx, bx = 3 + d[1]!.dx;
  assert.ok(Math.abs(Math.hypot(bx - ax, d[1]!.dz - d[0]!.dz) - 0.9) < 1e-9);
  assert.ok(Math.abs(d[0]!.dx + d[1]!.dx) < 1e-9, 'symmetric');
});

test('separation: an unmovable body stays put and the other takes the whole push', () => {
  const d = resolveOverlaps([{ x: 0, z: 0, movable: false }, { x: 0.3, z: 0, movable: true }], 0.9);
  assert.deepEqual(d[0], { dx: 0, dz: 0 });
  assert.ok(Math.abs(d[1]!.dx - 0.6) < 1e-9);
});

test('separation: people already apart are not touched', () => {
  const d = resolveOverlaps([{ x: 0, z: 0, movable: true }, { x: 0, z: 2, movable: true }, { x: 5, z: 5, movable: true }], 0.9);
  assert.ok(d.every((v) => v.dx === 0 && v.dz === 0));
});
