import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalValue, offerValue, dealThreshold, evaluateTrade, isJunkForTreasure, matchesTag } from '../src/sim/trading.ts';
import { npcDef } from '../src/data/npcs.ts';
import { itemDef } from '../src/data/items.ts';
import { TUNABLES } from '../src/data/tunables.ts';

test('personal valuation: wants ×2, favourite ×3, dislikes ×0.25, refuses null, bound null', () => {
  const kai = npcDef('kai').trading!;
  assert.equal(personalValue(kai, 'old_boot'), itemDef('old_boot').value * TUNABLES.trade.favoriteMultiplier);
  assert.equal(personalValue(kai, 'garden_gnome'), itemDef('garden_gnome').value * TUNABLES.trade.wantMultiplier);
  assert.equal(personalValue(kai, 'handgun'), itemDef('handgun').value * TUNABLES.trade.dislikeMultiplier);
  assert.equal(personalValue(kai, 'fish_bluegill'), null);
  assert.equal(personalValue(kai, 'old_rod'), null);
  assert.ok(matchesTag('sneakers', 'slot:shoes'));
  assert.ok(matchesTag('beer_can', 'kind:can'));
});

test('the deal rule and moods', () => {
  const barb = npcDef('barb').trading!;
  const theirs = [{ id: 'lucky_lure', count: 1 }];
  const threshold = dealThreshold(barb, theirs, 0);
  assert.equal(threshold, itemDef('lucky_lure').value * (1 + barb.greed));
  assert.ok(dealThreshold(barb, theirs, 50) < threshold, 'relationship lowers the ask');
  const bad = evaluateTrade(barb, [{ id: 'glass_bottle', count: 1 }], theirs, 0);
  assert.equal(bad.ok, false);
  assert.equal(bad.mood, 'no');
  const good = evaluateTrade(barb, [{ id: 'fish_bluegill', count: 3 }], theirs, 0);
  assert.ok(good.ok);
  assert.ok(good.mood === 'yes' || good.mood === 'love');
  const refused = evaluateTrade(barb, [{ id: 'beer_can', count: 5 }], theirs, 0);
  assert.equal(refused.mood, 'refuse');
  assert.equal(offerValue(barb, [{ id: 'beer_can', count: 1 }]), null);
  assert.equal(evaluateTrade(barb, [], [], 0).mood, 'empty');
  assert.ok(isJunkForTreasure([{ id: 'old_boot', count: 1 }], [{ id: 'lucky_lure', count: 1 }]));
  assert.ok(!isJunkForTreasure([{ id: 'fish_bluegill', count: 1 }], [{ id: 'lucky_lure', count: 1 }]));
});
