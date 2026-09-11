import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashString, hash2i } from '../src/core/rng.ts';

test('Rng is deterministic for a seed and restorable from its state', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const state = a.getState();
  const x = a.next();
  const c = new Rng(0);
  c.setState(state);
  assert.equal(c.next(), x);
});

test('Rng ranges stay inside their bounds', () => {
  const r = new Rng(7);
  for (let i = 0; i < 2000; i++) {
    const v = r.int(3, 9);
    assert.ok(v >= 3 && v <= 9 && Number.isInteger(v));
    const t = r.triangular(15, 90, 40);
    assert.ok(t >= 15 && t <= 90);
    const f = r.range(-1, 1);
    assert.ok(f >= -1 && f < 1);
  }
});

test('weighted pick never returns a zero-weight item', () => {
  const r = new Rng(99);
  const items = [
    { id: 'a', w: 0 },
    { id: 'b', w: 5 },
    { id: 'c', w: 1 },
  ];
  const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) counts[r.weighted(items, (it) => it.w).id]!++;
  assert.equal(counts.a, 0);
  assert.ok(counts.b! > counts.c! * 3);
});

test('hashes are stable', () => {
  assert.equal(hashString('barb_kowalski'), hashString('barb_kowalski'));
  assert.notEqual(hashString('barb_kowalski'), hashString('barb_kowalskj'));
  assert.equal(hash2i(3, -4, 42), hash2i(3, -4, 42));
});
