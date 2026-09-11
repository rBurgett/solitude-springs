// Save migrations keyed by schemaVersion (plan §14.5). Each step upgrades one version.
import { SCHEMA_VERSION } from './schema.ts';

type Migration = (v: Record<string, unknown>) => Record<string, unknown>;

/** version N → N+1 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: pre-release saves had no schemaVersion; nothing else to convert.
  0: (v) => ({ ...v, schemaVersion: 1 }),
};

/** Upgrade to the current schema. Returns null for a future version we can't read. */
export function migrateSave(input: Record<string, unknown>): Record<string, unknown> | null {
  let v = { ...input };
  let version = typeof v.schemaVersion === 'number' && Number.isInteger(v.schemaVersion) ? v.schemaVersion : 0;
  if (version > SCHEMA_VERSION) return null;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null;
    v = step(v);
    version += 1;
    v.schemaVersion = version;
  }
  return v;
}
