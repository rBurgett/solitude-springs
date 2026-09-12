// Headless smoke test (plan §19 `npm run smoke`): drives the game in Chromium over CDP,
// screenshots every step into smoke-out/ and fails on any console error.
//   node tools/smoke.mjs [--base=http://localhost:5173] [--out=smoke-out] [--gpu] [--lab]
// M1 scripted path (plan §20 M1 acceptance): new game → create a male character → walk the
// switchback to the river → cast from a bank and from a bridge → catch a fish and a junk item →
// fish up and equip a dress → wait (via `speed`) until night → Save & Quit → the load screen
// shows "{localized date} {name}" → loading restores position, clock, inventory and the dress.
// Also: a missed bite leaves the line out, reeling early retrieves it, walking away auto-reels.
// M2 section (plan §20 M2 acceptance): every event forced from the console with screenshots of its
// key beats — thief (strip → barrel), party (zero bites, cans clear the water), bear (fish only),
// UFO (same spot, new clothes), water-walker, camper visit + dialogue + trade, gator, the pause
// toggle, and save/load mid-trash.
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
  // count audio sources that start and are never scheduled to stop, and looping buffer sources:
  // the owner hears any continuous layer (held pads, noise loops) as an engine whine (plan §1 #38)
  await ev(`(() => {
    const live = new Set(); window.__audioLive = live; window.__audioLoops = 0;
    const wrap = (proto, name) => { const orig = proto[name]; proto[name] = function (...a) { const node = orig.apply(this, a); live.add(node);
      const stop = node.stop.bind(node); node.stop = (...s) => { live.delete(node); return stop(...s); }; return node; }; };
    wrap(BaseAudioContext.prototype, 'createOscillator'); wrap(BaseAudioContext.prototype, 'createBufferSource');
    const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { if (this.loop) window.__audioLoops++; return start.apply(this, a); };
    return true; })()`);
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
  await run('director off');
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

  // no continuous audio layer after the walk down (plan §1 #38)
  {
    const live = await ev('window.__audioLive.size');
    const loops = await ev('window.__audioLoops');
    expect(live === 0 && loops === 0, `no sustained audio sources (never-stopped: ${live}, loops: ${loops})`);
    console.log('  audio: no sustained sources, no loops');
  }

  // --- cast from the bank (aim west across the river), force a bite, catch a fish ---
  await run('give beer_can 3');
  s = await state();
  expect(s.selected === 0 && s.inventory.some((i) => i.startsWith('old_rod')), 'rod in slot 1');
  // the mouse wheel scrolls the hotbar even without pointer lock (owner note: it sometimes stopped
  // working — the browser had refused to re-lock after an Escape exit until the next click)
  const wheel = (deltaY) => browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY });
  await wheel(120);
  s = await waitState((x) => x.selected === 1, 'the wheel to select slot 2', 5_000);
  await wheel(-120);
  s = await waitState((x) => x.selected === 0, 'the wheel to return to slot 1', 5_000);
  console.log('  wheel scrolls the hotbar without pointer lock');
  // [ and ] cycle the hotbar too (keyboard fallback), and the input diagnostics command answers
  await key('slotNext', true);
  await key('slotNext', false);
  s = await waitState((x) => x.selected === 1, '] to select slot 2', 5_000);
  await key('slotPrev', true);
  await key('slotPrev', false);
  s = await waitState((x) => x.selected === 0, '[ to return to slot 1', 5_000);
  const diag = JSON.parse(await run('input'));
  expect(typeof diag.wheelEvents === 'number' && diag.wheelEvents >= 2, `input diagnostics count wheel events (${diag.wheelEvents})`);
  console.log('  [ ] cycle the hotbar; input diagnostics:', JSON.stringify(diag));
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
  // --- a Message in a Bottle reads its note into the Journal (owner note, plan §1 #41) ---
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0], s.pos[2] + 25));
  await run('catch message_bottle');
  await run('bite');
  await waitState((x) => x.fishing === 'bite', 'bottle bite', 5000);
  await key('use', true);
  await sleep(120);
  await key('use', false);
  s = await waitState((x) => x.fishing === 'idle' && x.messages.length === 1, 'the bottle to be read into the journal', 10_000);
  expect(s.inventory.some((i) => i.startsWith('message_bottle')), 'the bottle itself is kept');
  await ev(`window.__ss.openOverlay('journal')`);
  await sleep(300);
  await browser.click('[data-tab=messages]');
  await sleep(300);
  const noteShown = await ev(`!!document.querySelector('.tab-page .fish-card .s')?.textContent`);
  expect(noteShown, 'the journal shows the note text');
  await shot('journal-message');
  await ev('window.__ss.closeOverlay()');
  await sleep(300);
  console.log('  message in a bottle read into the journal:', s.messages[0]);

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
  await run('director off');

  // ===================== M2: the interruptions =====================
  const waitEvent = async (pred, msg, timeout = 90_000) => waitState((x) => pred(x.event), msg, timeout);
  const forceEvent = async (type, npcId) => {
    const out = await run(`event ${type}${npcId ? ' ' + npcId : ''}`);
    expect(String(out).includes('started'), `event ${type} starts (${out})`);
  };
  const endEvent = async () => {
    await ev('window.__ss.endEvent()');
    await waitEvent((e) => e === null, 'event to end', 10_000);
  };
  await run('time 12:00');
  await run('tp campground');
  await sleep(800);

  // --- camper visit: Barb walks in, we talk, chat, trade, goodbye ---
  await forceEvent('visit', 'barb');
  s = await waitState((x) => x.npcs.some((n) => n.id === 'barb' && n.mode === 'idle' && Math.hypot(n.pos[0] - x.pos[0], n.pos[2] - x.pos[2]) < 4), 'Barb to arrive', 90_000);
  await sleep(600);
  await shot('visit-barb');
  await run('give fish_bluegill 3');
  await ev('window.__ss.talk("barb")');
  s = await waitState((x) => x.dialogue && x.overlay === 'dialogue', 'the dialogue box', 10_000);
  await sleep(2500);
  await shot('dialogue');
  // the reactive bark (a man in a dress) comes first, then the greeting, then the menu
  const toMenu = async () => {
    for (let i = 0; i < 8; i++) {
      const d = (await state()).dialogue;
      if (d && d.choices.includes('Chat')) return;
      await ev('window.__ss.advance()');
      await sleep(400);
    }
  };
  await toMenu();
  s = await waitState((x) => x.dialogue && x.dialogue.choices.includes('Chat'), 'the menu', 10_000);
  expect(s.dialogue.choices.includes('Trade'), 'Barb offers a trade');
  await ev('window.__ss.chooseText("Chat")');
  await sleep(600);
  await toMenu();
  s = await waitState((x) => x.dialogue && x.dialogue.choices.includes('Trade'), 'back at the menu', 10_000);
  await ev('window.__ss.chooseText("Trade")');
  for (let i = 0; i < 8 && (await state()).overlay !== 'trade'; i++) {
    await ev('window.__ss.advance()');
    await sleep(400);
  }
  s = await waitState((x) => x.overlay === 'trade', 'the trade screen', 10_000);
  await sleep(800);
  await shot('trade');
  const dealt = await ev('window.__ss.dealTrade(["fish_bluegill", "fish_bluegill", "fish_bluegill"], ["lucky_lure"])');
  expect(dealt === true, 'three bluegill buy a lucky lure (Barb: bluegill is her favourite)');
  s = await state();
  expect(s.inventory.some((i) => i.startsWith('lucky_lure')), 'lucky lure received');
  expect(s.stats.tradesCompleted === 1, 'trade counted');
  s = await waitState((x) => x.dialogue && x.dialogue.choices.length > 0, 'menu after trading', 10_000);
  await ev('window.__ss.chooseText("Goodbye")');
  for (let i = 0; i < 8 && (await state()).overlay !== 'none'; i++) {
    await ev('window.__ss.advance()');
    await sleep(400);
  }
  s = await waitState((x) => x.overlay === 'none', 'conversation closed', 10_000);
  expect(s.people.includes('barb'), 'Barb is in the journal');
  expect(s.memories.barb && s.memories.barb.met >= 1, 'Barb remembers meeting');
  await endEvent();

  // --- pause toggle: off keeps the bite timer running during dialogue; on pauses the world ---
  await run('tp campground');
  await sleep(500);
  s = await state();
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] - 20, s.pos[2]));
  expect(s.fishing === 'waiting', 'line waiting for the pause test');
  await run('bite');
  await ev('window.__ss.talk("mike")');
  await waitState((x) => x.overlay === 'dialogue', 'talking to Mike', 10_000);
  s = await waitState((x) => x.fishing === 'bite' || x.stats.bitesMissed >= 2, 'the bite arrives while talking (toggle off)', 8000);
  await ev('window.__ss.closeOverlay()');
  await sleep(300);
  await key('use', true);
  await sleep(100);
  await key('use', false);
  await waitState((x) => x.fishing === 'idle', 'line back in', 8000);
  await ev('window.__ss.setSetting("gameplay.pauseInConversations", true)');
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] - 20, s.pos[2]));
  expect(s.fishing === 'waiting', 'line waiting for the toggle-on test');
  await ev('window.__ss.talk("mike")');
  s = await waitState((x) => x.overlay === 'dialogue', 'talking to Mike again', 10_000);
  await sleep(300);
  const timerAtStart = (await state()).fishingTimer;
  await sleep(2500);
  s = await state();
  console.log('  toggle on: fishing timer', timerAtStart.toFixed(2), '→', s.fishingTimer.toFixed(2), 'phase', s.fishing);
  expect(s.fishing === 'waiting' && s.fishingTimer - timerAtStart < 0.2, 'toggle on: the bite timer paused while talking');
  await ev('window.__ss.closeOverlay()');
  await ev('window.__ss.setSetting("gameplay.pauseInConversations", false)');
  await sleep(300);
  await key('use', true);
  await sleep(100);
  await key('use', false);
  await waitState((x) => x.fishing === 'idle', 'line back in (2)', 8000);
  await endEvent();

  // --- thief: with nothing wanted, strips to underwear; a second attempt on underwear → barrel ---
  await run('tp campground');
  await run('speed 2');
  // nothing in the bag but the rod (bound): the thief finds nothing it wants
  await ev(`(() => { const inv = window.__ss.game.inventory; for (let i = 1; i < inv.slots.length; i++) inv.slots[i] = null; return true; })()`);
  s = await state();
  expect(s.wornIds.full === 'short_dress' || s.wornIds.top, 'dressed before the thief');
  await forceEvent('thief', 'pete');
  s = await waitEvent((e) => e && e.phase === 'rummage', 'Pete to rummage', 60_000);
  await shot('thief-rummage');
  s = await waitState((x) => x.event === null || x.event.phase === 'flee', 'the theft', 30_000);
  s = await state();
  console.log('  thief took:', JSON.stringify(s.memories.pete), 'worn', JSON.stringify(s.wornIds), 'stripped', s.stats.timesStripped);
  expect(s.stats.timesStripped === 1 && !s.wornIds.top && !s.wornIds.bottom && !s.wornIds.full, 'stripped to underwear');
  expect(s.achievements.includes('emperors_new_clothes'), "The Emperor's New Clothes unlocked");
  await shot('thief-flee');
  await endEvent();
  s = await state();
  expect(!s.wornIds.top && !s.wornIds.bottom && !s.wornIds.full, 'in underwear');
  await forceEvent('thief', 'earl');
  s = await waitState((x) => x.stats.barrelsReceived >= 1, 'the pity barrel', 60_000);
  expect(s.wornIds.full === 'barrel', 'wearing the barrel');
  expect(s.achievements.includes('barrel_of_laughs'), 'Barrel of Laughs unlocked');
  await sleep(800);
  await shot('barrel');
  await endEvent();
  await run('speed 1');

  // --- party: zero bites afterwards; picking up every can clears the water; save/load mid-trash ---
  await run('tp sandy_bend');
  await run('time 13:00');
  await sleep(600);
  await forceEvent('party');
  s = await waitEvent((e) => e && e.phase === 'party', 'the party to start', 90_000);
  // face the party (it sets up between the player and the water)
  s = await state();
  await ev(`window.__ss.setYaw(${yawToward(s.pos[0], s.pos[2], s.pos[0] + 8, s.pos[2] + 2)}, 0.2)`);
  await sleep(1500);
  await shot('party');
  await run('speed 3');
  s = await waitEvent((e) => e === null || e.phase === 'leave', 'the party to end', 60_000);
  await run('speed 1');
  s = await state();
  const partyZone = Object.entries(s.zones).find(([, z]) => z.trash >= 0.99 && z.cans > 0);
  expect(!!partyZone, 'a zone is trashed with cans');
  const [pzId, pz] = partyZone;
  console.log('  trashed zone', pzId, 'cans', pz.cans, 'population', pz.population);
  expect(pz.population === 0, 'population 0 after the party');
  await sleep(1500);
  await shot('party-aftermath');
  await endEvent();
  // no bites in the trashed zone
  s = await state();
  s = await castAndWait(yawToward(s.pos[0], s.pos[2], s.pos[0] + 20, s.pos[2]));
  if (s.fishing === 'waiting') {
    expect(!s.biteScheduled, 'no bite scheduled in a trashed zone');
    await key('use', true);
    await sleep(100);
    await key('use', false);
    await waitState((x) => x.fishing === 'idle', 'reel in', 8000);
  }
  // save + load mid-trash keeps the visuals and the cans
  const cansBefore = pz.cans;
  await ev('window.__ss.openOverlay("pause")');
  await sleep(300);
  await browser.click('[data-action=savequit]');
  await browser.waitFor('!!document.querySelector("[data-action=new]") && !window.__ss', 30_000);
  await browser.click('[data-action=load]');
  await browser.waitFor('!!document.querySelector(".save-row")', 20_000);
  await browser.click('.save-row [data-action=load]');
  await browser.waitFor('!!window.__ss', 120_000);
  await ev('window.__ss.hideClickToPlay()');
  await run('director off');
  await sleep(1500);
  s = await state();
  expect(s.zones[pzId].trash >= 0.98 && s.zones[pzId].cans === cansBefore, `trash state restored (${s.zones[pzId].trash}, ${s.zones[pzId].cans} cans)`);
  await shot('party-loaded');
  const picked = await ev(`window.__ss.pickupAllCans(${JSON.stringify(pzId)})`);
  s = await state();
  console.log('  picked up', picked, 'cans; zone trash now', s.zones[pzId].trash);
  expect(s.zones[pzId].trash === 0, 'water cleared after collecting every can');
  expect(s.achievements.includes('leave_no_trace'), 'Leave No Trace unlocked');
  await sleep(1200);
  await shot('party-cleaned');

  // --- bear: with fish, empties fish only ---
  await run('tp campground');
  await run('give fish_bluegill 4');
  await run('give lucky_lure 1');
  await run('speed 2');
  await forceEvent('bear');
  s = await waitEvent((e) => e && e.phase === 'sniff', 'the bear to sniff', 60_000);
  await shot('bear');
  s = await waitState((x) => x.stats.fishLostToBears >= 4, 'the bear to take the fish', 30_000);
  expect(!s.inventory.some((i) => i.startsWith('fish_')), 'no fish left');
  expect(s.inventory.some((i) => i.startsWith('lucky_lure')), 'the lure stays');
  await sleep(600);
  await shot('bear-swipe');
  await endEvent();
  await run('speed 1');

  // --- water-walker: Marina rises from the river ---
  await run('tp sandy_bend');
  await sleep(500);
  await forceEvent('waterwalker', 'marina');
  s = await waitEvent((e) => e && e.phase === 'walk', 'Marina to surface', 30_000);
  // face the river: she rises on the player's side of the channel
  s = await state();
  const marina = s.npcs.find((n) => n.id === 'marina');
  if (marina) await ev(`window.__ss.setYaw(${yawToward(s.pos[0], s.pos[2], marina.pos[0], marina.pos[2])}, 0.15)`);
  await sleep(800);
  await shot('water-walker');
  s = await waitEvent((e) => e && e.phase === 'linger', 'Marina on the bank', 60_000);
  await endEvent();

  // --- alligator: near the marsh water; a lunge or a sink ---
  await run('tp marsh');
  await sleep(500);
  s = await state();
  const heartsBefore = s.hearts;
  await forceEvent('gator');
  await sleep(2200);
  await shot('gator');
  s = await waitEvent((e) => e === null, 'the gator to finish', 40_000);
  console.log('  gator: hearts', heartsBefore, '→', s.hearts, 'bites', s.stats.gatorBites);
  expect(s.hearts <= heartsBefore, 'the gator never heals');

  // --- grudge return: an armed NPC comes back with a demand (for the most valuable thing carried) ---
  await run('tp campground');
  await ev(`(() => { const inv = window.__ss.game.inventory; for (let i = 1; i < inv.slots.length; i++) inv.slots[i] = null; return true; })()`);
  await run('give trophy 1');
  await run('grudge wade');
  await forceEvent('grudge', 'wade');
  s = await waitState((x) => x.overlay === 'dialogue' && x.dialogue && x.dialogue.npcId === 'wade', "Wade's demand", 60_000);
  await sleep(2000);
  await shot('grudge');
  for (let i = 0; i < 6 && !(await state()).dialogue?.choices.length; i++) { await ev('window.__ss.advance()'); await sleep(400); }
  s = await state();
  expect(s.dialogue && s.dialogue.choices.some((c) => c.startsWith('Fine')), 'the hand-over choice');
  await ev('window.__ss.chooseText("Fine")');
  await sleep(1500);
  await ev('window.__ss.advance()');
  await sleep(300);
  await ev('window.__ss.advance()');
  s = await waitState((x) => x.overlay === 'none', 'grudge settled', 15_000);
  expect(!s.inventory.some((i) => i.startsWith('trophy')), 'the trophy was handed over');
  expect(s.stats.grudgesHandled === 1 && s.achievements.includes('grudge_match'), 'Grudge Match unlocked');
  await endEvent();

  // --- UFO: returns the player within 0.1 m of the original position with different clothing ---
  await run('tp campground');
  await run('time 23:00');
  await sleep(600);
  s = await state();
  const beforeUfo = s;
  await forceEvent('ufo');
  s = await waitEvent((e) => e && e.phase === 'descent', 'the saucer', 30_000);
  await sleep(2500);
  await shot('ufo-descent');
  s = await waitEvent((e) => e && e.phase === 'beam', 'the beam', 30_000);
  await sleep(2000);
  await shot('ufo-beam');
  s = await waitState((x) => x.overlay === 'dialogue', 'the interview', 30_000);
  await sleep(1500);
  await shot('ufo-interview');
  for (let i = 0; i < 40 && (await state()).overlay === 'dialogue'; i++) {
    await ev('window.__ss.advance()'); // finishes typing, or continues a line without choices
    await sleep(300);
    const d = (await state()).dialogue;
    if (d && d.choices.length && !d.typing) await ev('window.__ss.choose(0)');
    await sleep(300);
  }
  s = await waitEvent((e) => e === null, 'the return', 40_000);
  const dd = Math.hypot(s.pos[0] - beforeUfo.pos[0], s.pos[2] - beforeUfo.pos[2]);
  console.log('  ufo return delta', dd.toFixed(3), 'worn', JSON.stringify(s.wornIds), 'was', JSON.stringify(beforeUfo.wornIds), 'clock', s.clock.time - beforeUfo.clock.time);
  expect(dd < 0.1, 'returned within 0.1 m');
  expect(JSON.stringify(s.wornIds) !== JSON.stringify(beforeUfo.wornIds), 'different worn clothing');
  expect(s.stats.abductions === 1 && s.achievements.includes('close_encounter'), 'abduction counted');
  await sleep(600);
  await shot('ufo-return');
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
