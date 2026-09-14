// Achievement triggers (plan §13) as pure checks over the progress state. The game calls
// `checkAchievements` after anything that could unlock one and stamps the unlock date.
import { FISH } from '../data/fish.ts';
import { NPCS } from '../data/npcs.ts';
import { TUNABLES } from '../data/tunables.ts';
import type { JournalState, StatsState } from './journal.ts';

export interface AchievementContext {
  stats: StatsState;
  journal: JournalState;
  serenity: number;
  /** Seconds serenity has been at 100% continuously (the Old Gus calm window, §9.4). */
  calmSeconds?: number;
  playTimeSeconds: number;
  /** Set for the check right after a catch. */
  lastCatch?: { fishId?: string; weightLb?: number; itemId?: string };
}

type Check = (c: AchievementContext) => boolean;

const CHECKS: Record<string, Check> = {
  first_catch: (c) => c.stats.fishCaught >= 1,
  dinner_is_served: (c) => c.stats.fishCaught >= 10,
  seasoned_angler: (c) => c.stats.fishCaught >= 50,
  reel_legend: (c) => c.stats.fishCaught >= 250,
  gotta_log_em_all: (c) => FISH.filter((f) => !f.legendary).every((f) => !!c.journal.species[f.id]),
  the_big_one: (c) => c.stats.bestFishLb > 10,
  old_gus: (c) => !!c.journal.species.old_gus,
  night_shift: (c) => c.stats.nightCatches >= 10,
  boat_life: (c) => c.stats.boatCatches >= 1,
  sole_survivor: (c) => c.stats.bootsCaught >= 1,
  armed_angler: (c) => c.stats.firearmsCaught >= 1,
  too_eager: (c) => c.stats.nibbleReels >= 10,
  it_got_away: (c) => c.stats.bitesMissed >= 25,
  casting_into_the_trees: (c) => c.stats.treesHit >= 10,
  hope_springs_eternal: (c) => c.stats.beerCasts >= 10,
  // the rarest one (§2.2): 100% held for the whole calm window, not just touched during the opening grace
  actual_solitude: (c) => c.serenity >= 1 && (c.calmSeconds ?? 0) >= TUNABLES.legend.calmSecondsRequired,
  castaway: (c) => c.journal.messages.length >= 12,
  tranquil_experience: (c) => c.playTimeSeconds >= 3600,
  // M2 (§13 defense / misfortune / social)
  bear_necessities: (c) => c.stats.bearsScared >= 1,
  see_you_later: (c) => c.stats.gatorsScared >= 1,
  buzzkill: (c) => c.stats.partiesBroken >= 1,
  grudge_match: (c) => c.stats.grudgesHandled >= 1,
  robbed_blind: (c) => c.stats.timesRobbed >= 10,
  emperors_new_clothes: (c) => c.stats.timesStripped >= 1,
  barrel_of_laughs: (c) => c.stats.barrelsReceived >= 1,
  close_encounter: (c) => c.stats.abductions >= 1,
  frequent_flyer: (c) => c.stats.abductions >= 3,
  gator_bait: (c) => c.stats.gatorBites >= 5,
  grizzly_tax: (c) => c.stats.fishLostToBears >= 50,
  worst_day_ever: (c) => c.stats.worstDayRobbed > 0 && c.stats.worstDayRobbed === c.stats.worstDayStripped && c.stats.worstDayRobbed === c.stats.worstDayBear,
  poof: (c) => c.stats.deaths >= 1,
  hello_neighbor: (c) => c.journal.people.length >= 10,
  social_butterfly: (c) => NPCS.every((n) => c.journal.people.includes(n.id)),
  shrewd_barterer: (c) => c.stats.tradesCompleted >= 25,
  one_mans_trash: (c) => c.stats.junkForTreasure >= 1,
  leave_no_trace: (c) => c.stats.zonesCleaned >= 1,
  did_anyone_see_that: (c) => c.stats.abductedMidConversation >= 1,
  conga: (c) => c.stats.congas >= 1,
  // M3 (§12, §13 defense / social / humour)
  not_today: (c) => c.stats.thievesStopped >= 1,
  repo_man: (c) => c.stats.stolenRecovered >= 1,
  poof_there_it_is: (c) => c.stats.hostilesPoofed >= 1,
  trailway_robbery: (c) => c.stats.robberies >= 1,
  most_wanted: (c) => c.stats.confiscations >= 1,
  oarsome: (c) => c.stats.boatMetres >= 1000,
  breezy: (c) => c.stats.dressWornSeconds >= TUNABLES.clock.dayLengthSeconds,
  dapper: (c) => c.stats.tuxedoWornSeconds >= TUNABLES.clock.dayLengthSeconds,
  dressed_by_the_river: (c) => c.stats.riverOutfits >= 1,
  believer: (c) => c.stats.tinfoilTalks >= 1,
};

