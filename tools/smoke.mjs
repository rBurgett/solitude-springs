// Headless smoke test (plan §19 `npm run smoke`): drives the game in Chromium over CDP,
// screenshots every step into smoke-out/ and fails on any console error.
//   node tools/smoke.mjs [--base=http://localhost:5173] [--out=smoke-out] [--gpu] [--lab]
// M1 scripted path (plan §20 M1 acceptance): new game → create a male character → walk the
// switchback to the river → cast from a bank and from a bridge → catch a fish and a junk item →
// fish up and equip a dress → wait (via `speed`) until night → Save & Quit → the load screen
// shows "{localized date} {name}" → loading restores position, clock, inventory and the dress.
// Also: a missed bite leaves the line out, reeling early retrieves it, walking away auto-reels.
import path from 'node:path';
import { launchChromium, startDevServer, parseArgs, reportConsole, ROOT, sleep } from './cdp.mjs';

const { flags } = parseArgs();
const OUT = path.resolve(ROOT, flags.out || 'smoke-out');
const server = flags.base ? null : await startDevServer();
const base = flags.base ? String(flags.base).replace(/\/$/, '') : server.base;
const browser = await launchChromium({ gpu: !!flags.gpu });
let failed = false;
let step = 0;
const shot = async (name) => {
  step++;
  const file = await browser.screenshot(path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`));
  console.log('  screenshot', path.relative(ROOT, file));
};
const ev = (expr) => browser.evaluate(expr);
const state = () => ev('window.__ss.state()');
const run = (cmd) => ev(`window.__ss.run(${JSON.stringify(cmd)})`);
const key = (action, down) => ev(`window.__ss.key(${JSON.stringify(action)}, ${down})`);
const expect = (cond, msg) => {
  if (!cond) throw new Error('expectation failed: ' + msg);
};
const waitState = async (pred, msg, timeout = 30_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state();
    if (pred(s)) return s;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${msg}`);
};
/** Yaw for the camera so "forward" walks from (x0,z0) toward (x1,z1) (camera yaw = facing + π). */
const yawToward = (x0, z0, x1, z1) => Math.atan2(x1 - x0, z1 - z0) + Math.PI;
const walkTo = async (x, z, radius = 3, timeout = 60_000) => {
  const t0 = Date.now();
  let lastProgressAt = Date.now();
  let lastPos = null;
  let side = 1;
  await key('forward', true);
  try {
    while (Date.now() - t0 < timeout) {
      const s = await state();
      const dx = x - s.pos[0];
      const dz = z - s.pos[2];
      if (Math.hypot(dx, dz) < radius) return s;
      if (!lastPos || Math.hypot(s.pos[0] - lastPos[0], s.pos[2] - lastPos[2]) > 0.3) {
        lastPos = s.pos;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > 1000) {
        // pinned on a trunk or a prop: back off and sidestep, alternating sides
        if (flags.debug) console.log('    stuck at', s.pos.map((v) => v.toFixed(1)).join(','), '- sidestepping');
        await key('forward', false);
        await key('back', true);
        await sleep(350);
        await key('back', false);
        await key(side > 0 ? 'right' : 'left', true);
        await sleep(700);
        await key(side > 0 ? 'right' : 'left', false);
        side = -side;
        await key('forward', true);
        lastProgressAt = Date.now();
        continue;
      }
      await ev(`window.__ss.setYaw(${yawToward(s.pos[0], s.pos[2], x, z)})`);
      if (flags.debug && Math.floor((Date.now() - t0) / 1000) !== Math.floor((Date.now() - t0 - 120) / 1000)) console.log('    walking', s.pos.map((v) => v.toFixed(1)).join(','), '→', x, z, 'grounded', s.grounded, 'speed', s.speed?.toFixed?.(2));
      await sleep(120);
    }
    throw new Error(`walkTo (${x}, ${z}) timed out`);
  } finally {
    await key('forward', false);
  }
};
const castAndWait = async (yaw) => {
  await ev(`window.__ss.setYaw(${yaw}, 0.15)`);
  await sleep(200);
  await key('use', true);
  await sleep(900);
  await key('use', false);
  return waitState((s) => s.fishing === 'waiting' || s.fishing === 'idle', 'bobber to land', 15_000);
};

