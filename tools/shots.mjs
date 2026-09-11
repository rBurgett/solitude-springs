// Look-dev screenshot sets (plan §19 `npm run shots`).
//   node tools/shots.mjs [--set=characters,vignette] [--only=<substring>] [--out=shots-out] [--base=http://localhost:5173] [--gpu]
// Without --base it starts its own Vite dev server. Each shot navigates to a lab page with
// query parameters, waits for window.__labReady (or __labError) and captures the canvas.
import path from 'node:path';
import { launchChromium, startDevServer, parseArgs, reportConsole, ROOT, sleep } from './cdp.mjs';

const { flags } = parseArgs();
const OUT = path.resolve(ROOT, flags.out || 'shots-out');
const SETS = String(flags.set || 'characters,vignette').split(',');
const ONLY = flags.only ? String(flags.only) : '';
const EXTRA = flags.extra ? String(flags.extra) : '';

/** Every look-dev shot. Name → page + query. Reviewed visually before each checkpoint. */
const SHOTS = {
  characters: [],
  vignette: [],
};
for (const candidate of ['a', 'b', 'c']) {
  for (const shot of ['lineup', 'underwear', 'dress', 'walk', 'cast']) {
    SHOTS.characters.push({ name: `characters-${candidate}-${shot}`, page: 'lab/characters.html', query: { candidate, shot } });
  }
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
      const qs = new URLSearchParams(shot.query).toString() + (EXTRA ? '&' + EXTRA : '');
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
      const file = await browser.screenshot(path.join(OUT, `${shot.name}.png`));
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
