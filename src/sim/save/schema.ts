// Save record (plan §14.2). Dates are ISO 8601 UTC strings; the load screen localizes them (§14.4).
import type { InventoryState } from '../inventory.ts';
import type { ClockState } from '../clock.ts';
import type { JournalState, StatsState } from '../journal.ts';

export const SCHEMA_VERSION = 1;

export interface CharacterRecord {
  name: string;
  sex: 'male' | 'female';
  skin: number;
  hairColor: string;
  hairStyle: string;
  outfitColors: Record<string, string>;
}

export interface PickupRecord {
  id: string;
  itemId: string;
  count: number;
  color?: string;
  position: [number, number, number];
}

export interface ZoneRecord {
  population: number;
  trash: number;
}

export interface SaveRecord {
  id: string;
  schemaVersion: number;
  createdAt: string;
  savedAt: string;
  playTimeSeconds: number;
  thumbnail?: string;
  character: CharacterRecord;
  player: {
    position: [number, number, number];
    facing: number;
    health: number;
    inBoat: boolean;
    inventory: InventoryState;
  };
  world: {
    clock: ClockState;
    zones: Record<string, ZoneRecord>;
    boat: [number, number, number, number] | null;
    pickups: PickupRecord[];
  };
  npcs: Record<string, unknown>;
  director: {
    wanted: number;
    ufoRecentUntil: number;
    lull: boolean;
  };
  progress: {
    achievements: Record<string, string>;
    stats: StatsState;
    journal: JournalState;
    serenity: number;
  };
  rng: { seed: number; state: number };
}

/** Summary shown on the load screen. */
export interface SaveSummary {
  id: string;
  name: string;
  savedAt: string;
  day: number;
  fishCaught: number;
  playTimeSeconds: number;
  thumbnail?: string;
  damaged?: boolean;
}
