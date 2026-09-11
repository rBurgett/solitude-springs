# Solitude Springs — Game Plan

- **Date:** 2026-09-10
- **Status:** Design approved in conversation; not yet implemented.
- **Supersedes:** `prompt.md`. Where they differ, this document wins.
- **Owner:** Ryan. **Implementer:** Claude Code.

## 0. How to use this document

- This is the single source of truth for design and build. Numbers marked *(tunable)* live in one file, `src/data/tunables.ts`, so they can be changed without touching logic.
- The build proceeds in milestones (§20). **Stop at every checkpoint** so the owner can play the build, and update this plan with the feedback before continuing.
- Record new owner decisions in §1 and resolve open items in §22 as they're settled.
- Keep the implementation honest: every milestone ends with its acceptance checks actually run (§19), not assumed.

### 0.1 Handoff: start here

This plan was written from a design conversation with the owner. Everything decided there is captured in §1 and the sections below, so you don't need that conversation. `prompt.md` is the owner's original brief, kept for history only.

**Current state (2026-09-11) — M1 built, awaiting the M1 checkpoint**

- Everything from M0 plus the M1 build list (§20): retargeted animation library and hand-authored fishing clips on the MPFB rig, the two player bodies with every garment and the underwear layer, the full valley blockout, the player controller (Rapier), the fishing loop, hotbar/backpack/paper doll, saves (IndexedDB + export/import), menus/settings/controls/pause/credits, generative audio, and the debug console.
- **Play it:** `npm run dev` → the game is the root page. New Game opens the creator; the world is built once at boot and the main menu flies over it. Dev builds open the console with `` ` ``.
- **Evidence for the checkpoint** (all run 2026-09-11): `npm run typecheck`, `npm test` (42 pass), `npm run deps:check` (all ≥ 14 d), `npm run build`, `npm run smoke --gpu` (the full §20 M1 scripted path passes with zero console errors; screenshots in `smoke-out/`), `npm run perf --preset=medium` on the Intel Iris Xe at 1080p (see §20 M1 status), look-dev sets in `shots-out/m1-anim`, `shots-out/m1-player`, `shots-out/m1-map`.
- **Not met yet:** the Medium/Iris Xe budget is close but not fully there (worst station 50 fps, p95 21 ms at the spring pool; four of six stations at 60 fps). The production bundle still copies all of `public/` (222 MB). Both carried into M2/M4 (§20 M1 status).
- The M0 lab pages still work (`lab/index.html`); the M1 lab additions are the player-body rows, the animation flip-books and the map viewer.
- `prompt.md` was dropped from the repository (owner decision, §1 #22).

**Verified environment (Linux)**

| Tool | Version / how to run | Notes |
|---|---|---|
| Node | v24.14.0 | Strips TypeScript types natively, so `node --test` works with no extra packages. |
| npm | 11.9.0 | Must be upgraded to ≥ 11.10 for `min-release-age` (§3.3). Owner approval needed. |
| Chromium | flatpak `org.chromium.Chromium` 152.0.7977.64 → `flatpak run org.chromium.Chromium` | For DevTools Protocol smoke tests and screenshots. |
| Blender | flatpak `org.blender.Blender` 5.2.0 LTS → `flatpak run org.blender.Blender` | Headless usage and sandbox caveats in §4.5. |
| GPUs | Intel Iris Xe (Raptor Lake-P) + NVIDIA RTX 4050 Max-Q (hybrid laptop) | Performance targets in §17. |
| Not installed | MPFB2, pnpm, Bun, Godot, Unity, gltf-transform | |

**First steps**

1. Read §0–§4 and §20 (M1 status) in full. Skim the rest; read each section fully when its milestone starts.
2. The M1 checkpoint is pending: **do not start M2 until the owner has played the build and replied.** Record the feedback in §1 / §22 first.
3. Re-verify licenses before using any asset. Appendix A (§23) has the 2026-09-10 research with source links, but licenses and free tiers change.

**Working rules**

- **Who decides:** the owner decides game design. The implementer has free rein on technical decisions.
  - If a design point is ambiguous and the plan gives no default, ask.
  - If a technical approach proves infeasible, use the fallback the plan names. If there isn't one, pause and ask rather than silently changing scope.
- **Reference project:** `~/GolandProjects/florida-driver-3` is the owner's earlier three.js game, also built by an agent. Treat it as **read-only**. When adapting its code, watch for these differences:
  - Its `formatSaveDate` forces a 24-hour clock; this game uses the player's locale default (§14.4).
  - It stores saves in `localStorage`; this game uses IndexedDB (§14.1).
  - Its actions and default keys are for driving; use §6.
  - Its README describes a strict CSP; this game doesn't need one (§3.3).
  - Its characters are procedural and not the target look (§4.3).
- **Git:** commit only when the owner asks; each checkpoint is a natural point. `.gitignore` must cover:
  - `node_modules/`, `dist/`, `.cache/`
  - `smoke-out/`, screenshot output, `.idea/`
  - large fetched or built files under `public/assets/` (keep manifests and license files tracked).
- **Keep this plan current:**
  - owner decisions go in §1
  - tool versions in §4.5
  - resolved items move out of §22
  - every change gets a line in §0.2.

### 0.2 Plan change log

- 2026-09-10 — Plan created from the design conversation; supersedes `prompt.md`.
- 2026-09-10 — Blender 5.2.0 LTS installed by the owner; headless use verified and recorded (§4.5).
- 2026-09-10 — Added handoff context (§0.1), world layout order (§7.1), dialogue writing guidelines (§10.6) and asset research sources (§23).
- 2026-09-10 — Owner approved M0, the npm upgrade and the MPFB2 install; `prompt.md` dropped (§1 #22–24).
- 2026-09-11 — M0 checkpoint: owner chose MPFB2, confirmed the setting, specified the underwear layer and asked for the Quaternius-quality walk on the MPFB rig (§1 #25–28); §22 items 1–3 resolved; M1 build list amended.
- 2026-09-11 — M0 built (§0.1 current state, §20 M0 status). Recorded tool versions (§4.5), the M0 character findings (§4.3), allowlist additions `@types/node` and `@dgreenheck/ez-tree` (§3.3), asset notes (§23) and the implementer's recommendation for the checkpoint (§22).
- 2026-09-11 — M0 committed (`3ef726b`). Owner said to start M1.
- 2026-09-11 — M1 committed (`7a2d82e`). First owner play feedback recorded (§1 #29–30) and fixed: bite delay 10–40 s; the player no longer creeps down slopes while standing (horizontal position frozen when idle and grounded; 1 m physics heightfield; gentler deep-water push); bridges no longer count as wading (depth is measured from the feet, not the terrain under the deck — this also fixed the stall mid-bridge); the sprint's torso lean is scaled down in the retarget (`lean` per clip).
- 2026-09-11 — M1 built (§0.1 current state, §20 M1 status). Recorded the animation retargeting method and the authored clips (§4.4), the player-body pipeline findings (§4.3), the layout resolution rule (§7.1), perf numbers (§17), and the M1 checkpoint asks (§22). No new dependencies.

---

## 1. Owner decisions (from the design conversation)

| # | Topic | Decision |
|---|---|---|
| 1 | Platform | Browser game: TypeScript + Vite + three.js. |
| 2 | Art | More realism than low-poly, "somewhat like GTA". Free packs are OK. A pack with a more consistent style is acceptable at some cost in realism. Florida Driver's procedural characters (`~/GolandProjects/florida-driver-3`) are available as a reference or fallback. Final character tech is picked in the M0 look-dev bake-off (§4.3). |
| 3 | Audio | Synthesized and/or CC0 sound effects, a calm ambient score that the party music stomps on, and gibberish "Animal Crossing-style" voices unique to each NPC. |
| 4 | Pausing | The world keeps running during dialogue, inventory and trading. **Settings has a "Pause during conversations" toggle, off by default.** Only Esc always pauses. |
| 5 | Health & death | Hearts. At zero the player red-poofs and wakes at the trailhead, losing carried fish only. **Achievements are never lost.** |
| 6 | Weapons vs. innocents | Firing or stabbing at an innocent simply doesn't happen. Instead the NPC reacts: they either **put their hands up** (the player can then interact, e.g. rob them) or, if armed, **attack back** (becoming hostile and fair game). |
| 7 | Consequences | NPCs remember being robbed. A Park Ranger shows up after repeat offenses and confiscates a weapon. |
| 8 | Thieves | Poofing a thief drops what they stole. A thief who finds the player already in underwear leaves them a barrel to wear. |
| 9 | Animals | Bears and alligators can only be scared off with weapons, never hurt. |
| 10 | Parties | Afterwards the grass is brown, cans are scattered, **and the river is discolored**. Fish leave for ~2 in-game days. Picking up cans speeds recovery (with an achievement). |
| 11 | UFO | The player is **returned to the exact spot** they were taken from, wearing different clothes. |
| 12 | Clothing | Anyone can wear anything. Defaults: **women start in a dress, men in a shirt and pants.** A man losing his clothes and having to wear a fished-up dress is part of the joke. |
| 13 | Goal | Open-ended sandbox, plus a Fish Journal and a legendary fish that only bites during a truly uninterrupted stretch. |
| 14 | NPCs | 58 named, recurring people who remember the player. Aliens and animals don't count toward the 58. |
| 15 | Water | Wade in shallows only; no swimming. |
| 16 | Controls | Defaults in §6 accepted. |
| 17 | Fishing | 3 s bite window (shorter for rare fish), early reel just retrieves the line, 24-minute day/night cycle, some fish only at night. |
| 18 | Achievements | Tracked per save. |
| 19 | Dates | Stored as ISO 8601 UTC; displayed in the player's locale and time zone. |
| 20 | Ideas | All ideas from the conversation are accepted (§2.2), plus **a woman in a swimsuit walks out of the water**. |
| 21 | Security | No strict CSP requirement (skip it if it gets in the way). **The top priority is never installing freshly published package versions**; enforce a release-age buffer (§3.3). |
| 22 | Housekeeping | `prompt.md` is dropped from the repository (2026-09-10). This plan is the only brief. |
| 23 | Tooling | npm upgraded to **11.19.1** (published 2026-08-26, inside the buffer). npm 12.x was rejected because it requires Node ≥ 24.15 and the machine has 24.14.0. |
| 24 | Tooling | MPFB **2.0.17** installed into the Blender 5.2 flatpak (repo `user_default`), with its user-data directory pointed at the repo's git-ignored `.cache/mpfb`. |
| 25 | Character family (M0 checkpoint, 2026-09-11) | **A — MPFB2.** "Looks pretty good." Quaternius is "absolutely the wrong look" for bodies, but its walk animation is "amazing": retarget the CC0 Quaternius Universal Animation Library clips onto the MPFB rig (§4.4) rather than animating procedurally. The M0 procedural walk read as walking backwards and the arms clipped through the legs; the procedural cast "looks awful". Neither ships. |
| 26 | Underwear base layer | Male: **white boxers with red spots** (a polka-dot texture on the shorts, not plain white). Female: **white bra + white boy shorts cut like the male's M0 shorts** (`cortu_jeans_shorts` recoloured), not panties. |
| 27 | Setting | **Southeastern spring-fed river valley confirmed** ("the setting looks good"). |
| 28 | Alligator | Owner gave no preference at M0; the plan's default stands: **in-house model** (Blender script + ambientCG textures), built in M2. |
| 29 | Bite timing (M1 feedback, 2026-09-11) | Waits were too long: bite delay is now **10–40 s** (triangular, mode 20 s) instead of 15–90 s. |
| 30 | Movement feel (M1 feedback) | The player must not creep down slopes while standing; bridges must not slow the player like wading; the sprint must not double over. |

---

## 2. Vision

**Solitude Springs** presents itself as a tranquil, meditative fishing game. It is not. The player is interrupted almost constantly by campers who want to trade, partiers who trash the place, thieves, a bear, an alligator, people walking out of the river and, very rarely, a UFO.

The tone is silly and good-natured, never gory or mature. Nobody dies; people who lose a fight vanish in a red poof. All NPCs are adults.

### 2.1 Pillars

1. **Sell the lie.** The calm must be genuinely calm and beautiful, or the interruptions aren't funny. Menus, music and the opening minutes are sincere.
2. **Interruptions are the content.** They're varied, reactive and populated by memorable recurring characters.
3. **Fishing still feels good.** Despite the chaos the player makes steady progress: catches, a journal, records, a legend to chase.
4. **Silly, not mean or gross.**

### 2.2 Signature ideas (accepted)

- **Tranquil front door:** the main menu reads "Solitude Springs — *A Tranquil Fishing Experience*" over a slow golden-hour flyover and soft music. A gentle on-screen narrator tutorial ("Breathe in… cast your line…") gets cut off mid-sentence by the first thief.
- **Serenity meter** on the HUD that tanks with every interruption. Reaching 100% is the rarest achievement, and the legendary fish needs it.
- **Loading tips that slowly unravel:** from "Listen to the water." to "The aliens are not your friends."
- **Grudges:** the camper you robbed on day 1 comes back on day 3, armed.
- **People walking out of the water:** a scuba diver, a businessman asking what year it is, a woman in a swimsuit who thinks this is a different lake, a guy who's "been down there since '87."
- **Reactive dialogue:** NPCs comment on the player's outfit (underwear, a man in a dress, the pity barrel, a foil suit), trashed areas, recent abductions and drawn weapons.
- **Missing time:** an abduction advances the clock 1–3 in-game hours.
- **Developer console** to force any event, give items and set the time (dev builds only).
- **Data-driven content:** items, NPCs, dialogue, events and achievements are typed data files, so adding the 59th weirdo never touches engine code.
- **Save export/import** as a JSON file, since browser storage can be wiped.

---

## 3. Platform, stack & dependency policy

### 3.1 Target

- Desktop browsers, keyboard + mouse. Primary target is current Chromium; Firefox should work.
- No mobile/touch, no gamepad, no multiplayer, no voice acting (out of scope).
- Performance: **60 fps at 1080p on Intel Iris Xe with the Medium preset**; High/Ultra presets for discrete GPUs (e.g. the owner's RTX 4050).
- Fully offline after build: **no runtime network requests** of any kind.

### 3.2 Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict` | `erasableSyntaxOnly` (no enums/namespaces) so pure logic runs in Node's native type-stripping for tests. |
| Build/dev | Vite | `base: './'`; dev headers `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. |
| Rendering | three.js, `WebGLRenderer` (WebGL2) | WebGL2 is the most reliable on Linux Chromium. |
| Physics/movement | `@dimforge/rapier3d-compat` | Kinematic character controller (slopes, steps, bridges), boat, colliders for trees/rocks/props, raycasts for aiming and bobber landing. |
| NPC navigation | In-house trail graph + steering | NPCs mostly travel trails; off-trail approach uses local steering around tree/rock circles. No navmesh dependency. |
| UI | Plain TypeScript DOM components + CSS | Tiny in-house `el()` helper. All dynamic text via `textContent`; never `innerHTML` with data. |
| Audio | Web Audio API | Buses, synthesis, positional audio (§15). |
| Storage | IndexedDB (saves), `localStorage` (settings, bindings) | §14. |
| Unit tests | `node --test` on `tests/**/*.test.ts` | Zero extra dependencies (Node 24 strips types natively). |
| Browser tests | Chromium over the DevTools Protocol | Adapted from Florida Driver's `tools/smoke.mjs`; uses `flatpak run org.chromium.Chromium`. |

Florida Driver (`~/GolandProjects/florida-driver-3`) has proven patterns to **adapt, not copy blindly**:

- `src/game/Input.ts`: rebindable actions, pointer lock, key capture.
- `src/game/Save.ts`: sanitize-on-load and name sanitizing.
- `tools/fetch-assets.mjs`: host-pinned, checksum-verified asset downloads.
- `tools/smoke.mjs` and `tools/design-shots.mjs`: the CDP harness. Note that it must close Chromium over CDP; killing the flatpak wrapper leaves the browser running.
- `src/game/Audio.ts`: synthesized SFX.
- `src/ui/Face.ts`: Canvas 2D portrait.

### 3.3 Dependency & supply-chain policy

**Release-age buffer (the top rule).** No package version may be installed unless it was published **at least 14 days ago** *(the number lives in `.npmrc` and `tools/check-deps-age.mjs`, kept in sync)*. This covers the whole resolved tree, not just direct dependencies.

- **Native enforcement:** npm **11.10.0+** supports `min-release-age` (in days). The machine currently has npm 11.9.0, so M0 upgrades npm to a ≥11.10 release that itself satisfies the buffer. This is a global tool change, so ask the owner first. `package.json` sets `"engines": { "npm": ">=11.10.0" }` so an older npm fails loudly instead of silently ignoring the setting.
- **Fallback** (if npm can't be upgraded): `tools/npm-safe.mjs` wraps installs with `npm install --before=<today − 14 days>`. Don't combine `before` and `min-release-age` in the same config; `before` wins.
- **Independent verification:** `npm run deps:check` runs `tools/check-deps-age.mjs`. It reads `package-lock.json`, looks up the registry publish time of every resolved version, and **fails if any is younger than the buffer**. Run it after every dependency change and before every milestone checkpoint.
- Day-to-day installs use `npm ci` (lockfile only). The lockfile is committed and its diffs are reviewed.
- Tools outside npm (Blender, MPFB2) follow the same spirit: pin a stable release that has been out ≥14 days and record the exact version in §4.5.

**`.npmrc`**

```
min-release-age=14
save-exact=true
ignore-scripts=true
fund=false
engine-strict=true
```

**Allowlist.** Keep dependencies minimal. Anything not listed here needs a one-line justification added to this section first (purpose, why in-house isn't reasonable, maintainer/download sanity check, version age).

- Runtime: `three`, `@dimforge/rapier3d-compat`.
- Dev: `typescript`, `vite`, `@types/three`.
- Dev (added at M0): `@types/node` — type declarations for `node:test` / `node:assert` in the test suites and for `tools/*.ts`; DefinitelyTyped, no runtime code; version 24.13.3 (2026-07-08). `@dgreenheck/ez-tree` 1.1.0 (2026-01-15, MIT; bundled bark textures CC0, leaf textures MIT) — procedural trees, currently generated in the browser by the lab pages; will move to a build-time GLB bake (§4.5).
- Asset-pipeline (dev-only, if the chosen asset route needs them): see §4.

**Other rules**

- No `eval`/`new Function`, no remote scripts, fonts or CDNs; everything is bundled locally.
- Asset downloads are HTTPS-only from allowlisted hosts and verified against a checksum, with SHA-256 recorded in a committed manifest. Mismatch fails the fetch.
- Save files and imported JSON are untrusted input: size-limited (5 MB), schema-validated, clamped, unknown ids dropped.
- **CSP:** not required. A basic meta CSP may be added only if it causes zero friction; WASM needs `'wasm-unsafe-eval'`.
- `npm audit` is informational at checkpoints.

---

## 4. Art direction & asset strategy

### 4.1 Look

**Grounded semi-realism**, roughly "GTA V-lite". The comedy comes from situations, not a cartoon art style.

- PBR materials, HDRI image-based lighting by day, moonlit sky at night.
- Real-world proportions.
- Soft shadows, height fog and morning mist on the water, subtle bloom.
- AgX or ACES tone mapping.
- Slightly warm, saturated grading so it reads as inviting, which sells the "tranquil" lie.

**Setting (default, confirm at M0):** a Southeastern-US spring-fed river valley. This is the one real-world biome where black bears *and* alligators live together.

- Pines and oaks on the slopes, cypress and reeds in the marsh, ferns and palmetto understory.
- A crystal-clear turquoise spring pool, which makes beer-colored water stand out.
- Easter egg: a wrecked Florida Driver "Cyberwedge" in the trailhead parking lot.

### 4.2 Asset rules

- Allowed licenses: **CC0, MIT, CC-BY** (with credit). Never Mixamo raw files, never non-commercial (CC BY-NC) data, never assets whose license bans redistributing raw files.
- `ASSETS.md` at the repo root lists every third-party asset: source URL, author, license, SHA-256 and local path. Each asset folder also carries its license/attribution text. **CC-BY assets don't become Apache-2.0**; `README.md` says so.
- Build-time fetch (host-allowlisted, checksum-verified; pattern from Florida Driver's `fetch-assets.mjs`) for sources with public download URLs: Poly Haven (send a unique User-Agent per its API terms), ambientCG, pinned GitHub commits.
- Sources that need a login (Sketchfab) are downloaded **by the owner** and committed with attribution.
- Runtime format: glTF binary (`.glb`) with compressed geometry (meshopt or Draco) and compressed textures where it helps. Decoders are bundled locally from three's examples; nothing loads from a CDN.
- Assets load lazily by area/event (e.g. the UFO and aliens load the first time an abduction starts).

### 4.3 Characters — M0 look-dev bake-off (decision gate)

Characters are the biggest risk: 58 NPCs + player, swappable clothing on both body types, and many animations. **Pick exactly one character family**; mixing sources looks inconsistent. The M0 bake-off renders each candidate in the same riverbank lighting:

- a male/female lineup in the default outfits
- the same two in underwear
- the male wearing the dress
- a walk cycle and a cast pose.

The owner picks one.

| Candidate | What it is | Pros | Cons |
|---|---|---|---|
| **A. MPFB2 (MakeHuman for Blender)** — *primary candidate* | Scripted character generation in pinned Blender + MPFB2 (v2.0.17+ has seeded batch generation). Exported bodies and core assets are CC0; swimwear packs are CC-BY. | Semi-realistic. Real body-shape sliders (height, muscle, weight, proportions) for the exact male/female builds in §5. Clothing is fitted to the body. Rigs available: `game_engine` and `mixamo`. | Needs Blender installed. Headless `blender --background` scripting of MPFB is undocumented, so prove it in M0. Clothing library quality varies. Unverified whether body sliders export as glTF morph targets. |
| **B. Quaternius Universal Base Characters** — *consistent fallback* | CC0 stylized bodies, hairstyles and skin colors on one shared humanoid rig, compatible with Quaternius's animation libraries. | Very consistent. Lightweight. Animations match the rig with no retargeting. | Stylized, not GTA-like. Modern clothing (t-shirt, dress, underwear) would have to be modeled. The environment art would need to be stylized too. |
| **C. Florida Driver procedural** — *baseline only* | Ported from `florida-driver-3/src/game/Character.ts`. | Already exists. Any garment can be generated in code. | Mannequin-like and far from the requested realism. Used only as a reference point in the lineup. |

**Planned pipeline if A wins:**

- `assets-src/characters/generate.py` runs in headless Blender. It builds a **male and female player base** (one shared skeleton) and each of the 58 NPCs from roster data (§10), with seeds, sliders, skin, hair and outfit.
- Every clothing item is exported as a **separate skinned mesh bound to the shared skeleton**, fitted to both player bodies, so outfits swap at runtime by toggling meshes. The underwear layer is part of the base body.
- Skin and hair colors are material parameters, so the creator's swatches need no re-export.
- Garment colors are a tint mask, so a fished "T-shirt" can come in any color.
- NPCs are baked with their own outfits (they don't change clothes), at two levels of detail with shared texture atlases.
- If glTF morph targets aren't available, the player bodies are exported as fixed male/female presets, which is all the spec requires.

**M0 findings (2026-09-11)**

- **Headless MPFB works.** `generate.py` builds a figure (body + skin + eyes/brows/lashes + hair + rig + clothes) and exports a GLB in ~30 s; export itself is ~1.5 s. Shape keys (macro sliders) are evaluated and applied at export (`export_apply=True`, `export_morph=False`), so the player bodies are fixed presets as the spec allows. GLBs are 10–15 MB at 2048² JPEG textures (to be reduced with atlases/compression later).
- **Gotcha:** `create_human(detailed_helpers=False)` removes the joint-marker helpers the rig fits to, so the skeleton silently falls back to default joint positions and every pose deforms like rubber. Keep `detailed_helpers=True`.
- **Rig:** MPFB's `game_engine` rig has 53 bones with Unreal-mannequin names (`pelvis`, `spine_01`…, `upperarm_r`, `thigh_l`…), the same family as the Quaternius rig. Quaternius UAL clips do **not** retarget by name alone (different rest orientations; rotation-only tracks produce garbage). Retargeting has to happen in the pipeline (Blender/Mesh2Motion) in M1; for M0 the walk and cast are procedural limb-direction poses (`src/character/poser.ts`), which work on both rigs.
- **Clothes** from the CC0 packs fit both bodies (the shift dress fits the male body without edits). The male underwear is a recoloured pair of shorts for now; the female set is `wolgade_female_top_01` + `wolgade_female_panties_01`. A polka-dot texture and the "always-on underwear layer" remain M1 work.
- **Calibration:** MPFB `height` macro ≈ +1.1 m per unit; sliders 0.56 (male) / 0.55 (female) give the target ~1.83 / ~1.65 m including hair and shoes.
- **Candidate B** (free tier) only ships the two "Superhero" bodies with a baked suit texture and six hairstyles; the Regular/Teen bodies and the .blend sources are paid. Its UAL1 clips play directly (Walk_Loop/Idle_Loop verified). Every modern garment would have to be modelled and skinned. Note the site license changed to "QAL v1.0" on 2026-08-28 (non-retroactive; the downloaded archives carry CC0 text).
- **Candidate C** ported as a baseline (`lab/candidates/c/`), with underwear and male-dress variants painted/lofted procedurally.

**M1 findings (2026-09-11) — player bodies**

- `assets-src/characters/players.json` → `generate.py` builds `player_male.glb` / `player_female.glb` (23–25 MB each): one body, four hairstyles (`hair_<id>`) and nineteen garments (`garment_<id>`) as separate skinned meshes fitted to that body, plus three skin diffuse textures (`player_<sex>.skin.<key>.jpg`) for the creator's swatches. The runtime (`src/character/character.ts`) toggles meshes, swaps the skin map and tints hair/garment materials. Node names use underscores because three.js strips `.`, `:` and `/`.
- **Body under clothes:** MPFB hides body vertices under each garment with a *delete group* + Mask modifier. With every garment in one file the masks can't be applied, so they're exported as two per-vertex bitfield attributes (`_GARMENTMASKA/B`) and the body shader discards fragments under the worn garments. Bitfields must not be interpolated: the varying is `flat` and each triangle is rotated so its most-covered vertex is the provoking one (reproduces Blender's "any vertex masked → face removed").
- **Underwear layer (§1 #26):** male `cortu_jeans_shorts` with a generated red polka-dot texture; female `wolgade_female_top_01` + `cortu_jeans_shorts` in white. Each piece is shown only while its slot is empty (otherwise it pokes through the outer garment).
- Known cosmetic gaps: garment-on-garment overlap at some hems (sweater over sweatpants), the Poly Haven skin textures are photo-based so very dark tints flatten; no hat models beyond a fedora yet.

### 4.4 Animation

All clips are retargeted onto the chosen skeleton and stored as a shared animation library `.glb`.

| Source | License | Use for |
|---|---|---|
| Quaternius Universal Animation Library 1 & 2 (free Standard tiers) | CC0 | Walk/run/strafe, idle, sit, fishing, melee, flee, hit reactions. Confirm which clips the free tier includes. |
| Mesh2Motion (runs locally) | MIT code / CC0 assets | Retargeting helper and extra CC0 clips. |
| Hand-authored (Blender script or in-engine keyframes) | ours | Hands up, aim pistol/rifle, rowing, UFO float/flail, cast charge and release, reel, drink, the party dance, bear swipe reaction, dripping walk-out-of-water. |

Microsoft Rocketbox (MIT; talk, dance and drink clips) is a **reference/alternative source** only if retargeting its 3ds Max Biped rig proves easy. Its characters are not used (their clothing is baked into the body mesh, and they'd clash in style). CMU mocap is avoided (unclear redistribution terms).

**Animation layers:** full-body locomotion, plus an upper-body layer (cast, reel, aim, drink, talk gestures), plus additive lean. Procedural touches: head look-at toward the speaker or bobber, and a breathing idle.

**M1 implementation (2026-09-11).** `assets-src/characters/blender/retarget.py` imports the UAL1/UAL2 GLBs and the reference character (`male_default.glb`), then for every mapped bone applies the source bone's **world-space rotation delta from its own rest** to the target rest, after re-aiming the target rest bone along the source rest bone's direction (this removes the A-pose vs T-pose mismatch; leaves inherit the parent's alignment; the pelvis also takes the hip translation scaled by hip height). 51 clips (`assets-src/characters/animations.json`) plus the hand-authored clips from `assets-src/characters/poses.json` (`fish_idle`, `cast_charge`, `cast_release`, `cast`, `reel`, `hands_up`; poses are per-bone aims/orients in the character frame, finger shapes borrowed from retargeted clips) export to `public/assets/built/characters/mpfb/male_default.anims.glb` (7.4 MB, all channels kept). At runtime `src/character/animLibrary.ts` re-binds each clip onto any MPFB body as the same parent-space delta on that body's rest (a female-native bake and the re-bound male library are indistinguishable in the lab), and `src/character/animator.ts` runs the lower/upper split on one mixer. Verified visually in `lab/characters.html?candidate=p&shot=anim&clip=<name>`.

### 4.5 Other assets

| Need | Plan | License |
|---|---|---|
| Trees | EZ-Tree (`@dgreenheck/ez-tree`, dev-time generation exported to `.glb` via its GLB export, so not a runtime dependency) for pines, oaks and cypress. Verify its bundled textures' license, or swap in ambientCG bark. Supplemented by Poly Haven *Fir Tree 01*, *Pine Tree 01*, saplings, dead trunks and roots. | MIT / CC0 |
| Ground cover | Poly Haven ferns, grass clumps, moss and rocks. Instanced, GPU-animated grass blades (in-house shader). | CC0 |
| Textures & sky | Poly Haven + ambientCG PBR (dirt trail, forest floor, mud bank, sand, planks, bark), Poly Haven HDRIs (clear day, golden hour); the night sky is procedural. | CC0 |
| Bear | Sketchfab "Animated Bear" by AnimalMesh3D (19.6k triangles; walk/run/eat/idle), recolored to a black bear. The owner downloads it (login required). | CC-BY 4.0 |
| Alligator | No good free realistic option was found. It's mostly underwater (eyes, snout, back ridge, one lunge), so model it in-house (Blender script) with ambientCG textures. Optional upgrade: a CC-BY or paid model chosen by the owner. | ours |
| Props | Poly Haven rifle (`bolt_action_rifle_7_62`), lantern, rusted can. In-house Blender-scripted or three.js geometry: rowboat, footbridges, dock, fishing rod and bobber, knife, handgun, boot, bottles, beer cans (fresh), tents, picnic tables, speaker/boombox, cooler, signs, barrel, UFO. | CC0 / ours |
| Fish (13 species) | In-house: one shared low-poly fish mesh deformed per species + painted texture per species. Shown only when caught, in the journal and in hand. | ours |
| Aliens (3) | In-house (they're not in any character pack); generated in the chosen character family's style where possible. | ours |

**Tooling prerequisites (ask the owner before installing anything not yet installed):**

| Tool | Status | Details |
|---|---|---|
| Blender | **Installed by owner (2026-09-10)** | **5.2.0 LTS**, flathub `org.blender.Blender` (stable), commit `f97247d9…`, built 2026-07-14, so it clears the 14-day buffer. Bundled Python 3.13.13; built-in glTF exporter `io_scene_gltf2`. |
| MPFB2 | **Installed 2026-09-10: 2.0.17** (published 2026-07-22; sha256 `4f0a879d…39a87`, recorded in `assets-src/assets.json`) via `flatpak run org.blender.Blender --command extension install-file -r user_default -e <zip>`. Declares Blender ≥ 4.2 with no upper bound; runs on 5.2 (verified). User data dir set to `<repo>/.cache/mpfb` with `assets-src/characters/blender/set_prefs.py`; CC0 packs (system assets, shirts01, pants01, shoes01, dress01, underwear01, skins01/02, hair01, ≈880 MB) are fetched and unpacked there by `npm run assets`. |
| npm ≥ 11.10 | **Upgraded 2026-09-10 to 11.19.1** (nvm-managed global) | `min-release-age=14` active; `npm run deps:check` verifies the whole tree independently. |
| Mesh2Motion | Not installed | Runs locally if needed for retargeting. |
| EZ-Tree | **Installed: `@dgreenheck/ez-tree` 1.1.0** (dev dependency) | Does not run in plain Node (needs `document`); trees are generated in the browser for now. Plan: bake GLBs through the CDP harness (a lab page + `GLTFExporter`) so the game ships static trees. Poly Haven's `fir_tree_01`/`pine_tree_01` are 0.5–1 GB each and unusable. |
| `@gltf-transform/cli` | Not installed | Only if compression can't be done in Blender (justify per §3.3). |

**Running Blender headlessly** (verified 2026-09-10):

```
flatpak run org.blender.Blender --background --python assets-src/<script>.py -- <args>
```

- Background mode runs without a display.
- **Paths:** pass `--python` scripts and `--` arguments as **absolute paths**; the sandbox's working directory is `/app/blender`, not the project.
- **Filesystem:** the flatpak sandbox can read and write under `$HOME` (so the project directory), but **its `/tmp` is private**. Pipeline inputs and outputs must stay inside the repo (e.g. a git-ignored `.cache/blender/`), never in host `/tmp` or an agent scratchpad.
- **Extensions:** `--factory-startup` ignores user preferences, so extensions like MPFB2 may not load with it. Pipeline scripts either run without the flag or enable MPFB2 explicitly; verify which works at M0.
- **Network:** the sandbox has network access, but pipeline scripts must not download anything themselves. All downloads go through the checksum-verified fetch tool (§4.2).

---

## 5. Player character & creator

**Creator fields**

- **Name:** 1–24 characters after trimming, control characters stripped, duplicates allowed. A dice button picks a random silly name.
- **Body:** Male / Female.
- **Skin tone:** 10 swatches from very light to very dark.
- **Hair color:** 12 swatches (natural shades plus a few fun colors).
- **Hairstyle:** 3–4 per body type.
- **Outfit colors:** Male picks shirt color + pants color. Female picks dress color. 12 swatches each.
- The preview can be dragged to rotate, plays an idle animation, and is lit like the spring pool at golden hour.

**Builds**

- **Male:** ~1.83 m. Taller, stereotypically male: broad shoulders, muscular but not huge.
- **Female:** ~1.65 m. Shorter, athletic: smaller shoulders, prominent but not huge breasts, pleasantly round hips.
- Built with the chosen character tech's proportion controls (§4.3), within its semi-realistic style.

**Default outfits**

- **Male:** t-shirt, pants, sneakers.
- **Female:** short dress, flats.

**Underwear base layer** (always present; can't be removed, traded or stolen):

- **Male:** white boxers with red polka dots.
- **Female:** white bra and white boy shorts (cut like the male's shorts — a recoloured `cortu_jeans_shorts` in the MPFB packs — not panties; owner decision §1 #26).

---

## 6. Controls

Every binding is rebindable in **Controls** (keys and mouse buttons), with conflict detection (offer to swap) and **Restore Defaults**. Esc is fixed: browsers reserve it for releasing the mouse. Mouse sensitivity and invert-Y live in Settings. Clicking the game view captures the mouse; losing capture opens the pause menu.

| Action | Default | Notes |
|---|---|---|
| Move | W A S D | Arrow keys as secondary bindings. |
| Look | Mouse | Third-person orbit camera. |
| Jump | Space | |
| Sprint | Left Shift | Not Ctrl: Ctrl+W closes the browser tab. |
| Use item | Right mouse | **Rod:** hold to charge a cast, release to cast; press again to reel in. **Weapon:** hold to aim/threaten. **Food/bandage:** use. |
| Attack | Left mouse | While aiming a weapon: fire/stab. No effect with the rod. |
| Interact | F | Talk, trade, pick up, board/leave boat, collect cans. |
| Inventory | E | Opens the inventory and equipment screen (the world keeps running). |
| Drop selected item | Q | |
| Hotbar slot | 1–9, mouse wheel | Wheel cycles slots, as in Minecraft. |
| Camera distance | V | Cycles near / mid / far. |
| Journal | J | Fish log, people met, achievements. |
| Map | M | Painted park map with "you are here". |
| Pause | Esc | Fixed. |

**Boat:** W/S row forward/back, A/D turn, F to board or leave (only at a dock or shallow bank). Casting works while the boat is nearly stopped.

---

## 7. World

A bounded, hand-laid valley **~600 × 600 m** (about 2 minutes to walk across), authored as data (terrain control points, trail and river splines, placement zones) with seeded procedural detail (vegetation, rocks, debris).

### 7.1 Areas

1. **Trailhead** (ridge top, player start): gravel parking lot (the Cyberwedge wreck easter egg), a wooden park sign ("Solitude Springs — Find Your Peace"), a trail map board, a ranger hut, and the bench where the player respawns.
2. **Switchback Trail:** descends ~40 m through the forest to the water. NPCs arrive this way.
3. **Solitude Springs Pool:** crystal-clear spring boil at the head of the river. Home of the legendary fish. No alligators.
4. **The River:** ~800 m spring run winding through the valley, with bank trails and **three footbridges**: Cedar Bridge (short, rustic), Old Plank Bridge (creaky) and a suspension footbridge (sways).
5. **Campground:** clearing by the river with tents, fire rings and picnic tables. Campers' base.
6. **Sandy Bend:** a small beach. Parties favor it; swimsuit water-walkers emerge here.
7. **Boat Dock:** small dock with a rowboat. The boat's position is saved; it returns to the dock after a player death.
8. **Gator Marsh:** slow water with reeds and cypress knees. Better fish, alligator territory.
9. **Deep Woods:** dense, darker forest off-trail. The bear's approach direction.
10. **Boundary:** steep ridges and thick brush. Walking into it triggers a soft push-back and a dry line ("The park ends here. Your problems do not.").

**Layout order** (upstream to downstream; not to scale). The implementer sets exact coordinates, and the owner reviews them at M1.

```
        [Trailhead, north ridge]
                 │ Switchback Trail
                 ▼
     (Solitude Springs Pool) ── head of the river
                 │
           ═ Cedar Bridge ═
                 │  Campground (east bank)
        ═ Old Plank Bridge ═
                 │  Sandy Bend (west bank)
                 │  Boat Dock (east bank)
      ═ Suspension Footbridge ═
                 │
          ~~ Gator Marsh ~~ ── downstream end
```

- **Implementation note (M1):** the river is a meandering spline (`src/world/valley.ts`), so area centres, the campground, the beach, the dock, the bridges and the switchback are authored *relative to the river* (`src/data/world.ts` templates: side + offset from the water's edge) and resolved by the valley. Zones are river z-ranges.
- A bank trail runs along the east bank the whole way.
- A second trail follows the west bank from Cedar Bridge to the suspension footbridge.
- Deep Woods cover the west slopes, and boundary ridges ring the valley.

### 7.2 Water

- The river and pool are split into **~10 fishing zones** along the river spline. Each zone tracks fish population (0–100%), trash level (0–100%) and a species table.
- **Wading:** allowed while depth < 0.8 m, with slower movement, splash sounds and ripples. Deeper water gently pushes the player back ("You never learned to swim. It's a whole thing."). Held items are unaffected.
- The boat can go anywhere with depth ≥ 0.5 m.

### 7.3 Day/night *(tunable)*

- A full cycle is **24 real minutes**: dawn 2, day 12, dusk 2, night 8. The clock and day counter persist in the save.
- **Night:** moon and stars, fireflies, frogs and crickets, campfire glow, some night-only fish. Thieves and UFOs are more likely.
- Nights are moonlit enough to play without a light, but a headlamp item exists for fun.

---

## 8. Items, inventory & clothing

### 8.1 Inventory

- **Hotbar:** 9 slots. **Backpack:** 27 slots (3 × 9). Total 36.
- **Stacking:**

  | Items | Stack size |
  |---|---|
  | Fish (by species) | 10 |
  | Junk | 10 |
  | Cans | 20 |
  | Ammo | 50 |
  | Consumables | 5 |
  | Weapons, clothing, rod | 1 |

- **Inventory screen (E):**
  - backpack grid + hotbar
  - an equipment "paper doll" with a live 3D preview
  - drag-and-drop; shift-click to split a stack; double-click to equip/unequip
  - tooltips with name, a one-line joke description and stack count.
- **Full inventory:** a new catch drops at the player's feet as a pickup ("Your pockets are full. The fish looks relieved.").
- **Starter kit:** Old Fishing Rod (slot 1) plus the default outfit (worn).
- **The starter rod can't be stolen, confiscated or lost.** It's what keeps the game playable; a thief who tries says "A rod? Ugh. No."

### 8.2 Clothing slots & rules

- **Slots:** Hat, Top, Bottom, Full-body, Shoes.
- A **full-body** item (dress, swimsuit, tuxedo, jumpsuit, barrel, wetsuit) occupies Top + Bottom.
- **Anyone can wear anything.** Every garment is fitted to both body types.
- Empty top/bottom slots show the underwear base layer.
- Fished or traded clothing rolls a random color from its palette.
- NPC reactions key off the outfit (§10.4).

### 8.3 Item catalog (initial; data-driven in `src/data/items.ts`)

Value is a hidden barter value used by trading (§10.3).

**Fish** — §9.4.

**Junk (funny)**

| Item | Value | Note |
|---|---|---|
| Old Boot | 1 | Some NPCs *love* boots. |
| Glass Bottle | 1 | |
| Message in a Bottle | 3 | 12 collectible notes, readable in the Journal. |
| Beer Can | 0–1 | Also left behind by parties. |
| Rubber Duck | 2 | One NPC will trade almost anything for it. |
| Traffic Cone | 1 | |
| Garden Gnome | 3 | |
| Waterlogged Smartphone | 2 | "37 missed calls from Mom." |
| Someone's Car Keys | 1 | Return them to Lost Keys Larry (quest + achievement). |
| "World's Best Fisherman" Trophy | 4 | |
| Toilet Seat | 1 | |
| Bowling Ball | 2 | |

**Weapons & ammo**

| Item | Value | Note |
|---|---|---|
| Pocket Knife | 8 | Melee, range 1.8 m. |
| Handgun | 20 | Range 40 m, uses Pistol Ammo. |
| Rifle | 30 | Range 120 m, uses Rifle Ammo. |
| Pistol Ammo (box of 12) | 4 | |
| Rifle Ammo (box of 6) | 5 | |

**Clothing**

| Slot | Items |
|---|---|
| Top | T-shirt, Flannel Shirt, Hawaiian Shirt, Tank Top |
| Bottom | Jeans, Cargo Shorts, Sweatpants, Board Shorts |
| Full-body | Short Dress, Sundress, Ball Gown (rare), One-piece Swimsuit, Wetsuit, Tuxedo, Silver Jumpsuit (UFO), Barrel (thief pity) |
| Shoes | Sneakers, Hiking Boots, Flip-flops, Flats |
| Hat | Bucket Hat, Trucker Cap, Cowboy Hat, Headlamp (emits light), Tinfoil Hat |

**Consumables & misc**

| Item | Value | Effect |
|---|---|---|
| Bandage | 3 | +2 hearts |
| Granola Bar | 2 | +1 heart |
| Burger | 3 | +2 hearts (campers) |
| Pizza Slice | 3 | +2 hearts |
| Lavender Oil | 4 | +20 serenity |
| Lucky Lure | 12 | While carried: rare-catch chance ×1.25 |
| Trash Bag | 2 | Cleaning cans counts double |

### 8.4 Catch table (defaults, tunable per zone and time of day)

| Category | Share | Breakdown |
|---|---|---|
| Fish | 72% | By zone and time, §9.4 |
| Junk | 18% | |
| Clothing | 6% | |
| Weapons & ammo | 4% | Knife 40%, pistol ammo 25%, rifle ammo 15%, handgun 14%, rifle 6% |

A zone with low population shifts share from fish to junk. A trashed zone yields junk and cans only.

---

## 9. Fishing

### 9.1 Casting

1. With the rod selected, **hold right mouse**: a charge meter fills over 1.5 s and holds at max *(tunable)*.
2. **Release to cast.** Distance is 3–25 m by charge, aimed along the camera's facing direction.
3. The bobber flies in an arc (with collision).
   - **Lands on water:** plop, ripples, and the wait begins.
   - **Hits ground, a tree or a bridge:** thunk, auto-reel. Hitting trees 10 times earns a joke achievement.

### 9.2 Waiting and biting *(all tunable)*

- **Bite delay:** random 10–40 s (triangular distribution, mode 20 s; owner decision §1 #29, was 15–90), multiplied by zone population:
  - below 50%: delay ×1.5
  - 0%: no bites at all (the float just sits there).
- **Nibbles:** 0–2 fake-out twitches before a real bite. Reeling on a nibble counts as reeling early.
- **Bite:** the bobber dips and bobs hard for the **bite window**, with a *bloop-bloop* sound and splash rings. An optional HUD "!" bite indicator (on by default) helps accessibility.

  | Catch | Window |
  |---|---|
  | Common | 3.0 s |
  | Rare | 2.0 s |
  | Legendary | 1.5 s |

- **Right mouse inside the window:** 1.5 s reel animation, then the catch reveal. The player holds it up, a toast shows name + weight ("Largemouth Bass — 4.2 lb · New record!"), and it goes into the inventory. The journal updates.
- **Missed window:** "It got away." The line stays out and a new delay starts.
- **Right mouse while waiting:** reels in empty. No penalty.

### 9.3 Line rules

- **The line stays out during conversations, trading and the inventory**, so bites can be missed while you're stuck talking. That's the joke. With "Pause during conversations" on, the bite timer pauses too.
- **Auto-reel** when the player:
  - moves >30 m from the bobber
  - switches hotbar item
  - boards or leaves the boat
  - is grabbed by an event (bear swipe, gator lunge, abduction).
- Every catch lowers zone population by 3%. Population regrows +10% per in-game hour toward 100%, unless the zone is trashed (§11.4).

### 9.4 Fish species (13)

| # | Species | Rarity | Where / when | Weight (lb) | Value |
|---|---|---|---|---|---|
| 1 | Bluegill | Common | Anywhere, day | 0.2–1.2 | 2 |
| 2 | Redear Sunfish | Common | River, day | 0.2–1.5 | 2 |
| 3 | Golden Shiner | Common | Anywhere | 0.1–0.6 | 1 |
| 4 | Black Crappie | Common | River, dusk/night | 0.3–2.5 | 3 |
| 5 | Striped Mullet | Uncommon | Pool + upper river | 1–5 | 4 |
| 6 | Chain Pickerel | Uncommon | River, day | 1–5 | 5 |
| 7 | Largemouth Bass | Uncommon | Anywhere, dawn/dusk best | 1–12 | 6 |
| 8 | Channel Catfish | Uncommon | River/marsh, night | 1–20 | 6 |
| 9 | Bowfin | Uncommon | Marsh | 2–12 | 5 |
| 10 | Longnose Gar | Rare | Marsh | 3–25 | 10 |
| 11 | Alligator Gar | Rare | Marsh, night | 20–120 | 25 |
| 12 | Suspiciously Glowing Perch | Very rare | Anywhere, night, within 1 in-game day after a UFO visit | 0.5–2 | 40 |
| 13 | **Old Gus** (legendary bass) | Legendary | Spring Pool only | 25–40 | 100 |

**Old Gus** bites only when serenity has been **100% for 3 continuous minutes** while fishing the pool. The Director (§11.2) occasionally grants a quiet "lull" window that makes this possible but rare.

Weights are skewed toward the low end. Records per species go in the Journal.

---

## 10. NPCs & the roster

### 10.1 NPC data model (`src/data/npcs/*.ts`)

Each of the 58 is a typed record:

- **Identity:** `id`, `name`, `archetypes` (camper, hiker, partier, thief, water-walker, ranger, oddball).
- **Look:** body/build sliders, skin, hair, outfit, accessories, height.
- **Voice:** pitch, speed, timbre.
- **Personality:** traits, 3–6 catchphrases and a signature gag.
- **Armed:** `none | knife | handgun | rifle`.
- **Trading:** `wants` / `dislikes` / `refuses` item tags and a greed factor.
- **Loot table, schedule** (day/night weights, favorite areas) and dialogue tree ids.
- **Links** to other NPCs (family, rivals) for cross-references.

### 10.2 Memory (saved per NPC)

- **Counters:** times met, times robbed by the player, times poofed.
- **Relationship** −100 to +100, and a grudge flag.
- **State:** current inventory (including anything stolen from the player), last-seen day.
- **Quest flags** (e.g. keys returned).

A poofed NPC isn't gone forever. They re-enter the pool after 1 in-game day with a new line ("I poofed. In front of everyone.") and, if they were hostile, a grudge.

### 10.3 Dialogue & trading

**Dialogue trees**

- Nodes hold NPC lines (with random variants) and player choices.
- Choices can require: has item, wearing X, relationship, time of day, recent event, weapon drawn.
- Effects: give/take item, relationship ±, set flag, open trade, start robbery, end.
- **UI:** a bottom-screen box with NPC name + portrait, a typewriter effect with gibberish voice blips, then numbered choices (click or 1–4 keys). Click skips the typing.

**Trading**

- Two panels: your inventory and theirs. Build an offer by moving items across.
- The NPC values each item as `base value × personal multiplier`: wants ×2 (their favorite ×3), dislikes ×0.25, refuses = won't take it.
- A mood face and quips react live ("A *boot*? Now we're talking.").
- **Deal** when `your offer ≥ their items × (1 + greed) − relationship bonus`.
- Completed trades raise the relationship.

### 10.4 Reactive barks

Shared line pools with per-NPC overrides, triggered by player state:

- in underwear / wearing the barrel / a man in a dress / a woman in a tuxedo / tinfoil hat
- standing in a trashed area / recently abducted ("You look… probed.")
- holding a weapon / carrying Old Gus / wading.

These make every repeat encounter feel different and multiply the comedy cheaply.

### 10.5 Roster (58 adults)

One-line seeds; full dialogue is written in M2/M3 and reviewed at checkpoints. **Armed** NPCs fight back when threatened (§12.2).

**Campers (14)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 1 | Barb Kowalski | – | Has camped here every summer since 1979; shares "secret spots" (all wrong). |
| 2 | Trent Hollister | – | Glamping influencer narrating to his phone; wants anything "aesthetic." |
| 3 | Wade Pruitt | rifle | Survivalist camped 200 m from his truck; trades MREs. |
| 4 | Priya Natarajan | – | Birdwatcher furious that you're scaring the warblers. |
| 5 | Mike Henderson | – | Obsessed with his new propane grill; trades burgers. |
| 6 | Linda Henderson | – | Asks if you've seen her kids. (They're at the party.) |
| 7 | Old Man Tobias | handgun | Insists the river is cursed; sells Lucky Lures; grumpy. |
| 8 | Kai Lindqvist | – | Van-lifer who trades everything for "vibes" and your boot. |
| 9 | Sister Margaret | – | Nun on a silent retreat; alarmingly competitive about fishing. |
| 10 | Chad Brewster | knife | Brought a machete to open a bag of chips. |
| 11 | Wendy Oyelaran | – | Scout leader who lost her troop; awards merit badges for anything. |
| 12 | Harold Voss | – | Retired accountant; itemizes and "audits" every trade. |
| 13 | Jolene Parrish | handgun | Tough RV grandma; trades homemade jerky. |
| 14 | Benji Castellanos | – | Ukulele guy who knows exactly one song. |

**Hikers & passersby (10)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 15 | Brenda Tuck | – | Power-walker who never stops; talks while circling you. |
| 16 | Marcus Webb | – | Trail runner who asks for directions, then ignores them. |
| 17 | Phil Anders | – | Geocacher convinced you're sitting on his cache. |
| 18 | Nate Sorensen | – | Nature photographer; wants you to "act natural" for 40 minutes. |
| 19 | Glenn Hargrove | – | Metal-detector enthusiast who beeps at your pockets. |
| 20 | Rosa Delgado | – | Mushroom forager offering "Probably Fine Mushrooms" (random ±1 heart). |
| 21 | Todd Bramble | knife | Self-taught wilderness "expert," confidently wrong. |
| 22 | Gwen Ashby | – | Sells essential oils; trades Lavender Oil. |
| 23 | Luis Ortega | – | Walking an invisible dog named Biscuit. Have you seen Biscuit? |
| 24 | Conspiracy Carl | – | Knows about the UFO. Nobody believes him. Trades Tinfoil Hats. |

**Partiers (10; arrive in groups of 4–6)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 25 | Tyler "T-Bone" Henderson | – | Linda's son; "at the library." |
| 26 | Madison Henderson | – | Linda's daughter; "Mom *cannot* know." |
| 27 | Brayden Stokes | – | Carries the speaker; bass-boosts everything. |
| 28 | Kayla Ruiz | – | Livestreams the party; wants you in the stream. |
| 29 | Jake "Chugs" Morrison | – | Challenges you to a chugging contest (you decline; he wins anyway). |
| 30 | Destiny Park | – | Starts a conga line with anyone, including the bear. |
| 31 | Colton Briggs | knife | "It's a bottle opener. Technically." |
| 32 | Ashley Nguyen | – | Designated driver; the only one who apologizes to you. |
| 33 | Zach "Dozer" Dunn | – | Falls asleep in the river; sometimes walks back out of it later. |
| 34 | Sierra Blake | – | Throws her giant flamingo floaty onto your fishing spot. |

**Thieves (8)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 35 | Slippery Pete | knife | Classic sneak in a striped shirt; "Nothing personal." |
| 36 | Velvet Vivian | handgun | Professional; leaves a business card in your pocket. |
| 37 | Ricky Two-Shoes | – | Only steals shoes; has 400 left shoes. |
| 38 | Vernon "Raccoon" Mills | – | Dresses like a raccoon; steals shiny things and fish. |
| 39 | Candy Lowe | – | Cries until you look away, then robs you. |
| 40 | Big Earl | rifle | Enormous, polite, apologizes the whole time. |
| 41 | Sticky Stacy | – | Glue gloves; takes more than she means to, including leaves. |
| 42 | Reginald Pike | knife | Gentleman thief; asks permission, takes it anyway. |

**Water-walkers (6)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 43 | Deep Dive Doug | – | Scuba diver; insists there's a whole city down there. |
| 44 | Graham Whitfield | – | Soaked businessman in a suit asking what year it is; late for a 1998 meeting. |
| 45 | Marina Costa | – | **Woman in a swimsuit** (owner idea); open-water swimmer who thinks this is Lake Tahoe and asks where the finish line is. |
| 46 | Mullet Steve | – | "Been down there since '87"; neon windbreaker; asks if Walkmans are still cool; loves Striped Mullet. |
| 47 | Coral Reefsworth | – | Mermaid-convention attendee, fully in character. |
| 48 | Lost Keys Larry | – | Dives for his car keys; return them (a fished item) for a reward. |

**Rangers (2)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 49 | Ranger Rhonda Kessler | handgun | By-the-book; confiscates weapons; secretly exhausted. |
| 50 | Ranger Tom Buckley | handgun | Rookie on his first week; terrified of you, the bear and paperwork. |

**Oddballs (8)**

| # | Name | Armed | Seed |
|---|---|---|---|
| 51 | Fisherman Frank | – | Rival angler who wants your spot and brags nonstop. |
| 52 | Silas the Hermit | rifle | Lives in the Deep Woods; hates visitors; loves anyone who brings cans. |
| 53 | Can Man Stan | – | Collects cans; the best trade partner after a party. |
| 54 | Coach Skye | – | Wellness coach leading a meditation that the Director always interrupts. |
| 55 | Dr. Penelope Grimsby | – | Bigfoot researcher; mistakes you for Bigfoot when you're in underwear or the barrel. |
| 56 | Kevin the Delivery Guy | – | Lost, with a pizza addressed to "Solitude Springs, the river." |
| 57 | Jessica Albright | – | Runaway bride still in her gown, looking for peace too; a kindred spirit. |
| 58 | Gerald the Mime | – | All his dialogue is stage directions; you answer in gestures. |

**Not part of the 58**

- **Aliens:** Zib, Xorp, Commander Blorvo. They "interview" you during abductions.
- **Animals:** the bear and the alligator (Chompers). A trailhead sign reads: "No alligators have ever been reported at Solitude Springs."

### 10.6 Dialogue writing guidelines

**Tone**

- Silly, warm and absurd, like a family sitcom. Roughly a T rating for cartoon violence.
- The humor comes from the *situation*: a man stuck in a fished-up dress, a thief who pities you, a nun who trash-talks your casting.
- Never make the joke about someone's body, gender, ethnicity, religion, disability or orientation.

**Outfit reactions**

- NPCs react to the *circumstance* ("Rough morning?", "Bold choice for a hike"), never the wearer's identity.
- NPCs are confused, impressed or jealous of a man in a dress — never mocking.

**Content limits**

- Mild language only; no slurs.
- Partiers drink and are clearly adults (21+). Apart from the "Probably Fine Mushrooms" foraging gag, no drug references.
- No sexual content or innuendo, including about the player's body or underwear.
- Fights stay cartoonish ("poof"): no death, blood or injury detail.
- No real people, brands, or copyrighted characters, songs or quotes.

**Format**

- Lines ≤ 140 characters; 2–4 player choices per node.
- Every NPC needs:
  - a greeting and a goodbye
  - ≥ 3 small-talk variants
  - a trade intro (if they trade)
  - a robbed reaction
  - either a hands-up line (unarmed) or a fight-back line (armed)
  - a poof-return line
  - overrides for at least 3 bark categories (§10.4).

**Consistency & variety**

- Lines follow each NPC's seed and catchphrases.
- Recurring NPCs acknowledge their memory: met before, traded, robbed, poofed.
- The cast varies in ethnicity, age (all adults) and body type. Don't cluster any group into thief or other negative roles.

---

## 11. The Annoyance Director & events

### 11.1 Serenity meter

- **Range:** 0–100, shown as a small leaf icon + bar on the HUD. A new game starts at 60.
- **Rises** +1 every 3 s while no NPC or animal is within 30 m and no event is active.
- **Drops** when events begin: minor −15, major −40, abduction to 0. Getting hurt −10.
- **At 100:** achievement *Actual Solitude*. Held for 3 continuous minutes at the Spring Pool, Old Gus can bite.

### 11.2 Director (pure logic in `src/sim/director.ts`; all numbers tunable)

**Grace periods**

- **New game:** 4 min of genuine calm (tutorial narrator, calm music), ending with a scripted thief who interrupts the narrator mid-sentence.
- **After loading a save:** 90 s.

**Pacing**

- The target gap between events starts at a mean of **150 s** after the grace period and ramps to **60 s** over the first 30 minutes of a session, with ±40% randomness.
- **Minimum gaps:** 25 s after a minor event, 60 s after a major one.
- **Fishing makes it worse:** while the line is in the water, event odds rise ×1.3.
- **Concurrency:** at most **one active event**, plus optional ambient passersby who only wave or bark.

**Lulls**

- Roughly once per in-game day, a random 3–6 minute window with no events. The player isn't told.
- Lulls are the realistic chance at 100% serenity and Old Gus.

**Picking an event**

- Weighted random over eligible events. Eligibility checks time of day, player area, water proximity, inventory and cooldowns.
- The Director then chooses a roster NPC matching the archetype: preferring ones not seen recently, sometimes a returning one with a story beat (grudge, quest).

**Offline tuning:** `npm run simulate` runs the Director plus a fishing model headlessly over hundreds of simulated hours and reports:

- events per hour by type
- fish per hour
- the share of bites lost to interruptions
- time-to-first-Old-Gus.

**Pacing targets** *(adjust after the owner play-tests)*:

- ≥ 8 fish per hour for an attentive player after the first 30 min
- 30–60 events per hour at full ramp
- median time-to-Old-Gus 3–6 hours of play.

### 11.3 Event table (defaults)

| Event | Class | Weight | Conditions | Cooldown |
|---|---|---|---|---|
| Camper visit | minor | 30 | Dawn/day/dusk | 2 min |
| Hiker / chatty passerby | minor | 20 | Any | 1 min |
| Water-walker | minor | 10 | Player within 15 m of water | 5 min |
| Thief | major | 15 (night ×2) | Always eligible (thieves take clothes if nothing else) | 5 min |
| Party | major | 8 | Day/dusk; player within 40 m of water; not in the marsh | 12 min |
| Bear | major | 6 | Player carries ≥1 fish; not in the boat | 10 min |
| Alligator | major | 6 | Player near water in river/marsh zones (never the Pool); in the boat counts | 8 min |
| UFO abduction | major | 1.5 (night ×3) | ≥20 min into the save; not indoors/under the bridge deck | 45 min |
| Park Ranger | major | forced | Wanted level ≥ 2 (§12.3) | 10 min |
| Grudge return | major | 8 | An NPC with a grudge was last seen ≥1 in-game day ago | 15 min |

Every event can be forced from the debug console (§18.3).

### 11.4 Event behavior

**Camper / hiker visit**

- 1–2 roster NPCs walk in along the nearest trail and greet the player; greeting barks react to outfit and context.
- Talk options: chat, trade (campers), goodbye. After 60–90 s of no interaction they drift off.

**Water-walker**

- A roster water-walker rises from the river near the player, dripping (water-sheen shader + drip particles).
- They walk up the bank, deliver their bit, may trade or give a quest, then leave by the trail.

**Thief**

1. **Approach:** most sneak up from behind (soft footsteps, a HUD caption "*rustling behind you*"); some stroll up openly with a line.
2. **Theft:** a 3 s "rummaging" animation with a progress ring above the thief.
3. **What they take:** 1–4 items weighted by value and the thief's `wants` (Ricky only takes shoes). The starter rod is never taken.
4. **Nothing they want:** they take **all worn clothing** (hat, top, bottom, full-body, shoes), leaving the underwear base layer.
5. **Already in underwear:** a pity beat. The thief sighs and gives the player the **Barrel** ("Put this on. Please."). Achievement *Barrel of Laughs*.
6. **Getaway:** the thief flees toward the boundary for up to 40 s, carrying the loot in their NPC inventory.
7. **Recovery:**
   - Catching up and threatening or poofing them returns everything.
   - A thief who escapes keeps the items and may **turn up later still holding them**.
8. **Resistance:** drawing a weapon before the rummage finishes applies the confrontation rules (§12.2). The thief is fair game once caught stealing.

**Party**

1. **Arrival:** 4–6 partiers arrive near the player's current zone, carrying a speaker and a cooler.
2. **The party (30 s, tunable):** loud bass-heavy music ducks the calm score, with dancing, drinking animations, whooping and a flamingo floaty in the water.
   - Partiers can be talked to (drunk dialogue; they may hand over a Beer Can).
   - Threatening them scatters them early (achievement *Buzzkill*), but **the damage is still done**.
3. **Aftermath:** a ~35 m radius around the party center becomes a trashed zone:
   - **grass turns brown** (terrain color mask blended in the shader)
   - **15–30 cans** and red cups are scattered as pickups
   - **the river turns beer-colored** in that zone: amber tint + foam on the water.
   - Zone fish population is set to **0**; the zone yields junk only.
4. **Recovery:** over **2 in-game days** (48 real minutes, tunable) the grass and water blend back.
   - Population can only start regrowing once water tint is below 50%.
   - Each can collected (F) cuts remaining recovery by 2% (4% with a Trash Bag).
   - Collecting every can sets water tint to 0 and awards *Leave No Trace*.
   - Cans are tradeable junk (Can Man Stan pays well).
   - Trash state and remaining can positions persist in the save.

**Bear**

1. **Warning (5 s):** crashing brush sound, birds scatter, caption "*something big is coming*".
2. **Approach:** the bear emerges from the nearest forest edge, walks to the player and sniffs.
3. **Theft:** it takes **all fish** from the inventory, with a swipe animation as the fish fly into its mouth. It ignores everything else, then lumbers off.
   - **No fish:** it huffs disapprovingly and leaves (it may take a Granola Bar or Burger).
4. **Scaring it off:** attacking toward it with a drawn weapon (warning shot or knife wave) sends it running before the swipe. The fish are kept; achievement *Bear Necessities*.
5. **It never damages the player.**

**Alligator**

1. **Approach (3–4 s):** eyes and nostrils glide toward the bank, with a V-shaped ripple wake and an original low, ominous motif.
2. **Lunge:** if the player is still within 2.5 m of the water edge (or in the boat), the gator lunges:
   - **on the bank:** −2 hearts + knockback
   - **in the boat:** the boat rocks, −1 heart.
3. **Scaring it off:** attacking toward it with a weapon during the approach sends it under with a splash (*See You Later*).
4. Wading in the marsh at night doubles the odds.

**UFO abduction (~25 s)**

1. **Omen:** electrical hum, animals go silent, the HUD glitches and lights flicker.
2. **Descent:** a saucer descends overhead with a spotlight; the rod auto-reels.
3. **Beam-up:** controls lock and the player floats up in a tractor beam, flailing.
4. **Interior vignette (skippable after first time):** a short scene with Zib, Xorp and Commander Blorvo "interviewing" the player (2–3 dialogue choices, silly questions about fish).
5. **Return:** the player is beamed down to **the exact position and facing they were taken from**.
   - **All worn clothing is replaced** by a random outfit, weighted toward odd pieces (Silver Jumpsuit, Tinfoil Hat, Ball Gown, Tuxedo, Wetsuit…). The aliens keep the originals.
   - **Missing time:** the clock jumps 1–3 in-game hours.
   - For the next in-game day, Suspiciously Glowing Perch can bite.
   - NPCs comment ("You look… probed.").

**Park Ranger** — §12.3.

**Grudge return**

- A previously robbed or poofed NPC walks up with a callback line.
- **Armed:** they threaten the player first (the player may back down by handing over an item, or fight).
- **Unarmed:** they try to steal back what was taken.

---

## 12. Weapons, health & reputation

### 12.1 Weapon handling

- Select a weapon in the hotbar. **Hold right mouse** to aim: over-the-shoulder camera, crosshair, and a highlight on the targeted person or animal. **Left mouse** to fire or stab.
- **Knife:** melee arc, 1.8 m.
- **Handgun / Rifle:** hitscan with a slight spread (rifle: tighter), 40 m / 120 m. Each shot uses one round of matching ammo from the inventory. No manual reload; a short reload animation plays every 8 (handgun) / 5 (rifle) shots. Out of ammo: *click*.
- Sounds are punchy but not realistic-gory. The muzzle flash is a small spark. There are **no blood, bodies, ragdolls or wounds anywhere in the game**.

### 12.2 Confrontation rules

Every human NPC is in one of three states:

- **Innocent** — the default for everyone who hasn't done anything to the player.
- **Threatening** — a thief mid-theft or fleeing with loot, or a grudge-returner making demands.
- **Hostile** — has attacked or drawn on the player.

**Against an Innocent**, the weapon **won't fire or stab**. The trigger pull or stab motion stops short and nothing hits. Instead, attacking *or* aiming at them for more than 1.5 s makes them react:

- **Unarmed:** **hands up**, frightened line. A robbery dialogue opens:
  - "Hand something over" (the player picks one item from their inventory)
  - "Everything!" (up to 3 random items; bigger relationship hit)
  - "Just kidding!" (relationship −20, no wanted)
  - "Leave."

  Any robbery adds **+1 wanted** (§12.3) and gives the NPC a grudge.
- **Armed:** they draw and become **Hostile**, then fight back ("Oh, it's like *that*?").

**Against Threatening or Hostile NPCs**, weapons work normally.

- NPC health: knife 2 hits, handgun 2 shots, rifle 1.
- At zero the NPC vanishes in a **red poof**: particle burst, cartoon *pop*, a floating hat that drops.
- They leave a **loot bag** with their inventory, including anything stolen from the player.
- An unarmed Threatening thief who's aimed at simply surrenders (hands up, returns stolen items, may be robbed back — robbing a thief doesn't raise wanted).

**Hostile NPC attacks**

- Punch: −1 heart. Knife: −1. Handgun: −1 per hit. Rifle: −2.
- Their aim is deliberately bad; they retreat when at 1 health.

**Animals** can't be damaged. Any weapon attack toward them during their approach scares them off (§11.4).

### 12.3 Reputation (wanted) & the Park Ranger

- A hidden **wanted** value.
  - **Raises it:** robbing an innocent +1; threatening an armed innocent into a fight +0.5.
  - **Never raises it:** poofing Hostile or Threatening NPCs.
  - **Decay:** −1 per in-game day.
- **At wanted ≥ 2:** a ranger event is forced. Ranger Rhonda (or rookie Tom if Rhonda was poofed recently) arrives and lectures the player in dialogue. They **confiscate the player's best weapon** plus one item as a "fine", and wanted resets to 0. Achievement *Most Wanted* on the first confiscation.
- **Rangers are armed innocents:** threatening one makes them Hostile. Poofing a ranger adds +2 wanted, and the next ranger event sends both rangers.

### 12.4 Player health & death

- **5 hearts** (10 half-hearts). Regenerates 1 half-heart every 30 s after 10 s without damage. Food and bandages heal.
- **At zero:** the player red-poofs, the screen fades, and they wake on the trailhead bench.
  - **Lost:** all carried fish.
  - **Kept:** everything else (items, worn clothes, journal, stats) and **all achievements, always**.
  - Serenity resets to 50. The boat returns to the dock. Achievement *Poof!* on first death.

---

## 13. Achievements (per save; never lost)

- Shown as a toast with a soft chime when unlocked. Listed in the Journal (J) and the pause menu with unlock date and progress.
- **Secret** achievements show as "???" until earned.
- Defined as data: `id`, name, description, category, secret flag, and a trigger (an event-bus predicate or counter threshold).

**Fishing**

| Name | How to earn |
|---|---|
| First Catch | Catch your first fish. |
| Dinner Is Served | Catch 10 fish. |
| Seasoned Angler | Catch 50 fish. |
| Reel Legend | Catch 250 fish. |
| Gotta Log 'Em All | Catch all 12 non-legendary species. |
| The Big One | Catch a fish over 10 lb. |
| Old Gus | Catch the legend. |
| Night Shift | Catch 10 fish at night. |
| Boat Life | Catch a fish from the boat. |
| Sole Survivor | Fish up a boot. |
| Armed Angler | Fish up a firearm. |
| Too Eager | Reel in on a nibble 10 times. |
| It Got Away | Miss 25 bites. |
| Casting Into the Trees | Hit a tree with your cast 10 times. |

**Defense**

| Name | How to earn |
|---|---|
| Not Today | Stop a thief before they take anything. |
| Repo Man | Recover stolen items. |
| Poof, There It Is | Poof a hostile. |
| Bear Necessities | Scare off a bear before it takes your fish. |
| See You Later | Scare off an alligator. |
| Buzzkill | Break up a party early. |
| Grudge Match | Deal with someone who came back for revenge. |

**Misfortune**

| Name | How to earn |
|---|---|
| Robbed Blind | Get robbed 10 times. |
| The Emperor's New Clothes | Get stripped to your underwear. |
| Barrel of Laughs | Receive the pity barrel. |
| Close Encounter | Get abducted. |
| Frequent Flyer | Get abducted 3 times. |
| Gator Bait | Get bitten 5 times. |
| Grizzly Tax | Lose 50 fish to bears. |
| Hope Springs Eternal | Cast into beer-colored water 10 times. |
| Worst Day Ever | Get robbed, stripped, and lose fish to a bear in the same in-game day. |
| Poof! | Get poofed yourself. |

**Social**

| Name | How to earn |
|---|---|
| Hello, Neighbor | Talk to 10 different people. |
| Social Butterfly | Meet all 58 regulars. |
| Shrewd Barterer | Complete 25 trades. |
| One Man's Trash | Trade a piece of junk for something worth 10+. |
| Leave No Trace | Clean every can from a trashed area. |
| Trailway Robbery | Rob someone. |
| Most Wanted | Have a ranger confiscate a weapon. |
| Is This Yours? | Return Lost Keys Larry's car keys. |

**Humor & secrets**

| Name | How to earn |
|---|---|
| Actual Solitude | Reach 100% serenity. |
| Breezy | Wear a dress for a full in-game day as a character who didn't start in one. |
| Dapper | Wear a tuxedo for a full in-game day as a character who didn't start in one. |
| Dressed by the River | Wear a full outfit made entirely of fished-up clothes. |
| Believer | Wear the Tinfoil Hat while talking to Conspiracy Carl. |
| Castaway | Collect all 12 messages in bottles. |
| Oarsome | Row the boat 1 km total. |
| A Tranquil Fishing Experience | Play for 60 minutes total. |
| Did Anyone See That? *(secret)* | Get abducted mid-conversation. |
| Conga! *(secret)* | Join Destiny's conga line with the bear nearby. |

---

## 14. Saving

### 14.1 Storage

- **Saves:** IndexedDB database `solitude-springs`, object store `saves`, keyed by a random save id. One record per character.
- **Settings and key bindings:** `localStorage` (they apply to every save).

### 14.2 Save record (`schemaVersion: 1`)

| Part | Contents |
|---|---|
| Header | `id`, `schemaVersion`, `createdAt` and `savedAt` (**ISO 8601 UTC**), `playTimeSeconds`, a small portrait thumbnail (PNG data URL, optional). |
| `character` | name, sex, skin, hair color, hairstyle, outfit colors. |
| `player` | position, facing, health, in-boat flag, hotbar, backpack, equipped clothing, selected slot. |
| `world` | clock (day number + time of day), zones (population, trash level, remaining can ids/positions), boat position, dropped pickups. |
| `npcs` | memory per roster id (§10.2), including inventories. |
| `director` | pacing phase, cooldowns, last-event times, wanted, lull state, UFO-recent flag. |
| `progress` | achievements (id → unlock ISO date), counters and stats, journal (species records, messages found, people met), serenity. |
| `rng` | seed and state, so procedural placement is stable. |

### 14.3 When the game saves

- **Autosave** every **60 s** *(tunable)*.
- Also right after: a catch, a trade, an achievement, an event ending, a death/respawn.
- Also on: opening the pause menu, "Save & Quit", and the browser hiding or closing the tab.
- A small spinning-leaf icon shows while saving.
- **In-flight events aren't serialized.** Their effects applied so far are (stolen items, trashed zone). On load, the world resumes calm with the 90 s grace period.

### 14.4 Load screen

- Newest first. Each row reads `{date} {name}` with the date formatted by `Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' })` in the player's locale and time zone. For example, en-US shows "September 5, 2026 at 1:54 PM Ryaaaaaaan".
- Secondary line: day count, fish caught, play time. Portrait thumbnail.
- **Actions:** Load, Delete (with confirmation), Export (downloads `.json`), Import (file picker).

### 14.5 Robustness

- **Validation on every load and import:** type checks, clamped numbers, sanitized name, unknown item/NPC/achievement ids dropped, 5 MB size limit. Pattern from Florida Driver's `sanitizeSave`, extended to the larger schema.
- **Migrations:** functions keyed by `schemaVersion`.
- **Damaged saves:** an unreadable save is listed as "Damaged save" with Export and Delete only.
- Writes happen in a single IndexedDB transaction, so a crash mid-write can't corrupt the previous save.

---

## 15. Audio

**Buses and settings sliders**

- Master, Music, Ambience, Effects, Voices, Interface.
- A master mute toggle.
- "Mute when the tab is in the background" (on by default).

**Music (generative, synthesized in Web Audio)**

- **Calm score:** soft plucked guitar/piano phrases, warm pads and gentle chord changes that shift between day and night.
- **Interruptions:** the score **ducks with a record-scratch** when a major event begins, then fades back in once calm.
- **Party music:** a loud, bass-heavy synthesized dance loop, positional (muffled and distant as you walk away).
- **Motifs:** UFO (theremin-like warble), alligator (original ominous low motif, not an imitation of any film theme), bear (low brass stab).

**Ambience**

- River flow positioned along the river spline; spring bubbling at the pool.
- Wind in the trees.
- Birdsong by day; frogs, crickets and an owl at night.

**Effects**

- **Movement:** footsteps by surface (dirt, gravel, planks, shallow water).
- **Fishing:** cast whoosh, reel clicks, bobber plop, bite bloops, catch splash.
- **Interface:** inventory clicks.
- **Events:** can crunch, poof pop, knife swish, gunshots (punchy, not gory), bear roar, gator hiss and snap, UFO hum and beam, boat oars and creaks.

**Voices**

- Gibberish syllable blips per NPC (pitch, speed and timbre from roster data), synced with the dialogue typewriter.

**Sources**

- Synthesis first (Florida Driver's `Audio.ts` shows the approach).
- If the ambience or footsteps sound too artificial at the M1 checkpoint, add **CC0 recordings** through the checksum-verified fetch, with each file logged in `ASSETS.md`.

---

## 16. Menus, HUD & UI

**Visual style:** warm, calm "nature brochure" — soft cream panels, serif display titles, rounded controls, gentle transitions. This makes the chaos funnier.

### 16.1 Screens

- **Main Menu.** Slow camera flyover of the springs at golden hour; logo "Solitude Springs — *A Tranquil Fishing Experience*".
  - Buttons: New Game, Load Game, Settings, Controls, Credits.
  - Rare gag: a tiny UFO crosses the distant sky.
- **New Game.** The creator (§5) → Begin → a short intro and the tutorial narrator.
- **Load Game** (§14.4).
- **Settings**

  | Group | Options |
  |---|---|
  | Audio | Sliders (§15). |
  | Gameplay | **Pause during conversations** (off by default; also covers trading), bite indicator, text speed, camera shake. |
  | Graphics | Preset (Low/Medium/High/Ultra), shadows, render scale, vegetation density, draw distance, field of view. |
  | Mouse | Sensitivity, invert Y. |

- **Controls** (§6): action list, click to rebind, conflict handling, Restore Defaults.
- **Pause menu (Esc):** Resume, Journal, Settings, Controls, Save & Quit to Menu.
- **Credits:** team, tools, and every third-party asset with its license (generated from `ASSETS.md`).
- **Loading screen:** degrading tips ("Listen to the water." → "Breathe." → "Guard your shoes." → "The aliens are not your friends.").

### 16.2 HUD

- **Hotbar** bottom center. **Hearts** above the hotbar, left.
- **Serenity** leaf meter top left. Day/night clock top right.
- **Cast charge meter** near the crosshair. Optional **"!" bite indicator**.
- **Interaction prompt** ("F — Talk to Barb").
- **Toasts** (catch, achievement, autosave) stacked top center.
- **Captions** for important off-screen sounds (rustling behind you, splashing, humming overhead).
- **Crosshair** when aiming.
- **Dialogue box** with portrait (Canvas-rendered portrait or render-to-texture headshot).
- **Screens:** Journal (fish log with silhouettes for uncaught species, people met with relationship, messages in bottles, achievements); Map (painted park map, zone names, player marker, trashed zones marked).

### 16.3 Accessibility basics

- Captions for key audio cues and the bite indicator.
- Text speed setting; UI scale follows browser zoom.
- No flashing beyond the brief UFO flicker; a "Reduce flashing" toggle disables it.

---

## 17. Rendering & performance

**Renderer**

- three.js WebGL2, sRGB output, AgX/ACES tone mapping.
- Day lighting: PMREM environment from Poly Haven HDRIs. Night: procedural sky with moon and stars.
- Sun/moon directional light with a shadow map that follows the player, plus hemisphere fill.

**Terrain**

- Heightfield mesh in chunks with splat blending (forest floor, trail dirt, mud bank, sand, grass).
- A **trash mask** texture blends grass toward brown per trashed zone.

**Water**

- Custom shader: normal maps flowing along the river spline, Fresnel sky reflection, depth-based color (turquoise in the pool), shoreline foam.
- **Per-zone tint uniforms** give the beer color and foam.
- Ripples from the bobber, wading and the gator.
- Planar reflections on Ultra only.

**Vegetation**

- Instanced trees with 2–3 levels of detail and far billboards, wind sway in the vertex shader.
- GPU-instanced grass blades with density by preset, fading near the draw distance.
- Ferns and rocks instanced.

**Characters**

- Two levels of detail; animation updates throttled for distant NPCs.
- At most ~12 animated characters active at once.

**Effects**

- Poof burst, splashes, drips, fireflies, can sparkle (pickup hint), UFO beam volume, height fog, subtle bloom (High+).

**Budgets (Medium, Iris Xe, 1080p)**

- 60 fps (p95 frame time ≤ 20 ms), ≤ 300 draw calls, ≤ 1.5 M visible triangles, ≤ 1 GB GPU memory.
- Total download for the first load ≤ 150 MB (lazy-load the rest).
- Quality presets scale shadows, render scale, grass density, level-of-detail distances and bloom.

**M1 measurements (2026-09-11, `npm run perf`, Chromium on the Intel Iris Xe, 1920×1080, six stations, walking):** Medium (render scale 0.8, 1024² shadow map, ~38k grass blades, trees within 95 m as meshes and impostors beyond): p50 16.6–20.2 ms, worst p95 21.0 ms (spring pool), 50–60 fps, 58–172 draw calls, 0.5–1.9 M triangles. Low: 53–60 fps everywhere. The remaining Medium cost is fill (terrain splat, water, grass) at the pool; candidates for M4: cheaper water far from the camera, a lighter grass material, cascaded/tighter shadows. The RTX 4050 runs the smoke path at 60 fps (vsync).

---

## 18. Code architecture

### 18.1 Layout

```
solitude-springs/
  index.html  package.json  package-lock.json  .npmrc  tsconfig.json  vite.config.ts
  README.md  ASSETS.md  LICENSE
  plans/                     design + decisions (this file)
  assets-src/                asset pipeline: Blender/MPFB scripts, tree export, fish/prop generators
  public/assets/             built or fetched assets (large files git-ignored; manifest + licenses committed)
  src/
    main.ts                  boot, screen routing
    core/                    loop, fixed-step clock, event bus, seeded RNG, storage wrappers
    sim/                     PURE game logic — no DOM, no three.js (unit-tested in Node)
      inventory.ts  items.ts  trading.ts  fishing.ts  catchTable.ts  zones.ts
      director.ts  serenity.ts  confrontation.ts  reputation.ts  npcMemory.ts
      dialogue.ts  achievements.ts  stats.ts  clock.ts
      save/ schema.ts  validate.ts  migrate.ts  format.ts
    data/                    typed content: tunables, items, fish, loot, npcs/, dialogue/, events, achievements, world layout, tips
    world/                   terrain, water, vegetation, bridges, dock, props, sky + day/night, trash visuals, audio emitters
    actors/                  player controller, camera rig, NPC controller + brain, bear, alligator, UFO, boat, bobber
    character/               character factory, clothing/outfit swapping, animation library + layers, look-at
    gameplay/                fishing, weapons, interaction, event runners (one per event type), abduction sequence
    audio/                   engine + buses, music generator, ambience, sfx, voices
    ui/                      screens (menu, creator, load, settings, controls, pause, credits), HUD, hotbar, inventory, trade, dialogue, journal, map, toasts, captions, debug console
    input/                   bindings + input (adapted from Florida Driver)
    render/                  renderer setup, quality presets, post, particles, level of detail
  tests/                     node:test suites for sim/ and data integrity
  tools/                     smoke.mjs, shots.mjs, perf.mjs, simulate.ts, fetch-assets.mjs, check-deps-age.mjs, npm-safe.mjs
  lab/                       look-dev pages: characters, world vignettes, water, trash states
```

### 18.2 Principles

- **`sim/` is pure and deterministic** given a seed. It produces intents and events; `gameplay/`, `actors/` and `ui/` present them. This makes rules unit-testable and lets `tools/simulate.ts` run the Director + fishing for hundreds of hours in seconds.
- **Event bus** (`catch`, `theft`, `poof`, `tradeCompleted`, `eventStarted`, …) decouples achievements, stats, serenity, audio stingers and saves.
- **Content is typed data**, so the compiler checks ids. A data-integrity test verifies:
  - every item, NPC, dialogue node and achievement reference resolves
  - every NPC has at least a greeting and a goodbye
  - there are exactly 58 roster entries
  - catch-table weights add up correctly.
- **One tunables file** for every number marked tunable.
- **Fixed simulation step** (e.g. 30 Hz) for game logic; rendering interpolates.
- **Security in UI:** player and NPC names are rendered with `textContent`; no dynamic `innerHTML`.

### 18.3 Debug console (dev builds only, `` ` `` key)

Commands:

- `event <type> [npcId]`
- `time <hh:mm>`, `day +N`
- `give <itemId> [n]`, `outfit <itemIds…>`
- `serenity <n>`, `wanted <n>`
- `tp <area>`
- `trash <zone> <0..1>`
- `npc <id>`
- `heal`, `kill`
- `lull`
- `unlock <achievementId>`
- `speed <x>` (game-time multiplier)
- `stats` (frame-time/draw-call overlay)
- `freecam`

The console also exposes `window.__ss` hooks the smoke tests use. It's stripped from production builds.

---

## 19. Testing & verification

| Command | What it proves |
|---|---|
| `npm run typecheck` | Strict TypeScript passes. |
| `npm test` | `node --test` suites. **Sim:** inventory stacking/moves, clothing slot rules (full-body occupies top+bottom, underwear layer), trading math, catch tables per zone/time, bite timing distribution, early/late reel outcomes, population and trash recovery, Director eligibility/cooldowns/concurrency/lulls, serenity rules, confrontation state machine (innocent unarmed → hands up; innocent armed → hostile; weapons never damage innocents or animals), wanted/ranger trigger, death rules (fish lost, achievements kept), achievement triggers. **Save:** round-trip, validation of malicious or garbage input, migrations, date formatting across locales/time zones. **Data integrity** (§18.2). |
| `npm run simulate` | Director + fishing Monte Carlo report against the pacing targets (§11.2). Fails if a target is missed. |
| `npm run deps:check` | Every resolved package version is ≥ 14 days old (§3.3). |
| `npm run build` | Production build succeeds; debug console stripped. |
| `npm run smoke` | Launches `flatpak run org.chromium.Chromium` headless over CDP against the dev server. Plays a scripted path: menus → create character → walk the trail → cast → force a bite → catch → equip clothing → force each event via `__ss` hooks → save & quit → load. Screenshots every step into `smoke-out/` and **fails on any console error**. Closes Chromium via CDP (killing the flatpak wrapper leaves the browser running). |
| `npm run shots` | Look-dev screenshot sets: character lineups, vistas at dawn/day/dusk/night, a trashed zone, the UFO, the gator approach, a party, and the creator. Reviewed by the implementer visually before every checkpoint. |
| `npm run perf` | Headed Chromium with a real GPU runs a scripted flythrough + walk. Reports p50/p95 frame time, draw calls and triangles per preset. Run on the integrated GPU (Medium target) and the RTX 4050. Software rendering (SwiftShader) is only for correctness screenshots, never performance. |

**Per-checkpoint evidence:** each milestone report to the owner includes:

- test results
- the simulate report
- the deps check
- perf numbers
- a curated screenshot set
- the list of any acceptance criteria not met.

---

## 20. Milestones

Each milestone ends at a **checkpoint**: the implementer runs §19, sends the evidence, and **stops** until the owner has played the build and replied. Feedback goes into this plan (§1 / §22) before the next milestone starts.

### M0 — Foundations & look-dev *(decision gate)*

**Status (2026-09-11): built; checkpoint in progress** — the owner's first play notes (§1 #29–30) are fixed and re-verified (smoke passes, 50-spot standing-drift probe clean). Evidence: `npm ci`, `typecheck`, `test` (12 pass), `deps:check` (72 resolved versions, oldest-new 16 days) and `build` pass; `npm run smoke` passes (boot page + three lab pages, no console errors, Chromium closed over CDP); 15 bake-off + 8 vignette screenshots in `shots-out/m0/`. Known gaps carried into M1: production bundle copies all of `public/` (164 MB with the bake-off GLBs; trim before shipping), vignette draw is ~6.7 M triangles/frame on the RTX 4050 with shadows (needs LODs/impostors for the Iris Xe budget), no `perf` tool yet.

**Build**

- **Ask first:** upgrade npm to ≥ 11.10 and install the MPFB2 extension into the owner-installed Blender 5.2 (§4.5). Record versions.
- **Scaffold:** Vite + TS strict; `.npmrc`; `deps:check`; `node --test`; the CDP smoke/shots harness adapted from Florida Driver; `ASSETS.md`; asset fetch tool.
- **Character bake-off** (§4.3): candidates A, B and the C baseline, in identical riverbank lighting. Each shows:
  - male + female in default outfits
  - both in underwear
  - the male in the dress
  - a walk cycle and a cast pose.
- **Environment vignette:** ~60 × 60 m of riverbank with terrain, trail, trees, ferns, grass, water, a footbridge segment and HDRI day + night. Shows a trashed version of the same spot (brown grass, cans, beer-tinted water).

**Acceptance**

- `npm ci`, `typecheck`, `test`, `deps:check` and `build` all pass.
- The smoke harness opens the lab page and screenshots it, then closes Chromium cleanly.
- The bake-off and vignette screenshot sets are delivered.

**Checkpoint decisions (owner)**

- Character family.
- Environment look and setting (Southeastern springs or other).
- Any art-direction adjustments.

### M1 — "Tranquil" vertical slice

**Status (2026-09-11): built; checkpoint in progress** — the owner's first play notes (§1 #29–30) are fixed and re-verified (smoke passes, 50-spot standing-drift probe clean). Evidence: `npm ci`, `typecheck`, `test` (42 pass), `deps:check` (all ≥ 14 d) and `build` pass; `npm run smoke --gpu` plays the whole acceptance path below with zero console errors (screenshots `smoke-out/01…15`); `npm run perf --preset=medium` on the Iris Xe: 50–60 fps, worst p95 21 ms (§17). Look-dev evidence: `shots-out/m1-anim/*` (retargeted clips on both bodies), `shots-out/m1-player/*` (underwear layer, wardrobe, skins, hair), `shots-out/m1-map/*` (overhead + vistas).
Acceptance not fully met: **60 fps Medium on Iris Xe** — four of six stations hit 60, the spring pool sits at 50 fps / p95 21 ms. Known gaps carried forward: production bundle copies all of `public/` (222 MB; needs a manifest-driven copy and texture compression), no cascaded shadows (shadows only within ±40 m of the player), impostor trees are flat billboards, the rod/bobber/pickups are placeholder geometry, no recorded ambience (§22 #4), the bridge decks have no sway, fish have no in-hand model (the reveal is a hold-up animation + toast).

**Build**

- **Menus & settings:** main menu with flyover; Settings (all groups incl. the Pause-during-conversations toggle); Controls with rebinding + restore defaults; pause menu; Credits stub.
- **Animation first (owner feedback, §1 #25):** retarget the Quaternius UAL1/UAL2 clips (walk, jog, idle, sit, hit reactions…) onto the MPFB `game_engine` rig in the Blender pipeline, export a shared animation-library GLB, and verify with the character lab before anything else is built on the characters. Replace the procedural walk. The cast/reel animations are hand-authored in Blender (or built from retargeted clips) — no procedural cast pose ships.
- **Underwear base layer (§1 #26):** polka-dot boxers texture for the male; the female gets the male's short-shorts garment recoloured white plus the white top. The layer is part of the base body and can't be removed.
- **Player & creator:** character creator (§5) with the chosen character tech; player controller, camera rig, jump/sprint, wading limits and push-back, boundary.
- **World:** full map blockout with final layout (§7): trailhead, switchback, pool, river with 3 bridges, campground, beach, dock, marsh, deep woods; vegetation and water to the M0 look; day/night cycle.
- **Items:** hotbar, backpack, equipment paper doll, clothing swapping (incl. underwear layer and full-body rule), drop/pickup.
- **Fishing:** complete (§9) with catch tables, population, 13 species (Old Gus logic present), junk/clothing/weapon catches as items (weapons not usable yet), catch reveal, Journal (fish log).
- **Saves:** IndexedDB, autosave rules, load screen with localized dates, delete/export/import, validation + tests.
- **Audio:** calm generative score, ambience, fishing/footstep/UI effects, buses wired to settings.
- **Debug console** basics.

**Acceptance**

- Scripted smoke path: new game → create a male character → walk the switchback to the river → cast from a bank *and* from a bridge → catch a fish and a junk item → fish up and equip a dress → wait (via `speed`) until night → Save & Quit.
- The load screen shows `{localized date} {name}`. Loading restores position, clock, inventory and worn dress.
- Missing a bite leaves the line out; reeling early retrieves it; walking 30 m away auto-reels.
- 60 fps Medium on Iris Xe in `perf`; no console errors; all tests pass; `deps:check` passes.

### M2 — The interruptions

**Build**

- **NPC framework:** character factory from roster data, NPC brain/state machine, trail-graph navigation + steering, look-at.
- **Dialogue:** system + UI, typewriter, gibberish voices, reactive barks; trading UI + rules; NPC memory.
- **Director:** serenity meter, lulls, grace periods; `npm run simulate` with pacing targets met.
- **Events:** camper/hiker visits; water-walkers (incl. Marina Costa in her swimsuit); thieves (steal, strip, pity barrel, getaway, later reappearance); parties (music, dancing, **brown grass + scattered cans + beer-colored river**, population 0, recovery, cleanup); bear; alligator; UFO abduction (**same-spot return**, outfit replacement, missing time, glowing perch window).
- **Health:** hearts, damage from gator, death/respawn rules.
- **Roster:** first ~25 NPCs with full dialogue (all archetypes represented).
- **Tutorial:** narrator intro with the scripted first-thief interruption.

**Acceptance**

- Every event can be forced from the console, and smoke screenshots show its key beats.
- **Party:** after it ends, the zone gets zero bites until recovery; picking up all cans clears the water.
- **Thief:** with nothing wanted, strips to underwear; a second attempt on an underwear-clad player awards the barrel.
- **UFO:** returns the player within 0.1 m of the original position with different worn clothing.
- **Bear:** with fish, empties fish only; scaring it off keeps them.
- **Pause toggle:** off keeps the bite timer running during dialogue; on pauses the world.
- The simulate report meets targets. Save/load mid-trash state restores the trash visuals and cans.

### M3 — Weapons, consequences & the full cast

**Build**

- **Weapons:** knife, handgun, rifle, ammo; aim camera; confrontation state machine (§12.2) with hands-up robbery dialogue and armed fight-back; hostile AI; red poof + loot bags; stolen-item recovery.
- **Consequences:** wanted + Park Ranger confiscation; grudge returns; poofed-NPC return lines.
- **Boat:** boarding, rowing, fishing from the boat, gator in-boat rules, saved position.
- **Cast & collection:** all 58 NPCs with dialogue and cross-links (Hendersons, Carl + tinfoil hat, Larry's keys…); messages in bottles; Map screen; complete Journal; all achievements (§13) with UI and toasts.

**Acceptance**

- Unit tests prove weapons never damage innocents or animals.
- **Robbery flows:** aiming at unarmed Barb opens the robbery; aiming at armed Wade makes him hostile, and poofing him drops a loot bag.
- Two robberies trigger the ranger, who confiscates the best weapon.
- Poofing a fleeing thief returns stolen items.
- The data-integrity test confirms 58 NPCs with valid dialogue.
- **Achievements:** every non-secret achievement is unlockable via a scripted or console path (test list).
- Achievements persist across death and save/load.

### M4 — Polish & balance

- **Audio & visuals:** audio mix pass; VFX and animation polish (casting, reeling, poof, abduction); performance pass and final quality presets.
- **Presentation:** loading tips, main-menu UFO gag, Credits generated from `ASSETS.md`; accessibility options.
- **Balance** from owner play-tests (tunables only where possible); bug bash; full smoke + perf suite; README (how to run, controls, credits, license notes).

**Acceptance**

- All §19 commands pass.
- The owner signs off after a free-play session.

---

## 21. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Semi-realistic characters can't be produced to a good standard in a scripted pipeline (MPFB headless batch is undocumented; clothing fit on both bodies; glTF morph export unknown). | M0 bake-off *before* any gameplay depends on it. Candidate B is a consistent fallback. Player bodies can be fixed presets. |
| Animation retargeting between sources is finicky. | One skeleton; retarget once in the pipeline and verify with lab screenshots; hand-author the gameplay-critical clips (cast, reel, hands up, aim). |
| Realistic foliage and water too heavy for Iris Xe. | Budgets in §17, level of detail + impostors, density presets, `perf` on real hardware from M0 on. |
| Comedy depends on writing volume (58 NPCs, barks). | Seeds in §10.5; data-driven dialogue; review writing at M2/M3 checkpoints; shared bark pools cover repetition. |
| Constant interruptions make the game frustrating instead of funny. | Director simulation with pacing targets, lulls, grace periods, owner play-tests, every knob in tunables. |
| Browser storage cleared → lost saves. | Export/Import; mention on the load screen. |
| Supply-chain compromise. | 14-day release-age buffer enforced natively + independently verified, exact pins, `ignore-scripts`, minimal deps, no runtime network. |
| CC-BY attribution drift. | `ASSETS.md` is the only way assets enter the repo; Credits generated from it; a test fails if a file under `public/assets` isn't listed. |

---

## 22. Open decisions

Resolve at the noted checkpoint, then move each into §1.

1. ~~Character family~~ — resolved 2026-09-11: A (§1 #25).
2. ~~Setting~~ — resolved 2026-09-11: Southeastern springs (§1 #27).
3. ~~Alligator model~~ — default kept: in-house (§1 #28); the owner can still swap in a sourced model later.
4. **Recorded CC0 ambience** vs. synthesis-only. *M1 shipped synthesis only (river noise, wind, birds, frogs/crickets/owl, plucked score). Owner to judge at the M1 checkpoint.*
5. **Pacing targets** after the first real play-test (events/hour, fish/hour). *M2.*
6. **Alien interior vignette** — keep, shorten, or cut. *M2.*
7. **Dialogue tone review** — any roster seeds to cut, change or add. *M2/M3.*

**M0 checkpoint outcome (2026-09-11):** the owner picked A (MPFB2) and confirmed the setting; see §1 #25–28 for the feedback that shapes M1.

**M1 checkpoint asks (2026-09-11):** (a) does the walk/jog/cast/reel animation now read as real motion on the MPFB bodies? (b) is the valley layout right (trailhead ridge → pool → three bridges → campground → beach → dock → marsh)? (c) underwear layer as specified? (d) synthesized audio acceptable or add CC0 recordings? (e) any art-direction notes before M2 fills the world with people.

---

## 23. Appendix A — Asset & tooling research (2026-09-10)

Web research done while writing this plan. **Licenses, free tiers and availability change:** re-check the linked page before committing any asset, and record it in `ASSETS.md`.

| Source | Key findings | Verdict | Links |
|---|---|---|---|
| **MPFB2** (MakeHuman for Blender) | v2.0.17 (2026-07-22) adds seeded batch generation (up to 100 characters). Requires Blender 4.2+; 5.2 support unverified. Code is GPL-3; **exported models and core assets are CC0**. CC0 packs: Shirts01, Pants01, Shoes01, Dress01, Underwear01, Skins01–03, Hair01 (stylized). **CC-BY** packs: Underwear02/03 and Pants03 (swimwear), Hair02/03 (high-poly). Rigs: default, game_engine, mixamo, rigify. Python API (`HumanService`, `TargetService`) with sample scripts; headless `--background` use is undocumented. | Primary character candidate (§4.3 A) | [License](https://static.makehumancommunity.org/about/license.html) · [Closed-source FAQ](https://static.makehumancommunity.org/mpfb/faq/use_in_closed_source.html) · [Asset packs](https://static.makehumancommunity.org/assets/assetpacks.html) · [Script samples](https://github.com/makehumancommunity/mpfb2/tree/master/script_samples) |
| **Quaternius** | *(2026-09-11: the free Standard tier contains only the 2 Superhero bodies + 6 hairstyles; no stable download URL — itch.io issues short-lived signed links, so the zips are kept as manual downloads with recorded SHA-256s. quaternius.com switched to a "QAL v1.0" license on 2026-08-28, stated non-retroactive; the archives say CC0.)* Universal Base Characters: 6 bodies, 20 hairstyles, ~13k triangles, CC0. Universal Animation Library 1: 45 of 120+ clips free (locomotion, swim, sit, death). Library 2: 42 of 130+ free (melee, parkour, **fishing**, farming). Standard tier free; Pro/Source tiers paid. One shared rig across packs. The exact free clip list is unverified. | Fallback characters (§4.3 B); CC0 animations | [Base Characters](https://quaternius.com/packs/universalbasecharacters.html) · [Animation Library](https://quaternius.itch.io/universal-animation-library) · [Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) |
| **Mesh2Motion** | Open-source rigging and animation tool (a Mixamo replacement). Code MIT, assets CC0, runs locally (npm or Docker). | Retargeting helper | [Repo](https://github.com/Mesh2Motion/mesh2motion-app) |
| **Microsoft Rocketbox** | 115 rigged humans + 417 animations (talk, dance, drink…), MIT, FBX, 3ds Max Biped rig. Clothing is part of the body mesh. Repo is ~4 GB. | Animation reference only | [Repo](https://github.com/microsoft/Microsoft-Rocketbox) |
| **Poly Haven** | CC0 HDRIs and textures. 143 nature models (Fir Tree 01, Pine Tree 01, saplings, Fern 02, grass, moss, rocks, dead trunks, roots) and props (`bolt_action_rifle_7_62`, `can_rusted`, `Lantern_01`). The API is free including commercial use and requires a unique User-Agent. | Use | [License](https://polyhaven.com/license) · [API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) |
| **ambientCG** | CC0 PBR materials and HDRIs; public API. | Use | [License](https://docs.ambientcg.com/license/) |
| **EZ-Tree** | Procedural three.js trees with GLB export. MIT. npm `@dgreenheck/ez-tree` v1.1.0, needs `three >=0.167`. Bundled texture license unverified. | Use at dev time | [Repo](https://github.com/dgreenheck/ez-tree) |
| **Sketchfab bear** | "Animated Bear" by AnimalMesh3D: 19.6k triangles, PBR, walk/run/eat/idle, CC-BY 4.0. Download requires a login. | Use (owner downloads) | [Model](https://sketchfab.com/3d-models/animated-bear-3d-model-3adff88544344a58a8c93b10aaf05451) |
| **Sketchfab alligator** | "Alligator Animated" is stylized (18.8k triangles, CC-BY). No free realistic alligator was found. | Build in-house instead (§4.5) | [Model](https://sketchfab.com/3d-models/alligator-animated-27e81ddf2910456d8f2e5474d006ca6c) |
| **Mixamo** | Adobe forbids free distribution of raw character/animation files. Needs an Adobe ID; no longer maintained. | Don't use | [Licensing FAQ](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775) |
| **Ready Player Me** | Shut down 2026-01-31 after being bought by Netflix. | Unavailable | [News](https://techcrunch.com/2025/12/19/netflix-acquires-gaming-avatar-maker-ready-player-me/) |
| **CMU Mocap** | Research-use terms: may be included in commercial products but not resold. Free redistribution is unclear, and the 4TU FBX conversion is CC BY-NC. | Avoid | [4TU dataset page (quotes the terms)](https://data.4tu.nl/datasets/0448aab2-3332-449f-a8e2-d208cb58c7df) |
| **Bandai Namco motion dataset** | CC BY-NC 4.0 (non-commercial). | Don't use | [License](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset/blob/master/dataset/Bandai-Namco-Research-Motiondataset-1/LICENSE) |

**npm release-age settings**

- npm **11.10.0** (released 2026-02-11) added `min-release-age` (days) and `min-release-age-exclude` (names/globs).
- `--before=<date>` still exists; if both are set in the same place, `before` wins.
- Sources: [npm config docs](https://docs.npmjs.com/cli/v11/using-npm/config/) · [v11.10.0 release](https://github.com/npm/cli/releases/tag/v11.10.0).
- For reference only (not used here): pnpm `minimumReleaseAge` is in minutes, Bun `minimumReleaseAge` in seconds.

