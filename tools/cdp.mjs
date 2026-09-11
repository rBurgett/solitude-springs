// Shared Chromium DevTools Protocol harness for the smoke, shots and perf tools.
// Launches Chromium (flatpak org.chromium.Chromium by default; override with CHROMIUM=<binary>),
// connects over CDP, collects console errors and exposes small helpers.
// Chromium must be closed with Browser.close over CDP: killing the flatpak wrapper process
// leaves the sandboxed browser running.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse `--name=value` flags and positionals from argv. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else positional.push(a);
  }
  return { flags, positional };
}

/**
 * Start the Vite dev server on a free-ish port and wait until it answers.
 * Returns { base, stop }.
 */
export async function startDevServer({ port = 5170 + Math.floor(Math.random() * 20) } = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${log}`);
    try {
      const res = await fetch(base + '/', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { base, stop: () => child.kill('SIGTERM') };
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill('SIGTERM');
  throw new Error(`vite did not start on ${port}:\n${log}`);
}

/**
 * Launch Chromium and connect. Options:
 *   width/height  viewport (default 1280×720)
 *   gpu           true → try the real GPU (headed or headless); false → SwiftShader software GL
 *   headless      default true
 *   profile       user-data-dir (default: a fresh dir under the flatpak's private /tmp)
 */
export async function launchChromium({ width = 1280, height = 720, gpu = false, headless = true, profile } = {}) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const chromium = process.env.CHROMIUM || 'flatpak';
  const wrapperArgs = process.env.CHROMIUM ? [] : ['run', 'org.chromium.Chromium'];
  const userDataDir = profile || `/tmp/ss-cdp-profile-${process.pid}-${port}`;
  const glArgs = gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const args = [
    ...wrapperArgs,
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    ...glArgs,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  const proc = spawn(chromium, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d.toString().slice(0, 2000)));
  proc.stdout.on('data', () => {});

  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`Chromium exited early: ${stderr}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  if (!wsUrl) {
    proc.kill('SIGTERM');
    throw new Error(`Chromium did not expose a page on port ${port}: ${stderr}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 0;
  const pending = new Map();
  const consoleLines = [];
  const errors = [];
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    for (const l of listeners) l(msg);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[${msg.params.type}] ${text}`);
      if (msg.params.type === 'error') errors.push(text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description || d.text;
      consoleLines.push(`[exception] ${text}`);
      errors.push(text);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      consoleLines.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
      if (e.level === 'error') errors.push(`${e.text} ${e.url || ''}`);
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function waitFor(expr, timeout = 60_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return;
      await sleep(200);
    }
    throw new Error(`timeout (${timeout} ms) waiting for ${expr}`);
  }
  async function navigate(url) {
    await send('Page.navigate', { url });
  }
  /** PNG screenshot; `clip` = {x, y, width, height, scale} zooms into a region (CSS pixels). */
  async function screenshot(file, clip) {
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { scale: 1, ...clip } } : { format: 'png' });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async function key(code, keyName, ms = 80) {
    const down = { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: 0 };
    await send('Input.dispatchKeyEvent', down);
    await sleep(ms);
    await send('Input.dispatchKeyEvent', { ...down, type: 'keyUp' });
  }
  async function holdKeys(codes, ms) {
    for (const [code, keyName] of codes) await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName });
    await sleep(ms);
    for (const [code, keyName] of codes) await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName });
  }
  async function click(selector) {
    const ok = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
    if (!ok) throw new Error('no element ' + selector);
  }
  /** Average frames per second over `ms` of requestAnimationFrame callbacks. */
  async function measureFps(ms = 2000) {
    return evaluate(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else r(n * 1000 / ${ms}); }; requestAnimationFrame(f); })`);
  }
  async function close() {
    await send('Browser.close').catch(() => {});
    ws.close();
    proc.kill('SIGTERM');
    await sleep(300);
  }

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return { send, evaluate, waitFor, navigate, screenshot, key, holdKeys, click, measureFps, close, consoleLines, errors, on: (fn) => listeners.add(fn), port };
}

/** Print collected console output and errors; returns true if there were errors. */
export function reportConsole(browser, { maxLines = 60 } = {}) {
  console.log(`\nConsole output (${browser.consoleLines.length} lines):`);
  for (const l of browser.consoleLines.slice(0, maxLines)) console.log('  ' + l.slice(0, 400));
  if (browser.errors.length) {
    console.log(`\nERRORS (${browser.errors.length}):`);
    for (const e of browser.errors.slice(0, 30)) console.log('  ' + e.slice(0, 600));
    return true;
  }
  return false;
}
