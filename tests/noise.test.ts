import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueNoise2, fbm2, smoothstep } from '../src/world/noise.ts';

test('value noise is deterministic and in [0,1)', () => {
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37 - 40;
    const y = i * 0.11 + 3;
    const a = valueNoise2(x, y, 7);
    assert.equal(a, valueNoise2(x, y, 7));
    assert.ok(a >= 0 && a < 1, `noise ${a} out of range`);
  }
});

test('fbm stays within [-1,1] and differs per seed', () => {
  let same = 0;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.29;
    const y = -i * 0.17;
    const a = fbm2(x, y, 1, 4);
    const b = fbm2(x, y, 2, 4);
    assert.ok(a >= -1 && a <= 1);
    if (Math.abs(a - b) < 1e-9) same++;
  }
  assert.ok(same < 5);
});

test('smoothstep clamps and eases', () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});
