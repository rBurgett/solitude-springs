import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTerrain } from '../src/world/terrain.ts';

test('buildTerrain samples heights on the grid and interpolates between vertices', () => {
  const t = buildTerrain({ size: 8, sample: (x, z) => ({ height: x * 0.5 + z * 0.25, splat: [1, 0, 0, 0] }) }, 1, 16);
  assert.equal(t.resolution, 9);
  assert.ok(Math.abs(t.heightAt(2, 2) - 1.5) < 1e-6);
  assert.ok(Math.abs(t.heightAt(1.5, -0.5) - (0.75 - 0.125)) < 1e-6);
  const n = t.normalAt(0, 0);
  assert.ok(n.y > 0.8 && n.x < 0 && n.z < 0, 'normal should lean against the slope');
});

test('paintTrash writes a soft disc into the mask', () => {
  const t = buildTerrain({ size: 8, sample: () => ({ height: 0, splat: [1, 0, 0, 0] }) }, 1, 32);
  t.paintTrash(0, 0, 2, 1);
  const data = t.trashMask.image.data as Uint8Array;
  const at = (x: number, z: number): number => data[Math.floor((z + 4) / 8 * 32) * 32 + Math.floor((x + 4) / 8 * 32)] as number;
  assert.ok(at(0, 0) > 250, 'centre fully trashed');
  assert.equal(at(3.5, 3.5), 0, 'outside untouched');
});
