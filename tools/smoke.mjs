// Headless smoke test (plan §19 `npm run smoke`): drives the app in Chromium over CDP,
// screenshots every step into smoke-out/ and fails on any console error.
//   node tools/smoke.mjs [--base=http://localhost:5173] [--out=smoke-out] [--gpu]
// Without --base it starts its own Vite dev server. M0 scope: boot page + both lab pages.
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
try {
  console.log('Navigating to', base);
  await browser.navigate(base + '/');
  await browser.waitFor('!!document.querySelector(".placeholder")', 60_000);
  await sleep(300);
  await shot('boot');
  const title = await browser.evaluate('document.title');
  console.log('  title:', title);
  if (!/Solitude Springs/.test(title)) throw new Error('unexpected title ' + title);

  for (const [page, query] of [
    ['lab/characters.html', 'candidate=a&shot=walk'],
    ['lab/characters.html', 'candidate=b&shot=lineup'],
    ['lab/characters.html', 'candidate=c&shot=lineup'],
    ['lab/vignette.html', 'time=day&state=clean&grass=15000'],
    ['lab/vignette.html', 'time=night&state=trashed&grass=15000'],
  ]) {
    await browser.navigate(`${base}/${page}?${query}`);
    await browser.waitFor('window.__labReady === true || !!window.__labError', 180_000);
    const err = await browser.evaluate('window.__labError || ""');
    if (err) throw new Error(`${page}?${query}: ${err}`);
    await sleep(250);
    await shot(page.replace(/[^a-z]+/g, '-') + '-' + query.replace(/[^a-z]+/g, '-'));
    const stats = await browser.evaluate('JSON.stringify(window.__labStats || null)');
    console.log('  stats:', stats);
    const fps = await browser.measureFps(1500);
    console.log(`  fps (${flags.gpu ? 'gpu' : 'swiftshader'}) ~ ${fps.toFixed(1)}`);
  }
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