/** Counter targets for the Journal's progress line (id → [current, target]); null for one-shot checks. */
const PROGRESS: Record<string, (c: AchievementContext) => [number, number]> = {
  dinner_is_served: (c) => [c.stats.fishCaught, 10],
  seasoned_angler: (c) => [c.stats.fishCaught, 50],
  reel_legend: (c) => [c.stats.fishCaught, 250],
  gotta_log_em_all: (c) => [FISH.filter((f) => !f.legendary && c.journal.species[f.id]).length, FISH.filter((f) => !f.legendary).length],
  night_shift: (c) => [c.stats.nightCatches, 10],
  too_eager: (c) => [c.stats.nibbleReels, 10],
  it_got_away: (c) => [c.stats.bitesMissed, 25],
  casting_into_the_trees: (c) => [c.stats.treesHit, 10],
  hope_springs_eternal: (c) => [c.stats.beerCasts, 10],
  robbed_blind: (c) => [c.stats.timesRobbed, 10],
  frequent_flyer: (c) => [c.stats.abductions, 3],
  gator_bait: (c) => [c.stats.gatorBites, 5],
  grizzly_tax: (c) => [c.stats.fishLostToBears, 50],
  hello_neighbor: (c) => [c.journal.people.length, 10],
  social_butterfly: (c) => [c.journal.people.length, NPCS.length],
  shrewd_barterer: (c) => [c.stats.tradesCompleted, 25],
  castaway: (c) => [c.journal.messages.length, 12],
  oarsome: (c) => [Math.floor(c.stats.boatMetres), 1000],
  tranquil_experience: (c) => [Math.floor(c.playTimeSeconds / 60), 60],
  breezy: (c) => [Math.floor(c.stats.dressWornSeconds / 60), TUNABLES.clock.dayLengthSeconds / 60],
  dapper: (c) => [Math.floor(c.stats.tuxedoWornSeconds / 60), TUNABLES.clock.dayLengthSeconds / 60],
  actual_solitude: (c) => [Math.floor(Math.min(c.calmSeconds ?? 0, TUNABLES.legend.calmSecondsRequired)), TUNABLES.legend.calmSecondsRequired],
};

/** Progress toward a counter achievement, or null when it has no counter. */
export function achievementProgress(id: string, ctx: AchievementContext): { current: number; target: number } | null {
  const p = PROGRESS[id];
  if (!p) return null;
  const [current, target] = p(ctx);
  return { current: Math.min(current, target), target };
}

/** Ids that have a trigger in this file (every achievement except the ones dialogue unlocks directly). */
export const CHECKED_ACHIEVEMENTS: readonly string[] = Object.keys(CHECKS);

/** Ids newly satisfied (not yet in `unlocked`). */
export function checkAchievements(unlocked: Record<string, string>, ctx: AchievementContext): string[] {
  const out: string[] = [];
  for (const [id, check] of Object.entries(CHECKS)) {
    if (unlocked[id]) continue;
    if (check(ctx)) out.push(id);
  }
  return out;
}
