// Achievements (plan §13). Data only; triggers live in src/sim/achievements.ts (M1 wires the
// fishing and humour ones that M1 systems can produce; the rest arrive with their events).
export type AchievementCategory = 'fishing' | 'defense' | 'misfortune' | 'social' | 'humor';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  secret?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_catch', name: 'First Catch', description: 'Catch your first fish.', category: 'fishing' },
  { id: 'dinner_is_served', name: 'Dinner Is Served', description: 'Catch 10 fish.', category: 'fishing' },
  { id: 'seasoned_angler', name: 'Seasoned Angler', description: 'Catch 50 fish.', category: 'fishing' },
  { id: 'reel_legend', name: 'Reel Legend', description: 'Catch 250 fish.', category: 'fishing' },
  { id: 'gotta_log_em_all', name: "Gotta Log 'Em All", description: 'Catch all 12 non-legendary species.', category: 'fishing' },
  { id: 'the_big_one', name: 'The Big One', description: 'Catch a fish over 10 lb.', category: 'fishing' },
  { id: 'old_gus', name: 'Old Gus', description: 'Catch the legend.', category: 'fishing' },
  { id: 'night_shift', name: 'Night Shift', description: 'Catch 10 fish at night.', category: 'fishing' },
  { id: 'boat_life', name: 'Boat Life', description: 'Catch a fish from the boat.', category: 'fishing' },
  { id: 'sole_survivor', name: 'Sole Survivor', description: 'Fish up a boot.', category: 'fishing' },
  { id: 'armed_angler', name: 'Armed Angler', description: 'Fish up a firearm.', category: 'fishing' },
  { id: 'too_eager', name: 'Too Eager', description: 'Reel in on a nibble 10 times.', category: 'fishing' },
  { id: 'it_got_away', name: 'It Got Away', description: 'Miss 25 bites.', category: 'fishing' },
  { id: 'casting_into_the_trees', name: 'Casting Into the Trees', description: 'Hit a tree with your cast 10 times.', category: 'fishing' },
  { id: 'not_today', name: 'Not Today', description: 'Stop a thief before they take anything.', category: 'defense' },
  { id: 'repo_man', name: 'Repo Man', description: 'Recover stolen items.', category: 'defense' },
  { id: 'poof_there_it_is', name: 'Poof, There It Is', description: 'Poof a hostile.', category: 'defense' },
  { id: 'bear_necessities', name: 'Bear Necessities', description: 'Scare off a bear before it takes your fish.', category: 'defense' },
  { id: 'see_you_later', name: 'See You Later', description: 'Scare off an alligator.', category: 'defense' },
  { id: 'buzzkill', name: 'Buzzkill', description: 'Break up a party early.', category: 'defense' },
  { id: 'grudge_match', name: 'Grudge Match', description: 'Deal with someone who came back for revenge.', category: 'defense' },
  { id: 'robbed_blind', name: 'Robbed Blind', description: 'Get robbed 10 times.', category: 'misfortune' },
  { id: 'emperors_new_clothes', name: "The Emperor's New Clothes", description: 'Get stripped to your underwear.', category: 'misfortune' },
  { id: 'barrel_of_laughs', name: 'Barrel of Laughs', description: 'Receive the pity barrel.', category: 'misfortune' },
  { id: 'close_encounter', name: 'Close Encounter', description: 'Get abducted.', category: 'misfortune' },
  { id: 'frequent_flyer', name: 'Frequent Flyer', description: 'Get abducted 3 times.', category: 'misfortune' },
  { id: 'gator_bait', name: 'Gator Bait', description: 'Get bitten 5 times.', category: 'misfortune' },
  { id: 'grizzly_tax', name: 'Grizzly Tax', description: 'Lose 50 fish to bears.', category: 'misfortune' },
  { id: 'hope_springs_eternal', name: 'Hope Springs Eternal', description: 'Cast into beer-colored water 10 times.', category: 'misfortune' },
  { id: 'worst_day_ever', name: 'Worst Day Ever', description: 'Get robbed, stripped, and lose fish to a bear in the same in-game day.', category: 'misfortune' },
  { id: 'poof', name: 'Poof!', description: 'Get poofed yourself.', category: 'misfortune' },
  { id: 'hello_neighbor', name: 'Hello, Neighbor', description: 'Talk to 10 different people.', category: 'social' },
  { id: 'social_butterfly', name: 'Social Butterfly', description: 'Meet all 58 regulars.', category: 'social' },
  { id: 'shrewd_barterer', name: 'Shrewd Barterer', description: 'Complete 25 trades.', category: 'social' },
  { id: 'one_mans_trash', name: "One Man's Trash", description: 'Trade a piece of junk for something worth 10+.', category: 'social' },
  { id: 'leave_no_trace', name: 'Leave No Trace', description: 'Clean every can from a trashed area.', category: 'social' },
  { id: 'trailway_robbery', name: 'Trailway Robbery', description: 'Rob someone.', category: 'social' },
  { id: 'most_wanted', name: 'Most Wanted', description: 'Have a ranger confiscate a weapon.', category: 'social' },
  { id: 'is_this_yours', name: 'Is This Yours?', description: "Return Lost Keys Larry's car keys.", category: 'social' },
  { id: 'actual_solitude', name: 'Actual Solitude', description: 'Reach 100% serenity.', category: 'humor' },
  { id: 'breezy', name: 'Breezy', description: "Wear a dress for a full in-game day as a character who didn't start in one.", category: 'humor' },
  { id: 'dapper', name: 'Dapper', description: "Wear a tuxedo for a full in-game day as a character who didn't start in one.", category: 'humor' },
  { id: 'dressed_by_the_river', name: 'Dressed by the River', description: 'Wear a full outfit made entirely of fished-up clothes.', category: 'humor' },
  { id: 'believer', name: 'Believer', description: 'Wear the Tinfoil Hat while talking to Conspiracy Carl.', category: 'humor' },
  { id: 'castaway', name: 'Castaway', description: 'Collect all 12 messages in bottles.', category: 'humor' },
  { id: 'oarsome', name: 'Oarsome', description: 'Row the boat 1 km total.', category: 'humor' },
  { id: 'tranquil_experience', name: 'A Tranquil Fishing Experience', description: 'Play for 60 minutes total.', category: 'humor' },
  { id: 'did_anyone_see_that', name: 'Did Anyone See That?', description: 'Get abducted mid-conversation.', category: 'humor', secret: true },
  { id: 'conga', name: 'Conga!', description: "Join Destiny's conga line with the bear nearby.", category: 'humor', secret: true },
];

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
