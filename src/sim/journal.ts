// Journal and stats (plan §13, §16.2): fish log with records, messages in bottles, people met.
import { FISH_BY_ID } from '../data/fish.ts';

export interface SpeciesRecord {
  caught: number;
  recordLb: number;
  firstAt: string;
}

export interface JournalState {
  species: Record<string, SpeciesRecord>;
  /** Message-in-a-bottle note ids found. */
  messages: string[];
  /** NPC ids met (M2). */
  people: string[];
}

export interface StatsState {
  fishCaught: number;
  junkCaught: number;
  clothingCaught: number;
  castsMade: number;
  treesHit: number;
  bitesMissed: number;
  cansCollected: number;
  metresWalked: number;
  bestFishLb: number;
  nightCatches: number;
  nibbleReels: number;
  bootsCaught: number;
  firearmsCaught: number;
  beerCasts: number;
  boatCatches: number;
}

export function createJournal(): JournalState {
  return { species: {}, messages: [], people: [] };
}

export function createStats(): StatsState {
  return { fishCaught: 0, junkCaught: 0, clothingCaught: 0, castsMade: 0, treesHit: 0, bitesMissed: 0, cansCollected: 0, metresWalked: 0, bestFishLb: 0, nightCatches: 0, nibbleReels: 0, bootsCaught: 0, firearmsCaught: 0, beerCasts: 0, boatCatches: 0 };
}

export interface CatchRecordResult {
  newSpecies: boolean;
  newRecord: boolean;
}

/** Record a catch; returns whether it's a first for the species and/or a new weight record. */
export function recordCatch(j: JournalState, fishId: string, weightLb: number, nowIso: string): CatchRecordResult {
  if (!FISH_BY_ID.has(fishId)) throw new Error(`unknown fish ${fishId}`);
  const cur = j.species[fishId];
  if (!cur) {
    j.species[fishId] = { caught: 1, recordLb: weightLb, firstAt: nowIso };
    return { newSpecies: true, newRecord: true };
  }
  cur.caught += 1;
  const newRecord = weightLb > cur.recordLb;
  if (newRecord) cur.recordLb = weightLb;
  return { newSpecies: false, newRecord };
}

export function speciesSeen(j: JournalState): number {
  return Object.keys(j.species).length;
}
