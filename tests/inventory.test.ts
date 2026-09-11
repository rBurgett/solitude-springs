import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countItem, createInventory, equipFromSlot, moveSlot, outfitOf, removeItem, splitSlot, stripAll, takeSlot, unequip, TOTAL_SLOTS, removeAllFish } from '../src/sim/inventory.ts';

test('stacking respects per-kind stack sizes and fills existing stacks first', () => {
  const inv = createInventory();
  assert.deepEqual(addItem(inv, { id: 'beer_can', count: 25 }), { added: 25, leftover: 0 });
  assert.equal(inv.slots[0]?.count, 20);
  assert.equal(inv.slots[1]?.count, 5);
  addItem(inv, { id: 'beer_can', count: 3 });
  assert.equal(inv.slots[1]?.count, 8);
  assert.equal(countItem(inv, 'beer_can'), 28);
  addItem(inv, { id: 'tshirt', count: 1, color: '#ff0000' });
  addItem(inv, { id: 'tshirt', count: 1, color: '#ff0000' });
  assert.equal(inv.slots.filter((s) => s?.id === 'tshirt').length, 2);
});

test('a full inventory reports leftovers', () => {
  const inv = createInventory();
  for (let i = 0; i < TOTAL_SLOTS; i++) addItem(inv, { id: 'old_boot', count: 10 });
  assert.deepEqual(addItem(inv, { id: 'old_boot', count: 3 }), { added: 0, leftover: 3 });
  assert.equal(removeItem(inv, 'old_boot', 15), 15);
  assert.equal(countItem(inv, 'old_boot'), TOTAL_SLOTS * 10 - 15);
});

test('full-body clothing occupies top and bottom; displaced garments return to the bag', () => {
  const inv = createInventory();
  addItem(inv, { id: 'tshirt', count: 1, color: '#1aa7a1' });
  addItem(inv, { id: 'pants', count: 1, color: '#2b3350' });
  addItem(inv, { id: 'short_dress', count: 1, color: '#d9407a' });
  assert.ok(equipFromSlot(inv, 0).ok);
  assert.ok(equipFromSlot(inv, 1).ok);
  assert.equal(inv.worn.top?.id, 'tshirt');
  assert.equal(inv.worn.bottom?.id, 'pants');
  const r = equipFromSlot(inv, 2);
  assert.ok(r.ok);
  assert.equal(r.displaced.length, 2);
  const worn = (slot: 'top' | 'bottom' | 'full'): string | undefined => inv.worn[slot]?.id;
  assert.equal(worn('full'), 'short_dress');
  assert.equal(worn('top'), undefined);
  assert.equal(worn('bottom'), undefined);
  assert.equal(countItem(inv, 'tshirt'), 1);
  assert.equal(countItem(inv, 'pants'), 1);
  const shirtSlot = inv.slots.findIndex((s) => s?.id === 'tshirt');
  assert.ok(equipFromSlot(inv, shirtSlot).ok);
  assert.equal(worn('full'), undefined);
  assert.equal(worn('top'), 'tshirt');
  assert.equal(countItem(inv, 'short_dress'), 1);
  const o = outfitOf(inv);
  assert.equal(o.garments.top, 'tshirt');
  assert.equal(o.colors.tshirt, '#1aa7a1');
});

test('equipping swaps in place when the bag is full; unequipping then fails', () => {
  const inv = createInventory();
  addItem(inv, { id: 'tshirt', count: 1 });
  equipFromSlot(inv, 0);
  for (let i = 0; i < TOTAL_SLOTS; i++) addItem(inv, { id: 'old_boot', count: 10 });
  inv.slots[3] = { id: 'polo', count: 1 };
  assert.ok(equipFromSlot(inv, 3).ok);
  assert.equal(inv.worn.top?.id, 'polo');
  assert.equal(countItem(inv, 'tshirt'), 1);
  assert.equal(unequip(inv, 'top'), false);
});

test('the starter rod is bound; the underwear layer is never an item', () => {
  const inv = createInventory();
  addItem(inv, { id: 'old_rod', count: 1 });
  assert.equal(takeSlot(inv, 0), null);
  addItem(inv, { id: 'sundress', count: 1 });
  equipFromSlot(inv, 1);
  const taken = stripAll(inv);
  assert.equal(taken.length, 1);
  assert.deepEqual(inv.worn, {});
});

test('move, split and drop', () => {
  const inv = createInventory();
  addItem(inv, { id: 'glass_bottle', count: 6 });
  assert.ok(splitSlot(inv, 0, 9));
  assert.equal(inv.slots[0]?.count, 3);
  assert.equal(inv.slots[9]?.count, 3);
  moveSlot(inv, 9, 0);
  assert.equal(inv.slots[0]?.count, 6);
  assert.equal(inv.slots[9], null);
  const dropped = takeSlot(inv, 0);
  assert.equal(dropped?.count, 6);
  assert.equal(inv.slots[0], null);
});

test('death removes fish only', () => {
  const inv = createInventory();
  addItem(inv, { id: 'fish_bluegill', count: 3 });
  addItem(inv, { id: 'old_boot', count: 1 });
  assert.equal(removeAllFish(inv), 3);
  assert.equal(countItem(inv, 'old_boot'), 1);
});
