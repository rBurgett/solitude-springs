import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { TUNABLES } from '../src/data/tunables.ts';
import { npcDef } from '../src/data/npcs.ts';
import { createCombatant, attack, aimTick, aimBroken, reactionFor, applyReaction, canDamage, createWeaponState, pullTrigger, tickWeapon, hostileTick, hostileDamage, hostileHits, wantedForRobbery, wantedForFight, wantedForPoof, robbery, robbable, surrenderLoot, poofLoot, bestWeapon, mostValuable, deathLosses, resetEngagement } from '../src/sim/confrontation.ts';
import { createMemory, addStolen } from '../src/sim/npcMemory.ts';
import { createInventory, addItem, countItem } from '../src/sim/inventory.ts';
import { createDirector, pickEvent, type Situation } from '../src/sim/director.ts';

const C = TUNABLES.confrontation;

test('weapons never damage an Innocent or an animal; Threatening and Hostile take the table damage', () => {
  const barb = createCombatant(npcDef('barb'));
  for (const w of ['pocket_knife', 'handgun', 'rifle'] as const) {
    assert.deepEqual(attack(barb, w), { outcome: 'blocked' });
    assert.equal(barb.hp, C.npcHitPoints, 'an innocent keeps every hit point');
  }
  assert.ok(!canDamage('bear'));
  assert.ok(!canDamage('gator'));
  assert.ok(!canDamage('npc', barb));
  // a thief mid-theft is Threatening: knife 2 hits, handgun 2 shots, rifle 1
  const knife = createCombatant(npcDef('pete'), 'threatening');
  assert.equal(attack(knife, 'pocket_knife').outcome, 'hit');
  assert.ok(knife.retreating, 'down to 1: they run');
  assert.equal(attack(knife, 'pocket_knife').outcome, 'poof');
  const gun = createCombatant(npcDef('pete'), 'threatening');
  assert.equal(attack(gun, 'handgun').outcome, 'hit');
  assert.equal(attack(gun, 'handgun').outcome, 'poof');
  const rifle = createCombatant(npcDef('wade'), 'hostile');
  assert.ok(canDamage('npc', rifle));
  assert.equal(attack(rifle, 'rifle').outcome, 'poof');
});

test('aiming 1.5 s triggers one reaction: unarmed innocents hands up, armed innocents draw, unarmed thieves surrender', () => {
  const barb = createCombatant(npcDef('barb'));
  let fired = 0;
  for (let i = 0; i < 40; i++) if (aimTick(barb, 0.1)) fired++;
  assert.equal(fired, 1, 'the reaction fires once');
  assert.equal(reactionFor(barb), 'hands_up');
  const wade = createCombatant(npcDef('wade'));
  aimTick(wade, C.aimReactSeconds);
  assert.equal(reactionFor(wade), 'hostile');
  applyReaction(wade, 'hostile');
  assert.equal(wade.stance, 'hostile');
  assert.equal(reactionFor(wade), 'none');
  const candy = createCombatant(npcDef('candy'), 'threatening');
  assert.equal(reactionFor(candy), 'surrender');
  const earl = createCombatant(npcDef('earl'), 'threatening');
  assert.equal(reactionFor(earl), 'hostile', 'an armed thief fights');
  // looking away before the threshold restarts the timer; a finished engagement can be re-armed
  const t = createCombatant(npcDef('trent'));
  aimTick(t, 1.0);
  aimBroken(t);
  assert.equal(t.aimSeconds, 0);
  aimTick(t, 1.5);
  assert.ok(t.reacted);
  resetEngagement(t);
  assert.ok(!t.reacted && t.aimSeconds === 0);
});

