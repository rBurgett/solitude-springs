// World layout (plan §7.1): a ~600 × 600 m valley. Coordinates in metres: +x east, +z south,
// y up with the water surface at y = 0. The river runs north (the spring pool) to south (the
// marsh). Everything here is authored data; src/world/valley.ts turns it into terrain.
import type { WaterKind } from './fish.ts';

export const WORLD_SIZE = 600;
/** Playable radius-ish: beyond this the boundary ridge pushes back (§7.1 #10). */
export const BOUNDARY = { xMin: -255, xMax: 255, zMin: -285, zMax: 285 };

export interface AreaDef {
  id: string;
  name: string;
  /** Centre and radius for "you are here" / area barks. */
  x: number;
  z: number;
  radius: number;
}

/**
 * Area layout relative to the river (the spline meanders, so x is resolved by the valley):
 * `side` east/west = `offset` metres beyond the water's edge; `center` = on the river; `fixed` = x as given.
 */
export interface AreaTemplate {
  id: string;
  name: string;
  z: number;
  side: 'east' | 'west' | 'center' | 'fixed';
  offset: number;
  x?: number;
  radius: number;
}

export const AREA_TEMPLATES: readonly AreaTemplate[] = [
  { id: 'trailhead', name: 'Trailhead', z: -252, side: 'fixed', x: 0, offset: 0, radius: 32 },
  { id: 'switchback', name: 'Switchback Trail', z: -212, side: 'east', offset: 22, radius: 34 },
  { id: 'pool', name: 'Solitude Springs Pool', z: -168, side: 'center', offset: 0, radius: 36 },
  { id: 'cedar_bridge', name: 'Cedar Bridge', z: -110, side: 'center', offset: 0, radius: 18 },
  { id: 'campground', name: 'Campground', z: -60, side: 'east', offset: 16, radius: 30 },
  { id: 'plank_bridge', name: 'Old Plank Bridge', z: -20, side: 'center', offset: 0, radius: 18 },
  { id: 'sandy_bend', name: 'Sandy Bend', z: 32, side: 'west', offset: 7, radius: 22 },
  { id: 'dock', name: 'Boat Dock', z: 62, side: 'east', offset: 8, radius: 18 },
  { id: 'suspension_bridge', name: 'Suspension Footbridge', z: 120, side: 'center', offset: 0, radius: 20 },
  { id: 'marsh', name: 'Gator Marsh', z: 215, side: 'center', offset: 0, radius: 60 },
  { id: 'deep_woods', name: 'Deep Woods', z: 40, side: 'west', offset: 110, radius: 90 },
];

export interface ZoneDefData {
  id: string;
  name: string;
  water: WaterKind;
  /** River z range the zone covers. */
  zMin: number;
  zMax: number;
}

/** ~10 fishing zones along the river spline (§7.2). */
export const ZONES: readonly ZoneDefData[] = [
  { id: 'pool', name: 'Spring Pool', water: 'pool', zMin: -230, zMax: -135 },
  { id: 'cedar_run', name: 'Cedar Run', water: 'river', zMin: -135, zMax: -90 },
  { id: 'camp_run', name: 'Campground Run', water: 'river', zMin: -90, zMax: -40 },
  { id: 'plank_run', name: 'Plank Bridge Run', water: 'river', zMin: -40, zMax: 5 },
  { id: 'sandy_bend', name: 'Sandy Bend', water: 'river', zMin: 5, zMax: 50 },
  { id: 'dock_run', name: 'Dock Run', water: 'river', zMin: 50, zMax: 100 },
  { id: 'suspension_run', name: 'Suspension Run', water: 'river', zMin: 100, zMax: 150 },
  { id: 'upper_marsh', name: 'Upper Marsh', water: 'marsh', zMin: 150, zMax: 200 },
  { id: 'marsh', name: 'Gator Marsh', water: 'marsh', zMin: 200, zMax: 250 },
  { id: 'deep_marsh', name: 'Deep Marsh', water: 'marsh', zMin: 250, zMax: 320 },
];

export interface BridgeDef {
  id: string;
  name: string;
  z: number;
  kind: 'cedar' | 'plank' | 'suspension';
  /** Deck height above the water. */
  clearance: number;
}

export const BRIDGES: readonly BridgeDef[] = [
  { id: 'cedar', name: 'Cedar Bridge', z: -110, kind: 'cedar', clearance: 1.6 },
  { id: 'plank', name: 'Old Plank Bridge', z: -20, kind: 'plank', clearance: 1.3 },
  { id: 'suspension', name: 'Suspension Footbridge', z: 120, kind: 'suspension', clearance: 2.6 },
];

/** Player start and respawn (the trailhead bench, §7.1 #1). */
export const SPAWN = { x: 4, z: -240, yaw: 0 };

/** The boat dock: dock root on the east bank, extending west into the river. */
export const DOCK = { z: 62, length: 7 };

/** Campground clearing (east bank) and Sandy Bend beach (west bank), resolved by the valley. */
export const CAMPGROUND_TEMPLATE = { z: -60, offset: 14, radius: 22 };
export const SANDY_BEND_TEMPLATE = { z: 32, offset: 6, radius: 16 };

export const PARKING = { x: 0, z: -258, halfW: 22, halfD: 12 };
