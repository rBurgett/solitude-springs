// Checksum-verified asset fetcher (plan §4.2). Reads assets-src/assets.json, downloads anything
// missing from an allow-listed HTTPS host, verifies SHA-256 (recording it on first fetch), unzips
// pipeline inputs, expands Poly Haven entries through its API, writes public/assets/fetched/index.json
// for the runtime, and regenerates ASSETS.md.
//   node tools/fetch-assets.mjs [--only=<id substring>] [--strict] [--skip-download]
//   --strict  fail if any entry has no recorded SHA-256 (use at checkpoints)
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'assets-src', 'assets.json');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'fetched');
const USER_AGENT = 'solitude-springs-asset-fetch/0.1 (game asset pipeline; contact via repository)';
const TIMEOUT_MS = 120_000;
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const ONLY = flag('only')?.split('=')[1] ?? '';
const STRICT = !!flag('strict');
const SKIP = !!flag('skip-download');

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const allowed = new Set(manifest.allowedHosts);
const problems = [];
const newHashes = [];

function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`refusing non-HTTPS url ${url}`);
  if (!allowed.has(u.hostname)) throw new Error(`host ${u.hostname} is not in allowedHosts (${url})`);
}

async function fetchJson(url) {
  checkUrl(url);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function fileSha256(file) {
  return sha256(await readFile(file));
}

/** Download to dest, verify (or record) sha256. Returns {status, sha256, size}. */
async function download(url, dest, expected) {
  checkUrl(url);
  const abs = path.join(ROOT, dest);
  try {
    const s = await stat(abs);
    if (expected?.sha256) {
      if (expected.size !== undefined && s.size !== expected.size) throw new Error('size differs');
      const h = await fileSha256(abs);
      if (h !== expected.sha256) throw new Error(`cached file ${dest} has sha256 ${h}, expected ${expected.sha256}`);
      return { status: 'cached', sha256: h, size: s.size };
    }
    const h = await fileSha256(abs);
    return { status: 'cached-unverified', sha256: h, size: s.size };
  } catch (err) {
    if (err.code !== 'ENOENT' && !/size differs/.test(err.message)) throw err;
  }
  if (SKIP) return { status: 'missing', sha256: null, size: 0 };
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS * 10), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const finalHost = new URL(res.url).hostname;
  if (!allowed.has(finalHost)) throw new Error(`redirected to disallowed host ${finalHost}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const h = sha256(buf);
  if (expected?.sha256 && h !== expected.sha256) throw new Error(`SHA-256 mismatch for ${url}: got ${h}, expected ${expected.sha256}`);
  if (expected?.size !== undefined && buf.length !== expected.size) throw new Error(`size mismatch for ${url}: got ${buf.length}, expected ${expected.size}`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { status: 'downloaded', sha256: h, size: buf.length };
}

async function extract(zipDest, extractTo) {
  const abs = path.join(ROOT, zipDest);
  const out = path.join(ROOT, extractTo);
  const marker = path.join(out, '.extracted', path.basename(zipDest) + '.done');
  try {
    await stat(marker);
    return 'already extracted';
  } catch {
    /* extract */
  }
  await mkdir(out, { recursive: true });
  await execFileP('unzip', ['-o', '-q', abs, '-d', out], { maxBuffer: 64 * 1024 * 1024 });
  await mkdir(path.dirname(marker), { recursive: true });
  await writeFile(marker, new Date().toISOString());
  return 'extracted';
}

const runtimeIndex = { generatedAt: new Date().toISOString(), assets: {} };

async function copyOut(entry) {
  for (const c of entry.copy ?? []) {
    const from = path.join(ROOT, entry.extractTo, c.from);
    const to = path.join(ROOT, c.to);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, force: true });
    console.log(`    copied ${c.from} -> ${c.to}`);
  }
}

async function handleFile(entry) {
  let r;
  if (entry.kind === 'manual') {
    const abs = path.join(ROOT, entry.dest);
    try {
      const s = await stat(abs);
      const h = await fileSha256(abs);
      if (entry.sha256 && h !== entry.sha256) throw new Error(`manual file ${entry.dest} has sha256 ${h}, expected ${entry.sha256}`);
      r = { status: 'manual', sha256: h, size: s.size };
    } catch (err) {
      if (err.code === 'ENOENT') {
        problems.push(`${entry.id}: manual download missing at ${entry.dest} — ${entry.note ?? ''}`);
        return;
      }
      throw err;
    }
  } else {
    r = await download(entry.url, entry.dest, entry);
  }
  if (r.status === 'missing') {
    problems.push(`${entry.id}: not downloaded (--skip-download)`);
    return;
  }
  if (!entry.sha256) {
    entry.sha256 = r.sha256;
    entry.size = r.size;
    newHashes.push(entry.id);
  }
  console.log(`  [${r.status}] ${entry.dest} (${(r.size / 1e6).toFixed(1)} MB)`);
  if (entry.extractTo) {
    console.log(`    ${await extract(entry.dest, entry.extractTo)} -> ${entry.extractTo}`);
    await copyOut(entry);
  }
  if (entry.dest.startsWith('public/assets/fetched/')) {
    runtimeIndex.assets[entry.id] = { file: entry.dest.replace('public/assets/fetched/', ''), license: entry.license, title: entry.title };
  }
}

/** Poly Haven: expand into concrete files via the API, then download each with pinned hashes. */
async function handlePolyhaven(entry) {
  entry.files ??= {};
  const destDir = entry.dest;
  const wanted = [];
  if (Object.keys(entry.files).length === 0) {
    const files = await fetchJson(`https://api.polyhaven.com/files/${entry.asset}`);
    if (entry.type === 'hdri') {
      const f = files.hdri?.[entry.res]?.hdr;
      if (!f) throw new Error(`no ${entry.res} hdr for ${entry.asset}`);
      wanted.push({ rel: path.basename(new URL(f.url).pathname), url: f.url, md5: f.md5, size: f.size });
    } else if (entry.type === 'texture') {
      for (const map of entry.maps) {
        const f = files[map]?.[entry.res]?.jpg ?? files[map]?.[entry.res]?.png;
        if (!f) {
          problems.push(`${entry.id}: map ${map} not available at ${entry.res}`);
          continue;
        }
        wanted.push({ rel: path.basename(new URL(f.url).pathname), url: f.url, md5: f.md5, size: f.size, map });
      }
    } else if (entry.type === 'model') {
      const f = files.gltf?.[entry.res]?.gltf;
      if (!f) throw new Error(`no ${entry.res} gltf for ${entry.asset}`);
      wanted.push({ rel: path.basename(new URL(f.url).pathname), url: f.url, md5: f.md5, size: f.size, main: true });
      for (const [rel, inc] of Object.entries(f.include ?? {})) wanted.push({ rel, url: inc.url, md5: inc.md5, size: inc.size });
    }
    for (const w of wanted) entry.files[w.rel] = { url: w.url, size: w.size, sha256: null, ...(w.map ? { map: w.map } : {}), ...(w.main ? { main: true } : {}) };
    newHashes.push(entry.id);
  }
  for (const [rel, f] of Object.entries(entry.files)) {
    const dest = path.posix.join(destDir, rel);
    const r = await download(f.url, dest, f.sha256 ? f : undefined);
    if (r.status === 'missing') {
      problems.push(`${entry.id}/${rel}: not downloaded`);
      continue;
    }
    if (!f.sha256) {
      f.sha256 = r.sha256;
      f.size = r.size;
    }
    console.log(`  [${r.status}] ${dest}`);
  }
  const relDir = destDir.replace('public/assets/fetched/', '');
  const files = Object.fromEntries(Object.entries(entry.files).map(([rel, f]) => [rel, { ...(f.map ? { map: f.map } : {}), ...(f.main ? { main: true } : {}) }]));
  runtimeIndex.assets[entry.id] = { dir: relDir, type: entry.type, files, license: entry.license, title: entry.title ?? entry.asset };
}

