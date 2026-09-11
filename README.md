# Solitude Springs

*A Tranquil Fishing Experience.* It is not.

A browser fishing game (TypeScript, Vite, three.js) in which the calm is constantly interrupted by
campers, partiers, thieves, a bear, an alligator, people walking out of the river and, rarely, a UFO.
The design and build plan lives in [`plans/`](plans/); the current plan is the single source of truth.

## Status

M0 (foundations and look-dev) — see the plan's milestone list. There is no playable game yet, only
the look-dev lab pages.

## Running it

Requirements: Node ≥ 24 and npm ≥ 11.10 (the project enforces a 14-day release-age buffer for every
package via `min-release-age` in `.npmrc`; older npm versions fail loudly).

```bash
npm ci               # install exactly what package-lock.json says
npm run assets       # fetch CC0 assets (checksum-verified) into public/assets/fetched/
npm run dev          # Vite dev server → http://localhost:5173/
```

Lab pages (look-dev, not part of the game):

- `lab/characters.html?candidate=a|b|c&shot=lineup|underwear|dress|walk|cast` — character bake-off.
- `lab/vignette.html?time=dawn|day|dusk|night&state=clean|trashed` — riverbank vignette.

Checks:

```bash
npm run typecheck    # strict TypeScript
npm test             # node --test suites in tests/
npm run deps:check   # every resolved package version is ≥ 14 days old
npm run build        # production build into dist/
npm run smoke        # headless Chromium (flatpak org.chromium.Chromium) over CDP; fails on console errors
npm run shots        # look-dev screenshot sets into shots-out/ (add --gpu for the real GPU)
```

## Asset pipeline

- Third-party assets are listed in `ASSETS.md`, generated from `assets-src/assets.json` by
  `tools/fetch-assets.mjs`. Downloads are HTTPS-only from allow-listed hosts and verified against the
  SHA-256 recorded in the manifest.
- Characters are generated headlessly with Blender 5.2 + MPFB 2.0.17
  (`assets-src/characters/blender/generate.py`) from CC0 MakeHuman packs into
  `public/assets/built/characters/`.
- Trees are generated at runtime (for now) with EZ-Tree.

## Licensing

The code is Apache-2.0 (see `LICENSE`). Third-party assets keep their own licenses (CC0, MIT or
CC-BY with attribution) as recorded in `ASSETS.md`; CC-BY assets do not become Apache-2.0.
