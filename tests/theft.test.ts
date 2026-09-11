import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { createInventory, addItem, equipFromSlot, countItem } from '../src/sim/inventory.ts';
import { executeTheft, inUnderwear } from '../src/sim/theft.ts';
import { npcDef } from '../src/data/npcs.ts';
import { rollAbductionOutfit, applyAbductionOutfit } from '../src/sim/ufo.ts';
import { itemDef, ODD_CLOTHING } from '../src/data/items.ts';
import { createHealth, damage, tickHealth, heal } from '../src/sim/health.ts';
import { TUNABLES } from '../src/data/tunables.ts';
import { createMemory, addStolen, takeStolenBack, markPoofed, isOutOfPool, grudgeReady, hasStolenLoot } from '../src/sim/npcMemory.ts';

function dressed(): ReturnType<typeof createInventory> {
  const inv = createInventory();
  addItem(inv, { id: 'old_rod', count: 1 });
  for (const id of ['tshirt', 'pants', 'sneakers']) {
    addItem(inv, { id, count: 1 });
    equipFromSlot(inv, inv.slots.findIndex((s) => s?.id === id));
  }
  return inv;
}

test('a thief takes 1–4 valued items, never the starter rod', () => {
  const rng = new Rng(2);
  for (let i = 0; i < 50; i++) {
    const inv = dressed();
    addItem(inv, { id: 'fish_bluegill', count: 4 });
    addItem(inv, { id: 'lucky_lure', count: 1 });
    addItem(inv, { id: 'beer_can', count: 6 });
    const plan = executeTheft(inv, npcDef('pete'), () => rng.next());
    assert.ok(plan.taken.length >= 1 && plan.taken.length <= 4, `took ${plan.taken.length}`);
    assert.ok(!plan.taken.some((t) => t.id === 'old_rod'));
    assert.equal(countItem(inv, 'old_rod'), 1);
    assert.equal(plan.stripped.length, 0);
    assert.ok(!plan.barrel);
  }
});

test('nothing they want → the clothes come off; already in underwear → the barrel', () => {
  const rng = new Rng(8);
  const inv = dressed();
  const plan = executeTheft(inv, npcDef('pete'), () => rng.next());
  assert.equal(plan.taken.length, 0);
  assert.deepEqual(plan.stripped.map((s) => s.id).sort(), ['pants', 'sneakers', 'tshirt']);
  assert.ok(inUnderwear(inv));
  assert.equal(countItem(inv, 'old_rod'), 1);
  const again = executeTheft(inv, npcDef('earl'), () => rng.next());
  assert.ok(again.barrel);
  assert.equal(again.stripped.length, 0);
});

test('Ricky only takes shoes and leaves empty-handed otherwise', () => {
  const rng = new Rng(1);
  const inv = dressed();
  addItem(inv, { id: 'lucky_lure', count: 1 });
  addItem(inv, { id: 'handgun', count: 1 });
  const plan = executeTheft(inv, npcDef('ricky'), () => rng.next());
  assert.equal(plan.taken.length, 0, 'no loose shoes in the bag');
  assert.deepEqual(plan.stripped.map((s) => s.id), ['sneakers'], 'takes the worn shoes');
  assert.ok(inv.worn.top && inv.worn.bottom, 'shirt and pants stay');
  const barefoot = executeTheft(inv, npcDef('ricky'), () => rng.next());
  assert.ok(barefoot.nothing);
  assert.equal(countItem(inv, 'handgun'), 1);
});

test('the abduction outfit favours odd pieces and replaces everything worn', () => {
  const rng = new Rng(77);
  let withOdd = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const outfit = rollAbductionOutfit(() => rng.next());
    if (outfit.some((s) => ODD_CLOTHING.includes(s.id))) withOdd++;
    for (const s of outfit) assert.equal(itemDef(s.id).kind, 'clothing');
    const slots = outfit.map((s) => itemDef(s.id).slot);
    assert.ok(slots.includes('full') || (slots.includes('top') && slots.includes('bottom')));
    assert.ok(slots.includes('shoes'));
  }
  assert.ok(withOdd / N > 0.7, `outfits with an odd piece ${(withOdd / N).toFixed(2)}`);
  const inv = dressed();
  const kept = applyAbductionOutfit(inv, [{ id: 'jumpsuit', count: 1 }, { id: 'flats', count: 1 }, { id: 'tinfoil_hat', count: 1 }]);
  assert.deepEqual(kept.map((k) => k.id).sort(), ['pants', 'sneakers', 'tshirt']);
  assert.equal(inv.worn.full?.id, 'jumpsuit');
  assert.equal(inv.worn.top, undefined);
  assert.equal(inv.worn.hat?.id, 'tinfoil_hat');
});

test('health: damage in half hearts, regen after the quiet delay, death at zero', () => {
  const h = createHealth();
  assert.equal(damage(h, 2), false);
  assert.equal(h.hearts, 3);
  tickHealth(h, TUNABLES.health.regenDelaySeconds - 1);
  assert.equal(h.hearts, 3, 'no regen before the delay');
  tickHealth(h, 1 + TUNABLES.health.regenHalfHeartSeconds);
  assert.equal(h.hearts, 3.5);
  tickHealth(h, TUNABLES.health.regenHalfHeartSeconds * 10);
  assert.equal(h.hearts, TUNABLES.health.maxHearts);
  heal(h, 5);
  assert.equal(h.hearts, TUNABLES.health.maxHearts);
  assert.equal(damage(h, 99), true);
  assert.equal(h.hearts, 0);
});

test('npc memory: stolen ledger, poof return window, grudge readiness', () => {
  const m = createMemory();
  addStolen(m, [{ id: 'lucky_lure', count: 1 }, { id: 'fish_bluegill', count: 2 }]);
  assert.ok(hasStolenLoot(m));
  assert.equal(m.inventory.length, 2);
  const back = takeStolenBack(m);
  assert.equal(back.length, 2);
  assert.equal(m.inventory.length, 0);
  assert.ok(!hasStolenLoot(m));
  markPoofed(m, 2.5, true);
  assert.ok(m.grudge);
  assert.ok(isOutOfPool(m, 2.9));
  assert.ok(!isOutOfPool(m, 2.5 + TUNABLES.events.poofReturnDays + 0.01));
  m.lastSeenDay = 2;
  assert.ok(!grudgeReady(m, 2));
  assert.ok(grudgeReady(m, 2 + TUNABLES.events.grudgeReturnDays));
});
