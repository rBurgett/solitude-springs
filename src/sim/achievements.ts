// Achievement triggers (plan §13) as pure checks over the progress state. The game calls
// `checkAchievements` after anything that could unlock one and stamps the unlock date.
import { FISH } from '../data/fish.ts';
import type { JournalState, StatsState } from './journal.ts';

export interface AchievementContext {
  stats: StatsState;
  journal: JournalState;
  serenity: number;
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
  actual_solitude: (c) => c.serenity >= 1,
  castaway: (c) => c.journal.messages.length >= 12,
  tranquil_experience: (c) => c.playTimeSeconds >= 3600,
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