test('the trigger: rounds are needed, a reload follows every 8 handgun / 5 rifle shots, the knife always swings', () => {
  const w = createWeaponState();
  assert.deepEqual(pullTrigger(w, 'handgun', 0), { ok: false, reason: 'empty' });
  let reloads = 0;
  for (let i = 0; i < C.reloadEvery.handgun; i++) {
    const r = pullTrigger(w, 'handgun', 50);
    assert.ok(r.ok);
    if (r.ok && r.reload) reloads++;
  }
  assert.equal(reloads, 1, 'the eighth shot starts a reload');
  assert.deepEqual(pullTrigger(w, 'handgun', 50), { ok: false, reason: 'reloading' });
  tickWeapon(w, C.reloadSeconds);
  assert.ok(pullTrigger(w, 'handgun', 50).ok);
  const r = createWeaponState();
  let rifleReloads = 0;
  for (let i = 0; i < C.reloadEvery.rifle; i++) {
    const x = pullTrigger(r, 'rifle', 10);
    if (x.ok && x.reload) rifleReloads++;
  }
  assert.equal(rifleReloads, 1);
  const k = createWeaponState();
  for (let i = 0; i < 30; i++) assert.deepEqual(pullTrigger(k, 'pocket_knife', 0), { ok: true, reload: false });
});

test('hostile AI: approach, attack on a timer, retreat at 1 hp; damage table and bad aim', () => {
  const wade = createCombatant(npcDef('wade'), 'hostile');
  assert.equal(hostileTick(wade, 0.1, 30), 'approach');
  assert.equal(hostileTick(wade, 0.1, 5), 'hold', 'the first attack waits');
  let attacks = 0;
  for (let i = 0; i < 100; i++) if (hostileTick(wade, 0.1, 5) === 'attack') attacks++;
  assert.ok(attacks >= 3 && attacks <= 5, `about one shot per ${C.shotSeconds} s (got ${attacks} in 10 s)`);
  attack(wade, 'handgun');
  assert.equal(hostileTick(wade, 0.1, 5), 'retreat');
  const chad = createCombatant(npcDef('chad'), 'hostile');
  assert.equal(hostileTick(chad, 0.1, 4), 'approach', 'a knife needs to be close');
  assert.equal(hostileDamage('none'), C.hostileHits.punch);
  assert.equal(hostileDamage('knife'), C.hostileHits.knife);
  assert.equal(hostileDamage('handgun'), C.hostileHits.handgun);
  assert.equal(hostileDamage('rifle'), C.hostileHits.rifle);
  const rng = new Rng(5);
  let hits = 0;
  for (let i = 0; i < 2000; i++) if (hostileHits('rifle', () => rng.next())) hits++;
  assert.ok(Math.abs(hits / 2000 - C.hostileAccuracy) < 0.05, `accuracy ~${C.hostileAccuracy} (got ${hits / 2000})`);
  assert.ok(hostileHits('knife', () => 0.99), 'melee in reach always lands');
});

test('wanted: robbing an innocent +1, a fight +0.5, poofing a hostile 0, poofing a ranger +2; the ranger is forced at 2', () => {
  assert.equal(wantedForRobbery('innocent'), C.wantedRobbery);
  assert.equal(wantedForRobbery('threatening'), 0, 'robbing a thief back is free');
  assert.equal(wantedForFight(true), C.wantedFight);
  assert.equal(wantedForFight(false), 0);
  assert.equal(wantedForPoof(npcDef('wade')), 0);
  assert.equal(wantedForPoof(npcDef('rhonda')), C.wantedRangerPoof);
  const rng = new Rng(1);
  const d = createDirector(false, () => rng.next());
  const s: Situation = { phase: 'day', now: 1.5, areaId: 'campground', waterDistance: 5, waterKind: 'river', hasFish: false, inBoat: false, underBridge: false, saveMinutes: 30, lineOut: false, grudgeReady: false, wadingMarshNight: false };
  d.wanted = C.wantedRobbery * 2;
  assert.equal(pickEvent(d, s, () => rng.next()), 'ranger');
  d.wanted = 1;
  assert.notEqual(pickEvent(d, s, () => rng.next()), 'ranger');
});

