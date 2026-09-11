// Silly names for the creator's dice button (plan §5).
export const SILLY_FIRST = ['Bubba', 'Dorothea', 'Gus', 'Marlene', 'Cletus', 'Peaches', 'Dwayne', 'Bernadette', 'Skeeter', 'Winifred', 'Rufus', 'Trixie', 'Merle', 'Bootsie', 'Lyle', 'Ardith', 'Chip', 'Wanda', 'Delmar', 'Petunia', 'Ryaaaaaaan', 'Big Al', 'Tiny', 'Ma', 'Junior'];
export const SILLY_LAST = ['Fishbone', 'Wetsock', 'Hootenanny', 'Pumpernickel', 'Bassmaster', 'Dampwood', 'McGillicuddy', 'Snodgrass', 'Tackleberry', 'Bobberson', 'Mudflap', 'Crappie', 'Vanderhoof', 'Gatorbait', 'Sunburn'];

export function randomSillyName(rng: () => number): string {
  const f = SILLY_FIRST[Math.floor(rng() * SILLY_FIRST.length)]!;
  const l = SILLY_LAST[Math.floor(rng() * SILLY_LAST.length)]!;
  return rng() < 0.35 ? f : `${f} ${l}`;
}
