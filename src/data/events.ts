// The event table (plan §11.3). Weights, class, cooldowns and eligibility are data; the Director
// (src/sim/director.ts) evaluates conditions against a snapshot of the player's situation.
import type { DayPhase } from './fish.ts';

export type EventType = 'visit' | 'hiker' | 'waterwalker' | 'thief' | 'party' | 'bear' | 'gator' | 'ufo' | 'ranger' | 'grudge';
export type EventClass = 'minor' | 'major';

export interface EventDef {
  type: EventType;
  cls: EventClass;
  /** Base weight; 0 = never picked at random (forced only). */
  weight: number;
  /** Weight multiplier at night. */
  nightMultiplier?: number;
  /** Cooldown in real seconds after this event ends. */
  cooldownSeconds: number;
  phases?: readonly DayPhase[];
  /** Player must be within this many metres of the water's edge. */
  maxWaterDistance?: number;
  /** Player must NOT be in these areas / zones. */
  notInAreas?: readonly string[];
  /** Player must be in one of these water kinds' zones (near water). */
  waterKinds?: readonly ('pool' | 'river' | 'marsh')[];
  needsFish?: boolean;
  notInBoat?: boolean;
  /** Minimum minutes into the save. */
  minSaveMinutes?: number;
  /** Not under a bridge deck. */
  notUnderBridge?: boolean;
  /** Needs an NPC with a grudge last seen ≥ N days ago. */
  needsGrudge?: boolean;
}

export const EVENTS: readonly EventDef[] = [
  { type: 'visit', cls: 'minor', weight: 30, cooldownSeconds: 120, phases: ['dawn', 'day', 'dusk'] },
  { type: 'hiker', cls: 'minor', weight: 20, cooldownSeconds: 60 },
  { type: 'waterwalker', cls: 'minor', weight: 10, cooldownSeconds: 300, maxWaterDistance: 15 },
  { type: 'thief', cls: 'major', weight: 15, nightMultiplier: 2, cooldownSeconds: 300 },
  { type: 'party', cls: 'major', weight: 8, cooldownSeconds: 720, phases: ['day', 'dusk'], maxWaterDistance: 40, notInAreas: ['marsh'] },
  { type: 'bear', cls: 'major', weight: 6, cooldownSeconds: 600, needsFish: true, notInBoat: true },
  { type: 'gator', cls: 'major', weight: 6, cooldownSeconds: 480, maxWaterDistance: 12, waterKinds: ['river', 'marsh'] },
  { type: 'ufo', cls: 'major', weight: 1.5, nightMultiplier: 3, cooldownSeconds: 2700, minSaveMinutes: 20, notUnderBridge: true },
  { type: 'ranger', cls: 'major', weight: 0, cooldownSeconds: 600 },
  { type: 'grudge', cls: 'major', weight: 8, cooldownSeconds: 900, needsGrudge: true },
];

export const EVENT_BY_TYPE: ReadonlyMap<EventType, EventDef> = new Map(EVENTS.map((e) => [e.type, e]));

export function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && EVENT_BY_TYPE.has(v as EventType);
}
