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
};

/** Ids newly satisfied (not yet in `unlocked`). */
export function checkAchievements(unlocked: Record<string, string>, ctx: AchievementContext): string[] {
  const out: string[] = [];
  for (const [id, check] of Object.entries(CHECKS)) {
    if (unlocked[id]) continue;
    if (check(ctx)) out.push(id);
  }
  return out;
}
