// Credits (plan §16.1): team, tools, and every third-party asset with its license, read from the
// fetched-asset index so ASSETS.md stays the single source (M4 generates the full list).
import { el } from '../el.ts';
import type { AssetIndex } from '../../render/assets.ts';

export interface CreditsActions {
  index: AssetIndex | null;
  onBack(): void;
}

const TOOLS = [
  ['three.js', 'MIT', 'rendering'],
  ['Rapier', 'Apache-2.0', 'physics'],
  ['Vite + TypeScript', 'MIT / Apache-2.0', 'build'],
  ['Blender + MPFB2', 'GPL (tools); exported characters CC0', 'character pipeline'],
  ['Quaternius Universal Animation Library 1 & 2', 'CC0', 'animation clips, retargeted'],
  ['EZ-Tree', 'MIT', 'procedural trees'],
  ['Poly Haven', 'CC0', 'HDRIs, textures, models'],
];

export function creditsScreen(a: CreditsActions): HTMLElement {
  const assets = a.index ? Object.entries(a.index.assets) : [];
  return el('div', { class: 'screen menu' }, [
    el('div', { class: 'panel wide' }, [
      el('h1', {}, 'Credits'),
      el('p', { class: 'tagline' }, 'Made by Ryan, with Claude Code doing the typing.'),
      el('h2', {}, 'Tools & libraries'),
      el('ul', {}, TOOLS.map(([n, l, u]) => el('li', {}, `${n} — ${l} — ${u}`))),
      el('h2', {}, 'Assets'),
      assets.length
        ? el('ul', {}, assets.map(([id, x]) => el('li', {}, `${x.title ?? id} — ${x.license ?? 'see ASSETS.md'}`)))
        : el('p', { class: 'hint' }, 'The full asset list lives in ASSETS.md.'),
      el('p', { class: 'hint' }, 'CC-BY assets keep their own licence and attribution; the game code is Apache-2.0.'),
      el('div', { class: 'row end' }, [el('button', { class: 'secondary', onclick: a.onBack }, 'Back')]),
    ]),
  ]);
}
