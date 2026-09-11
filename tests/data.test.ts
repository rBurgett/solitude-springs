// Data integrity (plan §18.2, §10.6): the roster, dialogue, items and events reference each other correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NPCS, NPC_BY_ID, type Archetype } from '../src/data/npcs.ts';
import { DIALOGUE } from '../src/data/dialogue/index.ts';
import { SHARED_BARKS, type BarkCategory } from '../src/data/dialogue.ts';
import { referencedNodes } from '../src/sim/dialogue.ts';
import { isKnownItem, itemDef, ITEMS } from '../src/data/items.ts';
import { ACHIEVEMENT_BY_ID } from '../src/data/achievements.ts';
import { EVENTS } from '../src/data/events.ts';
import { FISH } from '../src/data/fish.ts';
import { readFileSync } from 'node:fs';
import { checkAchievements } from '../src/sim/achievements.ts';
import { createJournal, createStats } from '../src/sim/journal.ts';
import { TUNABLES } from '../src/data/tunables.ts';

const HAIR: Record<'male' | 'female', string[]> = { male: ['short', 'crew', 'messy', 'long'], female: ['ponytail', 'bob', 'long', 'braid'] };

test('exactly 58 roster entries with unique ids, every archetype represented, looks valid', () => {
  assert.equal(NPCS.length, 58);
  assert.equal(new Set(NPCS.map((n) => n.id)).size, 58);
  const archetypes: Archetype[] = ['camper', 'hiker', 'partier', 'thief', 'waterwalker', 'ranger', 'oddball'];
  for (const a of archetypes) assert.ok(NPCS.some((n) => n.archetypes.includes(a)), `archetype ${a}`);
  assert.equal(NPCS.filter((n) => n.archetypes.includes('thief')).length, 8);
  assert.equal(NPCS.filter((n) => n.archetypes.includes('partier')).length, 10);
  assert.equal(NPCS.filter((n) => n.archetypes.includes('ranger')).length, 2);
  for (const n of NPCS) {
    assert.ok(n.look.skin >= 0 && n.look.skin <= 9, `${n.id} skin`);
    assert.ok(HAIR[n.look.sex].includes(n.look.hairStyle), `${n.id} hairstyle ${n.look.hairStyle}`);
    for (const [slot, id] of Object.entries(n.look.outfit)) {
      assert.ok(isKnownItem(id) && itemDef(id).kind === 'clothing' && itemDef(id).slot === slot, `${n.id} outfit ${slot}=${id}`);
    }
    for (const g of Object.keys(n.look.colors)) assert.ok(isKnownItem(g), `${n.id} colour for ${g}`);
    assert.ok(n.look.scale > 0.85 && n.look.scale < 1.2, `${n.id} scale`);
    assert.ok(n.voice.pitch > 0.4 && n.voice.pitch < 2, `${n.id} pitch`);
    assert.ok(n.catchphrases.length >= 3, `${n.id} catchphrases`);
    for (const s of [...n.loot, ...(n.trading?.stock ?? [])]) assert.ok(isKnownItem(s.id) && s.count >= 1, `${n.id} stock/loot ${s.id}`);
    for (const tag of [...(n.trading?.wants ?? []), ...(n.trading?.dislikes ?? []), ...(n.trading?.refuses ?? []), ...(n.trading?.favorite ? [n.trading.favorite] : []), ...(n.theft?.only ?? []), ...(n.theft?.prefers ?? [])]) {
      if (tag.startsWith('kind:') || tag.startsWith('slot:')) continue;
      assert.ok(isKnownItem(tag), `${n.id} trade tag ${tag}`);
    }
    for (const l of n.links ?? []) assert.ok(NPC_BY_ID.has(l), `${n.id} link ${l}`);
  }
  // don't cluster: thieves span both sexes and several skin tones (§10.6 consistency & variety)
  const thieves = NPCS.filter((n) => n.archetypes.includes('thief'));
  assert.ok(new Set(thieves.map((t) => t.look.sex)).size === 2);
  assert.ok(new Set(thieves.map((t) => t.look.skin)).size >= 4);
});

