// Independent verification of the release-age buffer (plan §3.3).
// Reads package-lock.json, looks up the registry publish time of every resolved
// package version, and fails if any was published more recently than the buffer.
// The buffer length is read from .npmrc (min-release-age) so there is one source of truth.
//   node tools/check-deps-age.mjs [--json]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;
const asJson = process.argv.includes('--json');

function fail(msg) {
  console.error(`deps:check FAILED: ${msg}`);
  process.exit(1);
}

const npmrc = await readFile(path.join(ROOT, '.npmrc'), 'utf8').catch(() => fail('.npmrc is missing'));
const m = npmrc.match(/^\s*min-release-age\s*=\s*(\d+)\s*$/m);
if (!m) fail('.npmrc does not set min-release-age');
const bufferDays = Number(m[1]);
if (!(bufferDays >= 1)) fail(`min-release-age must be >= 1 day (got ${m[1]})`);
const cutoff = Date.now() - bufferDays * 86_400_000;

const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8').catch(() => fail('package-lock.json is missing')));
if (lock.lockfileVersion < 2) fail(`unsupported lockfile version ${lock.lockfileVersion}`);

/** name@version → {name, version, paths[]} for every non-root, non-link entry. */
const wanted = new Map();
for (const [p, info] of Object.entries(lock.packages ?? {})) {
  if (p === '' || info.link) continue;
  const name = info.name ?? p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!info.version) fail(`${p} has no version in the lockfile`);
  if (info.resolved && !info.resolved.startsWith(`${REGISTRY}/`)) {
    fail(`${name}@${info.version} resolves outside the npm registry: ${info.resolved}`);
  }
  const key = `${name}@${info.version}`;
  if (!wanted.has(key)) wanted.set(key, { name, version: info.version, paths: [] });
  wanted.get(key).paths.push(p);
}

const docCache = new Map();
async function packument(name) {
  if (!docCache.has(name)) {
    docCache.set(
      name,
      (async () => {
        const url = `${REGISTRY}/${name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`;
        const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
        return res.json();
      })(),
    );
  }
  return docCache.get(name);
}

const entries = [...wanted.values()];
const results = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < entries.length) {
      const e = entries[cursor++];
      try {
        const doc = await packument(e.name);
        const published = doc.time?.[e.version];
        if (!published) {
          results.push({ ...e, ok: false, reason: 'no publish time in registry metadata' });
          continue;
        }
        const t = Date.parse(published);
        const ageDays = (Date.now() - t) / 86_400_000;
        results.push({ ...e, published, ageDays, ok: t <= cutoff, reason: t <= cutoff ? '' : `published ${ageDays.toFixed(1)} days ago (< ${bufferDays})` });
      } catch (err) {
        results.push({ ...e, ok: false, reason: `lookup failed: ${err.message}` });
      }
    }
  }),
);

results.sort((a, b) => (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity));
const bad = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ bufferDays, checked: results.length, failures: bad }, null, 2));
} else {
  console.log(`deps:check — buffer ${bufferDays} days, ${results.length} resolved package versions`);
  for (const r of results.slice(0, 8)) {
    console.log(`  ${r.ok ? 'ok ' : 'BAD'} ${(r.name + '@' + r.version).padEnd(44)} ${r.published ? r.published.slice(0, 10) : '-'}  ${r.ageDays !== undefined ? r.ageDays.toFixed(0).padStart(5) + ' d' : ''} ${r.reason}`);
  }
  if (results.length > 8) console.log(`  … ${results.length - 8} older entries ok`);
}
if (bad.length) {
  for (const r of bad) console.error(`  ${r.name}@${r.version}: ${r.reason}`);
  fail(`${bad.length} package version(s) violate the ${bufferDays}-day release-age buffer`);
}
console.log('deps:check passed');
