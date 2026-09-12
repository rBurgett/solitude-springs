import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal, pickMessage, recordMessage } from '../src/sim/journal.ts';
import { MESSAGES, MESSAGE_BY_ID } from '../src/data/messages.ts';

test('messages in bottles: twelve unique notes, ids fit the save limits, texts stay short', () => {
  assert.equal(MESSAGES.length, 12);
  assert.equal(new Set(MESSAGES.map((m) => m.id)).size, 12);
  for (const m of MESSAGES) {
    assert.ok(m.id.length <= 64, m.id);
    assert.ok(m.text.length > 0 && m.text.length <= 140, `${m.id}: ${m.text.length} chars`);
    assert.equal(MESSAGE_BY_ID.get(m.id), m);
  }
});

test('messages in bottles: every catch reads a new note until all twelve are found, then none', () => {
  const j = createJournal();
  const ids = MESSAGES.map((m) => m.id);
  let seed = 7;
  const random = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 12; i++) {
    const id = pickMessage(j, ids, random);
    assert.ok(id && ids.includes(id), 'a note is picked');
    assert.equal(recordMessage(j, id), true, 'and it is new');
  }
  assert.equal(j.messages.length, 12);
  assert.equal(new Set(j.messages).size, 12, 'no duplicates');
  assert.equal(pickMessage(j, ids, random), null, 'nothing left to find');
  assert.equal(recordMessage(j, 'note_river'), false, 'a repeat is not recorded twice');
});