try {
  console.log('Navigating to', base);
  await browser.navigate(base + '/');
  await browser.waitFor('!!document.querySelector("[data-action=new]")', 180_000);
  await sleep(1500);
  await shot('main-menu');

  if (flags.lab) {
    for (const [page, query] of [['lab/characters.html', 'candidate=p&shot=walk'], ['lab/map.html', 'view=pool&veg=0']]) {
      await browser.navigate(`${base}/${page}?${query}`);
      await browser.waitFor('window.__labReady === true || !!window.__labError', 180_000);
      const err = await ev('window.__labError || ""');
      if (err) throw new Error(`${page}?${query}: ${err}`);
      await shot(page.replace(/[^a-z]+/g, '-'));
    }
    await browser.navigate(base + '/');
    await browser.waitFor('!!document.querySelector("[data-action=new]")', 180_000);
  }

  // --- new game → creator ---
  await browser.click('[data-action=new]');
  await browser.waitFor('!!document.querySelector("[data-action=begin]")', 20_000);
  await sleep(2500);
  await shot('creator');
  await ev(`(() => { const i = document.querySelector('[data-field=name]'); i.value = 'Ryaaaaaaan'; i.dispatchEvent(new Event('input')); return true; })()`);
  await browser.click('[data-sex=male]');
  await sleep(1500);
  await browser.click('[data-action=begin]');
  await browser.waitFor('!!window.__ss', 120_000);
  await ev('window.__ss.hideClickToPlay()');
  await sleep(1200);
  let s = await state();
  console.log('  spawn', s.pos.map((v) => v.toFixed(1)).join(','), 'clock', s.clock, 'phase', s.phase);
  expect(s.pos[2] < -200, 'starts at the trailhead');
  await shot('trailhead');

  // --- walk the switchback down to the river (waypoints from the plan's trail) ---
  await run('speed 3');
  const waypoints = await ev('window.__ss.switchback()');
  for (const [x, z] of waypoints.slice(1)) s = await walkTo(x, z, 4);
  await run('speed 1');
  console.log('  at the river', s.pos.map((v) => v.toFixed(1)).join(','), 'zone', s.zone);
  expect(s.pos[1] < 8, 'descended to the bank');
  expect(s.stats.metresWalked >= 0, 'stats present');
  await shot('river-bank');

  // --- cast from the bank (aim west across the river), force a bite, catch a fish ---
  await run('give beer_can 3');
  s = await state();
  expect(s.selected === 0 && s.inventory.some((i) => i.startsWith('old_rod')), 'rod in slot 1');
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] - 20, s.pos[2]));
  expect(s.fishing === 'waiting', 'line waiting on the water (bank cast)');
  console.log('  cast from the bank into zone', s.zone);
  await shot('cast-bank');
  await run('catch fish');
  await run('bite');
  s = await waitState((x) => x.fishing === 'bite', 'a bite', 5000);
  await shot('bite');
  await key('use', true);
  await sleep(100);
  await key('use', false);
  s = await waitState((x) => x.fishing === 'idle', 'the reel to finish', 8000);
  expect(s.inventory.some((i) => i.startsWith('fish_')), 'a fish in the inventory');
  expect(s.stats.fishCaught === 1, 'fishCaught == 1');
  expect(s.achievements.includes('first_catch'), 'First Catch unlocked');
  await sleep(600);
  await shot('caught-fish');

  // --- missing a bite leaves the line out; reeling early retrieves it ---
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] - 20, s.pos[2]));
  expect(s.fishing === 'waiting', 'second cast waiting');
  await run('bite');
  await waitState((x) => x.fishing === 'bite', 'second bite', 5000);
  s = await waitState((x) => x.fishing === 'waiting', 'the missed bite to leave the line out', 8000);
  expect(s.lineOut, 'line still out after a miss');
  expect(s.stats.bitesMissed === 1, 'bitesMissed == 1');
  await key('use', true);
  await sleep(100);
  await key('use', false);
  s = await waitState((x) => x.fishing === 'idle', 'early reel to finish', 8000);
  expect(!s.lineOut, 'line retrieved');

  // --- cast, then walk away: auto-reel ---
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] - 20, s.pos[2]));
  expect(s.fishing === 'waiting', 'third cast waiting');
  const start = s.pos;
  await run('speed 3');
  await walkTo(start[0] + 8, start[2] + 40, 4);
  await run('speed 1');
  s = await waitState((x) => !x.lineOut, 'auto-reel after walking away', 10_000);
  expect(s.fishing === 'idle' || s.fishing === 'reeling', 'auto-reeled');

  // --- cast from a bridge and catch a junk item ---
  await run('tp plank_bridge');
  await sleep(600);
  s = await state();
  const bridgeY = s.pos[1];
  console.log('  on the bridge at', s.pos.map((v) => v.toFixed(1)).join(','));
  expect(bridgeY > 0.8, 'standing on the bridge deck');
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0], s.pos[2] + 25));
  expect(s.fishing === 'waiting', 'line waiting (bridge cast)');
  await shot('cast-bridge');
  await run('catch junk');
  await run('bite');
  await waitState((x) => x.fishing === 'bite', 'junk bite', 5000);
  await key('use', true);
  await sleep(100);
  await key('use', false);
  s = await waitState((x) => x.fishing === 'idle', 'junk reel', 8000);
  expect(s.stats.junkCaught === 1, 'a junk item was caught');
  await shot('caught-junk');

  // --- fish up a dress and put it on ---
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0], s.pos[2] + 25));
  await run('catch short_dress');
  await run('bite');
  await waitState((x) => x.fishing === 'bite', 'dress bite', 5000);
  await key('use', true);
  await sleep(100);
  await key('use', false);
  s = await waitState((x) => x.fishing === 'idle', 'dress reel', 8000);
  const dressIndex = await ev(`window.__ss.game.inventory.slots.findIndex((x) => x && x.id === 'short_dress')`);
  expect(dressIndex >= 0, 'dress in the inventory');
  await ev('window.__ss.openOverlay("inventory")');
  await sleep(2500);
  await shot('inventory');
  expect(await ev(`window.__ss.equipByIndex(${dressIndex})`), 'dress equipped');
  await ev('window.__ss.closeOverlay()');
  await sleep(500);
  s = await state();
  expect(s.worn.full === 'short_dress', 'wearing the dress');
  await ev('window.__ss.setYaw(0.4, 0.05)');
  await sleep(300);
  await shot('man-in-dress');

  // --- night via speed ---
  await run('speed 80');
  s = await waitState((x) => x.phase === 'night', 'night', 60_000);
  await run('speed 1');
  await sleep(800);
  await shot('night');
  const beforeSave = await state();

  // --- Save & Quit → load screen → load ---
  await ev('window.__ss.openOverlay("pause")');
  await sleep(400);
  await shot('pause');
  await browser.click('[data-action=savequit]');
  await browser.waitFor('!!document.querySelector("[data-action=new]") && !window.__ss', 30_000);
  await sleep(500);
  await browser.click('[data-action=load]');
  await browser.waitFor('!!document.querySelector(".save-row")', 20_000);
  await sleep(300);
  const rowText = await ev('document.querySelector(".save-row .title").textContent');
  const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(beforeSave.clock ? Date.now() : Date.now()));
  console.log('  load row:', rowText, '| expected pattern like:', expected, 'Ryaaaaaaan');
  expect(rowText.endsWith(' Ryaaaaaaan'), 'load row ends with the name');
  expect(/\d{4}/.test(rowText), 'load row contains a year');
  await shot('load-screen');
  await browser.click('.save-row [data-action=load]');
  await browser.waitFor('!!window.__ss', 120_000);
  await ev('window.__ss.hideClickToPlay()');
  await sleep(1500);
  s = await state();
  const d = Math.hypot(s.pos[0] - beforeSave.pos[0], s.pos[2] - beforeSave.pos[2]);
  console.log('  restored pos', s.pos.map((v) => v.toFixed(1)).join(','), 'delta', d.toFixed(2), 'phase', s.phase, 'worn', JSON.stringify(s.worn));
  expect(d < 1.5, 'position restored');
  expect(s.phase === 'night' && s.clock.day === beforeSave.clock.day, 'clock restored');
  expect(s.worn.full === 'short_dress', 'worn dress restored');
  expect(s.inventory.length === beforeSave.inventory.length, 'inventory restored');
  await shot('loaded');
  const fps = await browser.measureFps(1500);
  console.log(`  fps (${flags.gpu ? 'gpu' : 'swiftshader'}) ~ ${fps.toFixed(1)}  draws ${s.draws} tris ${s.tris}`);
} catch (err) {
  failed = true;
  console.error('SMOKE FAILED:', err.stack || err.message);
  await shot('failure').catch(() => {});
}
if (reportConsole(browser)) failed = true;
await browser.close();
server?.stop();
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
process.exit(failed ? 1 : 0);
