import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { categoryShares, eligibleFish, rollCatch, rollWeight, speciesWeight, biteWindowFor, type CatchContext } from '../src/sim/catchTable.ts';
import { fishDef, FISH } from '../src/data/fish.ts';
import { ITEMS, itemDef } from '../src/data/items.ts';

function ctx(rng: Rng, over: Partial<CatchContext> = {}): CatchContext {
  return { water: 'river', phase: 'day', population: 1, trash: 0, ufoRecent: false, legendReady: false, luckyLure: false, rng: () => rng.next(), ...over };
}

test('category shares sum to one and shift toward junk with low population; trashed zones are junk only', () => {
  const full = categoryShares(1, 0);
  assert.ok(Math.abs(full.fish + full.junk + full.clothing + full.weapon - 1) < 1e-9);
  const low = categoryShares(0.25, 0);
  assert.ok(low.fish < full.fish && low.junk > full.junk);
  assert.ok(Math.abs(low.fish + low.junk + low.clothing + low.weapon - 1) < 1e-9);
  assert.deepEqual(categoryShares(1, 0.6), { fish: 0, junk: 1, clothing: 0, weapon: 0 });
});

test('species filter by water, time and special conditions', () => {
  const dayRiver = eligibleFish({ water: 'river', phase: 'day', ufoRecent: false, legendReady: false }).map((f) => f.id);
  assert.ok(dayRiver.includes('bluegill') && dayRiver.includes('chain_pickerel'));
  assert.ok(!dayRiver.includes('channel_catfish') && !dayRiver.includes('longnose_gar'));
  const nightMarsh = eligibleFish({ water: 'marsh', phase: 'night', ufoRecent: false, legendReady: false }).map((f) => f.id);
  assert.ok(nightMarsh.includes('alligator_gar') && nightMarsh.includes('channel_catfish'));
  assert.ok(!nightMarsh.includes('glowing_perch'));
  assert.ok(eligibleFish({ water: 'marsh', phase: 'night', ufoRecent: true, legendReady: false }).some((f) => f.id === 'glowing_perch'));
  const pool = eligibleFish({ water: 'pool', phase: 'day', ufoRecent: false, legendReady: false }).map((f) => f.id);
  assert.ok(!pool.includes('old_gus'));
  assert.ok(eligibleFish({ water: 'pool', phase: 'day', ufoRecent: false, legendReady: true }).some((f) => f.id === 'old_gus'));
  assert.ok(!eligibleFish({ water: 'river', phase: 'day', ufoRecent: false, legendReady: true }).some((f) => f.id === 'old_gus'));
});

test('bass bite better at dawn/dusk and the lucky lure boosts rare fish', () => {
  const bass = fishDef('largemouth_bass');
  assert.equal(speciesWeight(bass, { phase: 'dusk', luckyLure: false }), speciesWeight(bass, { phase: 'day', luckyLure: false }) * 2);
  const gar = fishDef('longnose_gar');
  assert.ok(speciesWeight(gar, { phase: 'day', luckyLure: true }) > speciesWeight(gar, { phase: 'day', luckyLure: false }));
  assert.equal(speciesWeight(fishDef('bluegill'), { phase: 'day', luckyLure: true }), speciesWeight(fishDef('bluegill'), { phase: 'day', luckyLure: false }));
});

test('weights stay within the species range and skew low', () => {
  const gus = fishDef('old_gus');
  assert.equal(rollWeight(gus, 0), gus.minLb);
  assert.equal(rollWeight(gus, 1), gus.maxLb);
  assert.ok(rollWeight(gus, 0.5) < (gus.minLb + gus.maxLb) / 2);
});

test('rolled catches are valid items or fish with sane windows over many rolls', () => {
  const rng = new Rng(2024);
  const counts = { fish: 0, item: 0 };
  for (let i = 0; i < 3000; i++) {
    const c = rollCatch(ctx(rng, { water: 'marsh', phase: 'night' }));
    if (c.kind === 'fish') {
      counts.fish++;
      const f = fishDef(c.fishId);
      assert.ok(c.weightLb >= f.minLb && c.weightLb <= f.maxLb);
      assert.ok(biteWindowFor(c) >= 1.5 && biteWindowFor(c) <= 3);
    } else {
      counts.item++;
      assert.ok(itemDef(c.itemId));
      if (itemDef(c.itemId).kind === 'clothing') assert.ok(c.color === undefined || /^#[0-9a-f]{6}$/i.test(c.color));
    }
  }
  assert.ok(counts.fish / 3000 > 0.62 && counts.fish / 3000 < 0.82, `fish share ${counts.fish / 3000}`);
  let cans = 0;
  for (let i = 0; i < 500; i++) {
    const c = rollCatch(ctx(rng, { trash: 0.9 }));
    assert.equal(c.kind, 'item');
    if (c.kind === 'item' && c.itemId === 'beer_can') cans++;
  }
  assert.ok(cans > 200);
});

test('data integrity: every fish has an item, clothing garments and palettes exist, 13 species', () => {
  assert.equal(FISH.length, 13);
  for (const f of FISH) assert.ok(itemDef(`fish_${f.id}`));
  for (const it of ITEMS) {
    if (it.kind === 'clothing') {
      assert.ok(it.slot && it.garment, it.id);
      assert.ok(it.palette && it.palette.length > 0, it.id);
    }
    assert.ok(it.stack >= 1 && it.value >= 0);
  }
  const ids = new Set(ITEMS.map((i) => i.id));
  assert.equal(ids.size, ITEMS.length);
});
