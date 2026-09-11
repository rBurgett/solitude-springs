// Fallback for machines whose npm is older than 11.10 (no native min-release-age):
// runs npm with --before=<today − buffer>, which makes the resolver ignore anything
// published after that date. Usage: node tools/npm-safe.mjs install [args…]
// Don't combine --before with min-release-age in one config; --before wins.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmrc = readFileSync(path.join(ROOT, '.npmrc'), 'utf8');
const days = Number(npmrc.match(/^\s*min-release-age\s*=\s*(\d+)\s*$/m)?.[1] ?? 14);
const before = new Date(Date.now() - days * 86_400_000).toISOString();
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node tools/npm-safe.mjs <npm args…>');
  process.exit(2);
}
console.log(`npm ${args.join(' ')} --before=${before}`);
const child = spawn('npm', [...args, `--before=${before}`], { stdio: 'inherit', cwd: ROOT });
child.on('exit', (code) => process.exit(code ?? 1));
