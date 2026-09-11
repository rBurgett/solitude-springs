// Look-dev screenshot sets (plan §19 `npm run shots`).
//   node tools/shots.mjs [--set=characters,anims,vignette] [--only=<substring>] [--out=shots-out] [--base=http://localhost:5173] [--gpu]
//                        [--extra=k=v&k2=v2] [--clip=x,y,w,h[,scale]]   (--extra overrides the shot's query; --clip zooms into a region)
// Without --base it starts its own Vite dev server. Each shot navigates to a lab page with
// query parameters, waits for window.__labReady (or __labError) and captures the canvas.
import path from 'node:path';
import { launchChromium, startDevServer, parseArgs, reportConsole, ROOT, sleep } from './cdp.mjs';

const { flags } = parseArgs();
const OUT = path.resolve(ROOT, flags.out || 'shots-out');
const SETS = String(flags.set || 'characters,player,anims,map,vignette').split(',');
const ONLY = flags.only ? String(flags.only) : '';
const EXTRA = flags.extra ? String(flags.extra) : '';
const CLIP = flags.clip ? (() => { const [x, y, width, height, scale] = String(flags.clip).split(',').map(Number); return { x, y, width, height, scale: scale || 1 }; })() : undefined;

/** Every look-dev shot. Name → page + query. Reviewed visually before each checkpoint. */
const SHOTS = {
  characters: [],
  anims: [],
  vignette: [],
};
// Retargeted animation library on the MPFB bodies (plan §4.4): one flip-book row per clip.
for (const clip of ['idle', 'walk', 'jog', 'sprint', 'sit_idle', 'throw', 'dance', 'hit_chest', 'pistol_aim', 'consume', 'idle_talk', 'crouch_walk', 'cast', 'reel', 'fish_idle']) {
  SHOTS.anims.push({ name: `anim-${clip}`, page: 'lab/characters.html', query: { candidate: 'a', shot: 'anim', clip } });
}
for (const candidate of ['a', 'b', 'c']) {
  for (const shot of ['lineup', 'underwear', 'dress', 'walk', 'cast']) {
    SHOTS.characters.push({ name: `characters-${candidate}-${shot}`, page: 'lab/characters.html', query: { candidate, shot } });
  }
}
// M1 player bodies through the runtime Character class (garments, underwear layer, hair, skins).
SHOTS.player = [];
for (const shot of ['lineup', 'underwear', 'dress', 'walk', 'cast']) {
  SHOTS.player.push({ name: `player-${shot}`, page: 'lab/characters.html', query: { candidate: 'p', shot } });
}
SHOTS.player.push({ name: 'player-skins-male', page: 'lab/characters.html', query: { candidate: 'p', shot: 'skins', sex: 'male' } });
SHOTS.player.push({ name: 'player-skins-female', page: 'lab/characters.html', query: { candidate: 'p', shot: 'skins', sex: 'female' } });
SHOTS.player.push({ name: 'player-hair-male', page: 'lab/characters.html', query: { candidate: 'p', shot: 'hair', sex: 'male' } });
SHOTS.player.push({ name: 'player-hair-female', page: 'lab/characters.html', query: { candidate: 'p', shot: 'hair', sex: 'female' } });
SHOTS.player.push({ name: 'player-wardrobe-male', page: 'lab/characters.html', query: { candidate: 'p', shot: 'wardrobe', sex: 'male' } });
SHOTS.player.push({ name: 'player-wardrobe-female', page: 'lab/characters.html', query: { candidate: 'p', shot: 'wardrobe', sex: 'female' } });
// Full map blockout (plan §7.1): overhead plus a vista per area.
SHOTS.map = [];
for (const view of ['overhead', 'overhead_north', 'overhead_south', 'trailhead', 'switchback', 'pool', 'campground', 'bend', 'dock', 'marsh', 'cedar', 'plank', 'suspension', 'woods', 'ridge']) {
  SHOTS.map.push({ name: `map-${view}`, page: 'lab/map.html', query: { view } });
}
for (const time of ['dawn', 'day', 'dusk', 'night']) {
  for (const state of ['clean', 'trashed']) {
    SHOTS.vignette.push({ name: `vignette-${time}-${state}`, page: 'lab/vignette.html', query: { time, state } });
  }
}

const server = flags.base ? null : await startDevServer();
const base = flags.base ? String(flags.base).replace(/\/$/, '') : server.base;
const browser = await launchChromium({ gpu: !!flags.gpu });
let failed = false;
const results = [];
try {
  for (const set of SETS) {
    const list = SHOTS[set];
    if (!list) {
      console.error(`unknown shot set ${set}; known: ${Object.keys(SHOTS).join(', ')}`);
      failed = true;
      continue;
    }
    for (const shot of list) {
      if (ONLY && !shot.name.includes(ONLY)) continue;
      const qs = new URLSearchParams({ ...shot.query, ...Object.fromEntries(new URLSearchParams(EXTRA)) }).toString();
      const url = `${base}/${shot.page}?${qs}`;
      const errorsBefore = browser.errors.length;
      await browser.navigate(url);
      await browser.evaluate('window.__labReady = false; true');
      await browser.waitFor('window.__labReady === true || !!window.__labError', 180_000);
      const err = await browser.evaluate('window.__labError || ""');
      if (err) {
        console.error(`  ${shot.name}: ERROR ${err}`);
        failed = true;
        continue;
      }
      await sleep(250);
      const file = await browser.screenshot(path.join(OUT, `${shot.name}.png`), CLIP);
      const stats = await browser.evaluate('JSON.stringify(window.__labStats || null)');
      const newErrors = browser.errors.length - errorsBefore;
      console.log(`  ${path.relative(ROOT, file)}  ${stats}${newErrors ? `  (${newErrors} console errors)` : ''}`);
      results.push({ name: shot.name, file, stats: JSON.parse(stats) });
    }
  }
} catch (e) {
  failed = true;
  console.error('SHOTS FAILED:', e.stack || e.message);
}
if (reportConsole(browser)) failed = true;
await browser.close();
server?.stop();
console.log(`\n${results.length} shots written to ${path.relative(ROOT, OUT)}${failed ? ' — FAILED' : ''}`);
process.exit(failed ? 1 : 0);
