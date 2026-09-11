// Dialogue runner (plan §10.3): walks a DialogueTree, resolving branches, requirements and line
// variants against a context the game provides. Effects are returned, never applied here.
import type { DialogueChoice, DialogueEffect, DialogueNode, DialogueRequire, DialogueTree } from '../data/dialogue.ts';
import type { DayPhase } from '../data/fish.ts';

export interface DialogueContext {
  playerName: string;
  hasItem(id: string, count?: number): boolean;
  /** Item id or pseudo-id (`underwear`, `dress`, `tuxedo`, `barrel`, `tinfoil_hat`). */
  wearing(id: string): boolean;
  relationship: number;
  phase: DayPhase;
  flags: Record<string, boolean>;
  met: boolean;
  robbed: boolean;
  stoleFrom: boolean;
  poofed: boolean;
  recentEvent(type: string): boolean;
  weaponDrawn: boolean;
  trader: boolean;
  rng(): number;
}

export interface DialogueSession {
  tree: DialogueTree;
  nodeId: string;
  /** The resolved line for the current node ('' when the node has none). */
  line: string;
  choices: { index: number; text: string }[];
  /** True once the conversation reached `end`. */
  done: boolean;
  /** True when the current step asks the game to open trading. */
  trade: boolean;
  /** Effects the game should apply for this step. */
  effects: DialogueEffect[];
  /** Nodes visited (for tests and to stop infinite branch loops). */
  visited: string[];
}

export function requirementMet(r: DialogueRequire, ctx: DialogueContext): boolean {
  if ('not' in r) return !requirementMet(r.not, ctx);
  if ('hasItem' in r) return ctx.hasItem(r.hasItem, r.count ?? 1);
  if ('wearing' in r) return ctx.wearing(r.wearing);
  if ('relationship' in r) return ctx.relationship >= r.relationship;
  if ('phase' in r) return r.phase.includes(ctx.phase);
  if ('flag' in r) return !!ctx.flags[r.flag] === (r.is ?? true);
  if ('met' in r) return ctx.met === r.met;
  if ('robbed' in r) return ctx.robbed === r.robbed;
  if ('stoleFrom' in r) return ctx.stoleFrom === r.stoleFrom;
  if ('poofed' in r) return ctx.poofed === r.poofed;
  if ('recentEvent' in r) return ctx.recentEvent(r.recentEvent);
  if ('weaponDrawn' in r) return ctx.weaponDrawn === r.weaponDrawn;
  if ('trader' in r) return ctx.trader === r.trader;
  return false;
}

export function allMet(rs: readonly DialogueRequire[] | undefined, ctx: DialogueContext): boolean {
  return !rs || rs.every((r) => requirementMet(r, ctx));
}

export function pickLine(say: string | readonly string[] | undefined, ctx: DialogueContext): string {
  if (!say) return '';
  const s = typeof say === 'string' ? say : say[Math.min(say.length - 1, Math.floor(ctx.rng() * say.length))]!;
  return s.replace(/\{name\}/g, ctx.playerName);
}

function node(tree: DialogueTree, id: string): DialogueNode {
  const n = tree.nodes[id];
  if (!n) throw new Error(`dialogue ${tree.id}: missing node ${id}`);
  return n;
}

/** Resolve branches from `id` (following the first matching jump, repeatedly). */
export function resolveNodeId(tree: DialogueTree, id: string, ctx: DialogueContext, guard = 0): string {
  const n = node(tree, id);
  if (n.branches && guard < 16) {
    for (const b of n.branches) if (allMet(b.require, ctx)) return resolveNodeId(tree, b.next, ctx, guard + 1);
  }
  return id;
}

function enter(s: DialogueSession, id: string, ctx: DialogueContext): void {
  if (id === 'end') {
    s.done = true;
    s.choices = [];
    s.trade = false;
    return;
  }
  if (id === 'trade') {
    s.trade = true;
    s.choices = [];
    return;
  }
  const resolved = resolveNodeId(s.tree, id, ctx);
  const n = node(s.tree, resolved);
  s.nodeId = resolved;
  s.visited.push(resolved);
  s.trade = false;
  if (n.say !== undefined) s.line = pickLine(n.say, ctx);
  if (n.effects) s.effects.push(...n.effects);
  s.choices = (n.choices ?? []).map((c, index) => ({ c, index })).filter(({ c }) => allMet(c.require, ctx)).map(({ c, index }) => ({ index, text: c.text }));
  // a node with no choices and no `next` closes the conversation after its line
  if (!n.choices && n.next === undefined) {
    /* the caller advances with step() to close */
  }
}

export function startDialogue(tree: DialogueTree, ctx: DialogueContext): DialogueSession {
  const s: DialogueSession = { tree, nodeId: tree.start, line: '', choices: [], done: false, trade: false, effects: [], visited: [] };
  enter(s, tree.start, ctx);
  return s;
}

/** Clear effects the game has applied. */
export function takeEffects(s: DialogueSession): DialogueEffect[] {
  const e = s.effects;
  s.effects = [];
  return e;
}

/** Advance a node that has no choices (click to continue). Returns false if the node wants a choice. */
export function step(s: DialogueSession, ctx: DialogueContext): boolean {
  if (s.done) return true;
  if (s.trade) {
    // returning from trading: back to the menu if there is one
    enter(s, s.tree.nodes.menu ? 'menu' : 'end', ctx);
    return true;
  }
  const n = node(s.tree, s.nodeId);
  if (n.choices && n.choices.length) return false;
  enter(s, n.next ?? 'end', ctx);
  return true;
}

/** Pick a visible choice by its index into the node's choice list. */
export function choose(s: DialogueSession, index: number, ctx: DialogueContext): boolean {
  if (s.done) return false;
  const n = node(s.tree, s.nodeId);
  const c: DialogueChoice | undefined = n.choices?.[index];
  if (!c || !allMet(c.require, ctx)) return false;
  if (c.effects) s.effects.push(...c.effects);
  enter(s, c.next, ctx);
  return true;
}

/** Every node id reachable through `next`, `branches` and choices (for the data-integrity test). */
export function referencedNodes(tree: DialogueTree): string[] {
  const out = new Set<string>();
  for (const n of Object.values(tree.nodes)) {
    if (n.next) out.add(n.next);
    for (const b of n.branches ?? []) out.add(b.next);
    for (const c of n.choices ?? []) out.add(c.next);
  }
  return [...out];
}
