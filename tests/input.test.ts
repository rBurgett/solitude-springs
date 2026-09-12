import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBindings, validateBindings, ACTION_ORDER, ACTION_LABELS } from '../src/input/bindings.ts';

test('bindings: the hotbar cycling keys exist, are labelled, and saved bindings without them get the defaults', () => {
  const d = defaultBindings();
  assert.equal(d.slotPrev.primary, 'BracketLeft');
  assert.equal(d.slotNext.primary, 'BracketRight');
  assert.ok(ACTION_ORDER.includes('slotPrev') && ACTION_ORDER.includes('slotNext'));
  assert.ok(ACTION_LABELS.slotPrev && ACTION_LABELS.slotNext);
  const old = { forward: { primary: 'KeyI', secondary: null } };
  const v = validateBindings(old);
  assert.equal(v.forward.primary, 'KeyI');
  assert.equal(v.slotNext.primary, 'BracketRight');
});
