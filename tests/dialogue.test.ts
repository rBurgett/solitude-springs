import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { startDialogue, choose, step, takeEffects, requirementMet, type DialogueContext } from '../src/sim/dialogue.ts';
import { buildTree } from '../src/data/dialogue.ts';
import { dialogueFor } from '../src/data/dialogue/index.ts';

function ctx(over: Partial<DialogueContext> = {}): DialogueContext {
  const rng = new Rng(4);
  const items = new Map<string, number>();
  return {
    playerName: 'Ryaaaaaaan', hasItem: (id, c = 1) => (items.get(id) ?? 0) >= c, wearing: () => false, relationship: 0, phase: 'day', flags: {}, met: false, robbed: false, stoleFrom: false, poofed: false,
    recentEvent: () => false, weaponDrawn: false, trader: true, rng: () => rng.next(), ...over,
  };
}

test('the generated tree greets, offers chat / trade / goodbye, and branches on memory', () => {
  const d = buildTree('x', { greet: ['Hi {name}'], again: ['Again {name}'], small: ['a', 'b', 'c'], goodbye: ['bye'], tradeIntro: ['trade?'], robbed: ['you robbed me'], handsUp: ['hands'], poofReturn: ['I poofed'], barks: {} });
  let s = startDialogue(d.tree, ctx());
  assert.equal(s.line, 'Hi Ryaaaaaaan');
  assert.ok(step(s, ctx()));
  assert.equal(s.nodeId, 'menu');
  assert.deepEqual(s.choices.map((c) => c.text), ['Chat', 'Trade', 'Goodbye']);
  assert.ok(choose(s, 0, ctx()));
  assert.ok(['a', 'b', 'c'].includes(s.line));
  step(s, ctx());
  assert.equal(s.nodeId, 'menu');
  assert.ok(choose(s, 1, ctx()));
  assert.equal(s.line, 'trade?');
  step(s, ctx());
  assert.ok(s.trade, 'asks the game to open trading');
  step(s, ctx());
  assert.equal(s.nodeId, 'menu', 'back to the menu after trading');
  choose(s, 2, ctx());
  assert.equal(s.line, 'bye');
  assert.deepEqual(takeEffects(s), [{ relationship: 1 }]);
  step(s, ctx());
  assert.ok(s.done);
  // memory-driven starts
  s = startDialogue(d.tree, ctx({ met: true }));
  assert.equal(s.line, 'Again Ryaaaaaaan');
  s = startDialogue(d.tree, ctx({ met: true, poofed: true }));
  assert.equal(s.line, 'I poofed');
  assert.deepEqual(takeEffects(s), [{ setFlag: 'poofGreeted' }]);
  s = startDialogue(d.tree, ctx({ met: true, poofed: true, flags: { poofGreeted: true } }));
  assert.equal(s.line, 'Again Ryaaaaaaan');
  s = startDialogue(d.tree, ctx({ met: true, robbed: true }));
  assert.equal(s.line, 'you robbed me');
  // a non-trader hides Trade
  s = startDialogue(d.tree, ctx({ trader: false }));
  step(s, ctx({ trader: false }));
  assert.deepEqual(s.choices.map((c) => c.text), ['Chat', 'Goodbye']);
});

test('requirements: items, wearing, relationship, phase, flags, not', () => {
  const c = ctx({ hasItem: (id) => id === 'car_keys', wearing: (id) => id === 'dress', relationship: 10, phase: 'night', flags: { keysReturned: true } });
  assert.ok(requirementMet({ hasItem: 'car_keys' }, c));
  assert.ok(!requirementMet({ hasItem: 'old_boot' }, c));
  assert.ok(requirementMet({ wearing: 'dress' }, c));
  assert.ok(requirementMet({ relationship: 5 }, c));
  assert.ok(!requirementMet({ relationship: 50 }, c));
  assert.ok(requirementMet({ phase: ['night'] }, c));
  assert.ok(requirementMet({ flag: 'keysReturned' }, c));
  assert.ok(requirementMet({ flag: 'other', is: false }, c));
  assert.ok(requirementMet({ not: { hasItem: 'old_boot' } }, c));
});

test("Larry's keys quest: the choice only shows with the keys and pays out once", () => {
  const d = dialogueFor('larry');
  let have = true;
  const c = ctx({ hasItem: (id) => id === 'car_keys' && have });
  let s = startDialogue(d.tree, c);
  step(s, c);
  const keys = s.choices.find((x) => x.text.startsWith('About the keys'))!;
  assert.ok(keys);
  choose(s, keys.index, c);
  assert.equal(s.nodeId, 'keys');
  const give = s.choices.find((x) => x.text === 'Are these them?')!;
  assert.ok(give, 'give choice visible with the keys');
  choose(s, give.index, c);
  const effects = takeEffects(s);
  assert.ok(effects.some((e) => 'take' in e && e.take === 'car_keys'));
  assert.ok(effects.some((e) => 'unlock' in e && e.unlock === 'is_this_yours'));
  assert.ok(effects.some((e) => 'setFlag' in e && e.setFlag === 'keysReturned'));
  // afterwards the keys node branches to "done"
  const c2 = ctx({ hasItem: () => false, flags: { keysReturned: true }, met: true });
  s = startDialogue(d.tree, c2);
  step(s, c2);
  choose(s, s.choices.find((x) => x.text.startsWith('About the keys'))!.index, c2);
  assert.equal(s.nodeId, 'keys_done');
  // without the keys the give choice is hidden
  have = false;
  s = startDialogue(d.tree, c);
  step(s, c);
  choose(s, s.choices.find((x) => x.text.startsWith('About the keys'))!.index, c);
  assert.ok(!s.choices.some((x) => x.text === 'Are these them?'));
});
