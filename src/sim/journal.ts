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
  // M2 (§11, §13)
  timesRobbed: number;
  timesStripped: number;
  barrelsReceived: number;
  abductions: number;
  abductedMidConversation: number;
  gatorBites: number;
  fishLostToBears: number;
  bearsScared: number;
  gatorsScared: number;
  partiesBroken: number;
  tradesCompleted: number;
  junkForTreasure: number;
  zonesCleaned: number;
  congas: number;
  eventsSurvived: number;
  grudgesHandled: number;
  /** Day on which the player was robbed / stripped / lost fish to a bear (Worst Day Ever, §13). */
  worstDayRobbed: number;
  worstDayStripped: number;
  worstDayBear: number;
  deaths: number;
}

export function createJournal(): JournalState {
  return { species: {}, messages: [], people: [] };
}

export function createStats(): StatsState {
  return {
    fishCaught: 0, junkCaught: 0, clothingCaught: 0, castsMade: 0, treesHit: 0, bitesMissed: 0, cansCollected: 0, metresWalked: 0, bestFishLb: 0, nightCatches: 0, nibbleReels: 0, bootsCaught: 0, firearmsCaught: 0, beerCasts: 0, boatCatches: 0,
    timesRobbed: 0, timesStripped: 0, barrelsReceived: 0, abductions: 0, abductedMidConversation: 0, gatorBites: 0, fishLostToBears: 0, bearsScared: 0, gatorsScared: 0, partiesBroken: 0, tradesCompleted: 0, junkForTreasure: 0, zonesCleaned: 0, congas: 0, eventsSurvived: 0, grudgesHandled: 0,
    worstDayRobbed: 0, worstDayStripped: 0, worstDayBear: 0, deaths: 0,
  };
}

/** Fishing up a bottle: one note not yet found, or null once every note has been read. */
export function pickMessage(j: JournalState, ids: readonly string[], random: () => number): string | null {
  const left = ids.filter((id) => !j.messages.includes(id));
  if (!left.length) return null;
  return left[Math.min(left.length - 1, Math.floor(random() * left.length))]!;
}

/** Record a found note; false when it was already in the Journal. */
export function recordMessage(j: JournalState, id: string): boolean {
  if (j.messages.includes(id)) return false;
  j.messages.push(id);
  return true;
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

/** Record a person met (first time only). Returns true when new. */
export function recordPerson(j: JournalState, npcId: string): boolean {
  if (j.people.includes(npcId)) return false;
  j.people.push(npcId);
  return true;
}

export function speciesSeen(j: JournalState): number {
  return Object.keys(j.species).length;
}
