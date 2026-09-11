// Fishing zones (plan §7.2, §9.3, §11.4): population and trash per zone, recovery over time.
import { TUNABLES } from '../data/tunables.ts';
import type { WaterKind } from '../data/fish.ts';

export interface ZoneDef {
  id: string;
  name: string;
  water: WaterKind;
}

export interface ZoneState {
  id: string;
  /** 0..1 fish population. */
  population: number;
  /** 0..1 trash level; ≥ 0.5 counts as trashed (junk and cans only, no regrowth). */
  trash: number;
}

export const TRASHED_THRESHOLD = 0.5;

export function createZoneState(def: ZoneDef): ZoneState {
  return { id: def.id, population: 1, trash: 0 };
}

export function isTrashed(z: ZoneState): boolean {
  return z.trash >= TRASHED_THRESHOLD;
}

/** Every catch lowers population (§9.3). */
export function onCatch(z: ZoneState): void {
  z.population = Math.max(0, z.population - TUNABLES.line.catchPopulationDrop);
}

/** Regrow toward 100% unless trashed; trash decays slowly on its own. */
export function recoverZone(z: ZoneState, gameHours: number): void {
  if (gameHours <= 0) return;
  if (!isTrashed(z)) z.population = Math.min(1, z.population + TUNABLES.line.populationRegrowPerHour * gameHours);
  if (z.trash > 0) z.trash = Math.max(0, z.trash - TUNABLES.line.trashRecoveryPerHour * gameHours);
}

/** Picking up a can cleans the zone a little (double with a trash bag). */
export function onCanPickedUp(z: ZoneState, hasTrashBag: boolean): void {
  const amount = TUNABLES.line.cleanupTrashPerCan * (hasTrashBag ? TUNABLES.line.trashBagMultiplier : 1);
  z.trash = Math.max(0, z.trash - amount);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
