// Performance run (plan §19 `npm run perf`): Chromium with the real GPU plays a scripted
// flythrough + walk across the map and reports p50/p95 frame time, draw calls and triangles per
// preset, plus the GPU the browser actually used (hybrid laptops: check it's the one you meant).
//   node tools/perf.mjs [--preset=medium,high] [--base=http://localhost:5173] [--out=perf-out] [--headed]
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, startDevServer, parseArgs, reportConsole, ROOT, sleep } from './cdp.mjs';

const { flags } = parseArgs();
const OUT = path.resolve(ROOT, flags.out || 'perf-out');
const PRESETS = String(flags.preset || 'medium').split(',');
const server = flags.base ? null : await startDevServer();
const base = flags.base ? String(flags.base).replace(/\/$/, '') : server.base;
const browser = await launchChromium({ gpu: true, headless: !flags.headed, width: 1920, height: 1080 });
const ev = (expr) => browser.evaluate(expr);
let failed = false;
const results = [];

/** Stations: teleport target + a look direction, walk for a few seconds, then measure. */
const STATIONS = [
  { name: 'trailhead', tp: 'trailhead', yaw: 0.2 },
  { name: 'pool', tp: 'pool', yaw: 2.4 },
  { name: 'campground', tp: 'campground', yaw: 3.6 },
  { name: 'plank_bridge', tp: 'plank_bridge', yaw: 0.0 },
  { name: 'deep_woods', tp: 'deep_woods', yaw: 1.2 },
  { name: 'marsh', tp: 'marsh', yaw: 3.1 },
];

async function measure(seconds = 3000) {
  return ev(`new Promise((resolve) => {
    const times = []; let last = performance.now();
    const f = () => { const now = performance.now(); times.push(now - last); last = now; if (times.length < 2 || now - t0 < ${seconds}) requestAnimationFrame(f); else done(); };
    const t0 = performance.now();
    const done = () => { times.shift(); times.sort((a, b) => a - b); const s = window.__ss.state(); resolve({ frames: times.length, p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)], mean: times.reduce((a, b) => a + b, 0) / times.length, draws: s.draws, tris: s.tris }); };
    requestAnimationFrame(f);
  })`);
}

try {
  await browser.navigate(base + '/');
  await browser.waitFor('window.__app && window.__app.ready', 240_000);
  const gpu = await ev(`(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
  console.log('GPU:', gpu);
  for (const preset of PRESETS) {
    await ev(`(() => { const s = window.__app['settings']; s.applyPreset(${JSON.stringify(preset)}); return true; })()`);
    if (!(await ev('!!window.__ss'))) {
      await ev('window.__app.quickStart("Perf")');
      await browser.waitFor('!!window.__ss', 240_000);
      await ev('window.__ss.hideClickToPlay()');
    }
    await sleep(1500);
    const perStation = [];
    for (const st of STATIONS) {
      await ev(`window.__ss.run(${JSON.stringify('tp ' + st.tp)})`);
      await ev(`window.__ss.setYaw(${st.yaw}, 0.15)`);
      await sleep(800);
      // walk a bit so vegetation refills and animation runs
      await ev('window.__ss.key("forward", true)');
      await sleep(1500);
      await ev('window.__ss.key("forward", false)');
      const m = await measure(3000);
      perStation.push({ station: st.name, ...m });
      console.log(`  [${preset}] ${st.name.padEnd(13)} p50 ${m.p50.toFixed(1)} ms  p95 ${m.p95.toFixed(1)} ms  mean ${m.mean.toFixed(1)} ms (${(1000 / m.mean).toFixed(0)} fps)  draws ${m.draws}  tris ${m.tris.toLocaleString()}`);
      await browser.screenshot(path.join(OUT, `${preset}-${st.name}.png`));
    }
    const p95 = Math.max(...perStation.map((s) => s.p95));
    const p50 = perStation.reduce((a, s) => a + s.p50, 0) / perStation.length;
    const worstFps = Math.min(...perStation.map((s) => 1000 / s.mean));
    console.log(`  [${preset}] overall p50 ${p50.toFixed(1)} ms, worst p95 ${p95.toFixed(1)} ms, worst mean fps ${worstFps.toFixed(0)}  → target: 60 fps / p95 ≤ 20 ms (Medium, Iris Xe)`);
    results.push({ preset, gpu, p50, worstP95: p95, worstFps, stations: perStation });
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'perf.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} catch (err) {
  failed = true;
  console.error('PERF FAILED:', err.stack || err.message);
}
if (reportConsole(browser, { maxLines: 20 })) failed = true;
await browser.close();
server?.stop();
console.log(failed ? '\nPERF FAILED' : '\nPERF DONE');
process.exit(failed ? 1 : 0);
