// Save migrations keyed by schemaVersion (plan §14.5). Each step upgrades one version.
import { SCHEMA_VERSION } from './schema.ts';

type Migration = (v: Record<string, unknown>) => Record<string, unknown>;

/** version N → N+1 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: pre-release saves had no schemaVersion; nothing else to convert.
  0: (v) => ({ ...v, schemaVersion: 1 }),
  // 1 → 2 (M2): npc memories, the director's pacing state and new stats. Old fields carry over;
  // missing ones take their defaults in validation.
  1: (v) => {
    const d = (typeof v.director === 'object' && v.director !== null ? v.director : {}) as Record<string, unknown>;
    return { ...v, schemaVersion: 2, npcs: {}, director: { wanted: d.wanted ?? 0, ufoRecentUntil: d.ufoRecentUntil ?? 0, lull: false, sessionSeconds: 0, cooldownsRemaining: {}, lullScheduledDay: 0, lullAtFraction: -1, recent: {}, eventsRun: 0 } };
  },
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