console.log(`Fetching assets${ONLY ? ` matching "${ONLY}"` : ''}…`);
for (const entry of manifest.assets) {
  if (ONLY && !entry.id.includes(ONLY)) continue;
  try {
    console.log(`${entry.id}:`);
    if (entry.kind === 'file' || entry.kind === 'manual') await handleFile(entry);
    else if (entry.kind === 'polyhaven') await handlePolyhaven(entry);
    else throw new Error(`unknown kind ${entry.kind}`);
  } catch (err) {
    problems.push(`${entry.id}: ${err.message}`);
    console.error(`  FAILED ${err.message}`);
  }
}

// Persist recorded hashes and the runtime index; regenerate ASSETS.md.
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
if (!ONLY) {
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(path.join(RUNTIME_DIR, 'index.json'), JSON.stringify(runtimeIndex, null, 2));
} else {
  // merge into the existing runtime index so partial runs don't drop entries
  let existing = { assets: {} };
  try {
    existing = JSON.parse(await readFile(path.join(RUNTIME_DIR, 'index.json'), 'utf8'));
  } catch {
    /* none */
  }
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(path.join(RUNTIME_DIR, 'index.json'), JSON.stringify({ generatedAt: runtimeIndex.generatedAt, assets: { ...existing.assets, ...runtimeIndex.assets } }, null, 2));
}
const md = [
  '# Third-party assets',
  '',
  'Generated by `node tools/fetch-assets.mjs` from `assets-src/assets.json`. Do not edit by hand.',
  '',
  'Allowed licenses are CC0, MIT and CC-BY (plan §4.2). CC-BY assets keep their own license and',
  'attribution and do not become Apache-2.0 with the rest of the repository. Every download is',
  'HTTPS-only from an allow-listed host and verified against the SHA-256 recorded here.',
  '',
  '| Id | Asset | Author | License | Source | Local path | SHA-256 |',
  '|---|---|---|---|---|---|---|',
];
for (const e of manifest.assets) {
  const local = e.copy ? e.copy.map((c) => c.to).join(', ') : e.dest;
  const hash = e.kind === 'polyhaven' ? Object.values(e.files ?? {}).map((f) => (f.sha256 ?? 'pending').slice(0, 12)).join(', ') : (e.sha256 ?? 'pending').slice(0, 16);
  md.push(`| ${e.id} | ${e.title ?? e.asset} | ${e.author ?? 'Poly Haven'} | ${e.license} | [link](${e.source}) | \`${local}\` | \`${hash}\` |`);
}
md.push('', 'Usage notes:', '');
for (const e of manifest.assets) if (e.usage) md.push(`- **${e.id}** — ${e.usage}`);
md.push('');
await writeFile(path.join(ROOT, 'ASSETS.md'), md.join('\n'));

if (newHashes.length) console.log(`\nRecorded new SHA-256 hashes for: ${newHashes.join(', ')} — review and commit assets-src/assets.json.`);
if (STRICT) {
  for (const e of manifest.assets) {
    if ((e.kind === 'file' || e.kind === 'manual') && !e.sha256) problems.push(`${e.id}: no sha256 recorded (strict)`);
    if (e.kind === 'polyhaven') for (const [rel, f] of Object.entries(e.files ?? {})) if (!f.sha256) problems.push(`${e.id}/${rel}: no sha256 recorded (strict)`);
  }
}
if (problems.length) {
  console.error('\nProblems:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nAll assets present and verified.');