test('every NPC has a dialogue tree with the mandatory nodes, valid targets and ≥3 bark overrides', () => {
  const MAX = 140;
  const lines = (say: string | readonly string[] | undefined): string[] => (say === undefined ? [] : typeof say === 'string' ? [say] : [...say]);
  for (const n of NPCS) {
    const d = DIALOGUE[n.id];
    assert.ok(d, `dialogue for ${n.id}`);
    const t = d!.tree;
    for (const id of ['start', 'again', 'menu', 'small', 'goodbye', 'robbed', 'poof_return']) assert.ok(t.nodes[id], `${n.id} node ${id}`);
    assert.ok(lines(t.nodes.small!.say).length >= 3, `${n.id} small talk variants`);
    assert.ok(t.nodes.hands_up || t.nodes.fight_back, `${n.id} hands-up or fight-back`);
    if (n.armed === 'none') assert.ok(t.nodes.hands_up, `${n.id} unarmed needs hands_up`);
    else assert.ok(t.nodes.fight_back, `${n.id} armed needs fight_back`);
    if (n.trading) assert.ok(t.nodes.trade_intro, `${n.id} trades but has no trade intro`);
    for (const target of referencedNodes(t)) assert.ok(target === 'end' || target === 'trade' || t.nodes[target], `${n.id} → ${target}`);
    for (const [id, node] of Object.entries(t.nodes)) {
      for (const l of lines(node.say)) assert.ok(l.length <= MAX, `${n.id}.${id} line too long (${l.length}): ${l}`);
      if (node.choices) assert.ok(node.choices.length >= 2 && node.choices.length <= 4, `${n.id}.${id} has ${node.choices.length} choices`);
      for (const c of node.choices ?? []) {
        for (const e of c.effects ?? []) {
          if ('give' in e) assert.ok(isKnownItem(e.give), `${n.id}.${id} gives ${e.give}`);
          if ('take' in e) assert.ok(isKnownItem(e.take), `${n.id}.${id} takes ${e.take}`);
          if ('unlock' in e) assert.ok(ACHIEVEMENT_BY_ID.has(e.unlock), `${n.id}.${id} unlocks ${e.unlock}`);
        }
      }
      for (const e of node.effects ?? []) {
        if ('give' in e) assert.ok(isKnownItem(e.give), `${n.id}.${id} gives ${e.give}`);
        if ('take' in e) assert.ok(isKnownItem(e.take), `${n.id}.${id} takes ${e.take}`);
      }
    }
    const barkCats = Object.keys(d!.barks).filter((k) => (d!.barks[k as BarkCategory]?.length ?? 0) > 0);
    assert.ok(barkCats.length >= 3, `${n.id} has ${barkCats.length} bark overrides`);
    for (const k of barkCats) assert.ok(k in SHARED_BARKS, `${n.id} bark category ${k}`);
    if (n.archetypes.includes('thief')) for (const k of ['approach', 'rummage', 'strip', 'pity', 'flee'] as const) assert.ok(d!.events[k]?.length, `${n.id} thief line ${k}`);
    if (n.archetypes.includes('waterwalker')) assert.ok(d!.events.emerge?.length, `${n.id} emerge line`);
    if (n.archetypes.includes('partier')) assert.ok(d!.events.party?.length, `${n.id} party line`);
  }
  assert.equal(Object.keys(DIALOGUE).length, 58, 'no dialogue for non-roster ids');
});

test("every NPC outfit resolves to a garment mesh on that body (nobody spawns in underwear by accident)", () => {
  const players = JSON.parse(readFileSync(new URL('../assets-src/characters/players.json', import.meta.url), 'utf8')) as { figures: { name: string; clothes: { id: string; layer?: string }[] }[] };
  const meshes: Record<'male' | 'female', Set<string>> = { male: new Set(), female: new Set() };
  for (const f of players.figures) {
    const sex = f.name.endsWith('female') ? 'female' : 'male';
    for (const c of f.clothes) if (c.layer !== 'underwear') meshes[sex].add(c.id);
  }
  const procedural = new Set(['barrel', 'tinfoil']);
  for (const n of NPCS) {
    assert.ok(n.look.outfit.full || n.look.outfit.top, `${n.id} wears nothing on top`);
    assert.ok(n.look.outfit.full || n.look.outfit.bottom, `${n.id} wears nothing below`);
    for (const [slot, id] of Object.entries(n.look.outfit)) {
      const garment = itemDef(id).garment!;
      assert.ok(meshes[n.look.sex].has(garment) || procedural.has(garment), `${n.id} ${slot}=${id} → garment "${garment}" has no mesh on the ${n.look.sex} body`);
    }
  }
});

test('Actual Solitude needs 100% serenity held for the calm window', () => {
  const base = { stats: createStats(), journal: createJournal(), playTimeSeconds: 0 };
  assert.ok(!checkAchievements({}, { ...base, serenity: 1, calmSeconds: 10 }).includes('actual_solitude'));
  assert.ok(checkAchievements({}, { ...base, serenity: 1, calmSeconds: TUNABLES.legend.calmSecondsRequired }).includes('actual_solitude'));
  assert.ok(!checkAchievements({}, { ...base, serenity: 0.99, calmSeconds: 999 }).includes('actual_solitude'));
});

test('event table, items and fish are consistent', () => {
  assert.ok(EVENTS.every((e) => e.cooldownSeconds > 0));
  assert.equal(new Set(EVENTS.map((e) => e.type)).size, EVENTS.length);
  assert.ok(EVENTS.filter((e) => e.weight > 0).length >= 8);
  for (const i of ITEMS) {
    if (i.kind === 'clothing') assert.ok(i.slot && i.garment, `${i.id} clothing needs slot + garment`);
    if (i.ammoFor) assert.ok(isKnownItem(i.ammoFor), `${i.id} ammoFor`);
  }
  assert.equal(FISH.length, 13);
  assert.equal(FISH.filter((f) => f.legendary).length, 1);
  assert.ok(ITEMS.some((i) => i.id === 'barrel' && i.slot === 'full'));
});
