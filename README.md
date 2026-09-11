# Solitude Springs

*A Tranquil Fishing Experience.* It is not.

A browser fishing game (TypeScript, Vite, three.js) in which the calm is constantly interrupted by
campers, partiers, thieves, a bear, an alligator, people walking out of the river and, rarely, a UFO.
The design and build plan lives in [`plans/`](plans/); the current plan is the single source of truth.

## Status

M1 ("Tranquil" vertical slice) is built and awaiting the owner's checkpoint: a playable valley with
the character creator, walking/jumping/wading, the full fishing loop, inventory and clothing, saves,
menus and settings, and generative audio. The interruptions (NPCs, thieves, bear, alligator, UFO)
arrive in M2. See the plan's milestone list (§20) for status and known gaps.

## Running it

Requirements: Node ≥ 24 and npm ≥ 11.10 (the project enforces a 14-day release-age buffer for every
package via `min-release-age` in `.npmrc`; older npm versions fail loudly). Generated character
files need Blender 5.2 + MPFB2 (see the plan §4.5); the fetched assets need `npm run assets`.

```bash
npm ci               # install exactly what package-lock.json says
npm run assets       # fetch CC0 assets (checksum-verified) into public/assets/fetched/
npm run dev          # Vite dev server → http://localhost:5173/  (the game is the root page)
```

Controls (rebindable in **Controls**): W A S D move, mouse look, Space jump, Shift sprint,
**right mouse** hold to charge a cast / release to cast / press to reel, F interact, E inventory,
Q drop, 1–9 or wheel hotbar, V camera distance, J journal, Esc pause. Dev builds open the debug
console with `` ` `` (`help` lists commands: `time`, `day`, `give`, `outfit`, `tp`, `trash`,
`speed`, `bite`, `catch`, `stats`, …).

Lab pages (look-dev, not part of the game) are indexed at `lab/index.html`: the character bake-off
and the M1 player bodies (`lab/characters.html`), the animation flip-books (`?shot=anim&clip=…`),
the riverbank vignette (`lab/vignette.html`) and the map viewer (`lab/map.html?view=…`).

Checks:

```bash
npm run typecheck    # strict TypeScript
npm test             # node --test suites in tests/ (sim, saves, terrain)
npm run deps:check   # every resolved package version is ≥ 14 days old
npm run build        # production build into dist/
npm run smoke        # headless Chromium over CDP plays the M1 acceptance path; fails on console errors
npm run shots        # look-dev screenshot sets into shots-out/ (--set=…, --gpu for the real GPU)
npm run perf         # frame times per graphics preset on the real GPU (--preset=medium,high)
```

## Asset pipeline

- Third-party assets are listed in `ASSETS.md`, generated from `assets-src/assets.json` by
  `tools/fetch-assets.mjs`. Downloads are HTTPS-only from allow-listed hosts and verified against the
  SHA-256 recorded in the manifest.
- Characters are generated headlessly with Blender 5.2 + MPFB 2.0.17
  (`assets-src/characters/blender/generate.py` from `players.json`) from CC0 MakeHuman packs into
  `public/assets/built/characters/mpfb/`.
- Animations: the CC0 Quaternius Universal Animation Library clips are retargeted onto the MPFB rig
  by `assets-src/characters/blender/retarget.py` (`animations.json`), together with hand-authored
  fishing clips (`poses.json`), into one shared library GLB.
- Trees are generated at load time with EZ-Tree; the valley terrain is procedural from
  `src/world/valley.ts` and the layout data in `src/data/world.ts`.

## Licensing

The code is Apache-2.0 (see `LICENSE`). Third-party assets keep their own licenses (CC0, MIT or
CC-BY with attribution) as recorded in `ASSETS.md`; CC-BY assets do not become Apache-2.0.