test('robbery outcomes: one item, everything (≤3), just kidding; grudges, relationship and the stolen ledger', () => {
  const rng = new Rng(3);
  const mem = createMemory();
  mem.inventory.push({ id: 'granola_bar', count: 2 }, { id: 'lucky_lure', count: 1 }, { id: 'bandage', count: 1 }, { id: 'glass_bottle', count: 1 });
  const list = robbable(mem);
  assert.equal(list[0]!.stack.id, 'lucky_lure', 'most valuable first');
  const one = robbery(mem, 'innocent', { kind: 'one', index: list[0]!.index }, () => rng.next());
  assert.deepEqual(one.taken, [{ id: 'lucky_lure', count: 1 }]);
  assert.equal(one.wanted, C.wantedRobbery);
  assert.equal(mem.relationship, C.robOneRelationship);
  assert.ok(mem.grudge && mem.robbed === 1);
  assert.equal(mem.flags.robbedGreeted, false);
  const all = robbery(mem, 'innocent', { kind: 'all' }, () => rng.next());
  assert.equal(all.taken.length, Math.min(C.robAllMaxItems, 3));
  assert.equal(mem.inventory.length, 0);
  const kidding = robbery(createMemory(), 'innocent', { kind: 'kidding' }, () => rng.next());
  assert.equal(kidding.wanted, 0);
  assert.equal(kidding.relationship, C.kiddingRelationship);
  assert.equal(kidding.taken.length, 0);
  const leave = robbery(createMemory(), 'innocent', { kind: 'leave' }, () => rng.next());
  assert.equal(leave.wanted, 0);
  // robbing a thief back recovers what they stole and costs no wanted
  const thief = createMemory();
  addStolen(thief, [{ id: 'trophy', count: 1 }]);
  const back = robbery(thief, 'threatening', { kind: 'one', index: 0 }, () => rng.next());
  assert.equal(back.recovered, 1);
  assert.equal(back.wanted, 0);
  assert.equal(thief.stolen.length, 0);
});

test('a surrendering thief returns the loot; a poofed NPC leaves their whole inventory, stolen items included', () => {
  const thief = createMemory();
  addStolen(thief, [{ id: 'trophy', count: 1 }, { id: 'fish_bluegill', count: 3 }]);
  const back = surrenderLoot(thief);
  assert.equal(back.length, 2);
  assert.equal(thief.stolen.length, 0);
  assert.equal(thief.inventory.length, 0);
  const wade = createMemory();
  addStolen(wade, [{ id: 'lucky_lure', count: 1 }]);
  const bag = poofLoot(wade, npcDef('wade'));
  assert.ok(bag.some((s) => s.id === 'lucky_lure'), 'the stolen lure is in the bag');
  assert.ok(bag.some((s) => s.id === 'rifle_ammo'), "Wade's own loot is in the bag");
  assert.ok(bag.some((s) => s.id === 'mre'), 'his trading stock too');
  assert.equal(wade.inventory.length, 0);
});

test("the ranger's pick: the best weapon, then the most valuable other item; the starter rod is never taken", () => {
  const inv = createInventory();
  addItem(inv, { id: 'old_rod', count: 1 });
  addItem(inv, { id: 'pocket_knife', count: 1 });
  addItem(inv, { id: 'rifle', count: 1 });
  addItem(inv, { id: 'trophy', count: 1 });
  addItem(inv, { id: 'ball_gown', count: 1 });
  assert.equal(bestWeapon(inv.slots)!.stack.id, 'rifle');
  assert.equal(mostValuable(inv.slots, { excludeWeapons: true })!.stack.id, 'ball_gown');
  const empty = createInventory();
  addItem(empty, { id: 'old_rod', count: 1 });
  assert.equal(bestWeapon(empty.slots), null);
  assert.equal(mostValuable(empty.slots), null, 'the bound rod is never a fine');
});

test('death loses the carried fish only', () => {
  const inv = createInventory();
  addItem(inv, { id: 'old_rod', count: 1 });
  addItem(inv, { id: 'fish_bluegill', count: 4 });
  addItem(inv, { id: 'handgun', count: 1 });
  addItem(inv, { id: 'pistol_ammo', count: 9 });
  assert.equal(deathLosses(inv), 4);
  assert.equal(countItem(inv, 'fish_bluegill'), 0);
  assert.equal(countItem(inv, 'handgun'), 1);
  assert.equal(countItem(inv, 'pistol_ammo'), 9);
  assert.equal(countItem(inv, 'old_rod'), 1);
});
