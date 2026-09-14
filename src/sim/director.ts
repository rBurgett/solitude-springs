// The Annoyance Director (plan §11.1–§11.3): serenity, grace periods, pacing, lulls, eligibility,
// event and NPC picks. Pure and deterministic given the rng; the game applies its intents.
import { TUNABLES } from '../data/tunables.ts';
import { EVENTS, type EventClass, type EventDef, type EventType } from '../data/events.ts';
import type { DayPhase } from '../data/fish.ts';
import type { NpcDef } from '../data/npcs.ts';
import { grudgeReady, isOutOfPool, type NpcMemory } from './npcMemory.ts';

const D = TUNABLES.director;
const S = TUNABLES.serenity;

export interface DirectorState {
  wanted: number;
  /** Day+fraction until which Suspiciously Glowing Perch can bite (0 = never abducted). */
  ufoRecentUntil: number;
  lull: boolean;
  /** Session seconds. */
  sessionSeconds: number;
  graceUntil: number;
  nextEventAt: number;
  lullUntil: number;
  /** Day fraction at which today's lull starts, and the day it was scheduled for. */
  lullAtFraction: number;
  lullScheduledDay: number;
  /** Session seconds when each event type becomes eligible again. */
  cooldowns: Partial<Record<EventType, number>>;
  activeEvent: EventType | null;
  lastEventClass: EventClass | null;
  lastEventEndedAt: number;
  eventsRun: number;
  /** Day+fraction of the last occurrence of each event type (for "recently" barks and requirements). */
  recent: Partial<Record<EventType, number>>;
  /** A ranger was poofed: the next ranger event sends both (§12.3). */
  rangersBoth: boolean;
}

/** What the save keeps (plan §14.2): pacing phase, cooldowns as remaining seconds, wanted, lull, ufo. */
export interface DirectorSave {
  wanted: number;
  ufoRecentUntil: number;
  lull: boolean;
  sessionSeconds: number;
  cooldownsRemaining: Partial<Record<EventType, number>>;
  lullScheduledDay: number;
  lullAtFraction: number;
  recent: Partial<Record<EventType, number>>;
  eventsRun: number;
  rangersBoth: boolean;
}

export function createDirector(newGame: boolean, rng: () => number): DirectorState {
  const grace = newGame ? D.graceSecondsNewGame : D.graceSecondsAfterLoad;
  const d: DirectorState = {
    wanted: 0, ufoRecentUntil: 0, lull: false, sessionSeconds: 0, graceUntil: grace, nextEventAt: 0, lullUntil: 0, lullAtFraction: -1, lullScheduledDay: 0,
    cooldowns: {}, activeEvent: null, lastEventClass: null, lastEventEndedAt: -1e9, eventsRun: 0, recent: {}, rangersBoth: false,
  };
  d.nextEventAt = grace + rollGap(d, rng);
  return d;
}

export function toDirectorSave(d: DirectorState): DirectorSave {
  const cooldownsRemaining: Partial<Record<EventType, number>> = {};
  for (const [k, at] of Object.entries(d.cooldowns) as [EventType, number][]) if (at > d.sessionSeconds) cooldownsRemaining[k] = Math.round(at - d.sessionSeconds);
  return { wanted: d.wanted, ufoRecentUntil: d.ufoRecentUntil, lull: d.lull, sessionSeconds: d.sessionSeconds, cooldownsRemaining, lullScheduledDay: d.lullScheduledDay, lullAtFraction: d.lullAtFraction, recent: { ...d.recent }, eventsRun: d.eventsRun, rangersBoth: d.rangersBoth };
}

export function fromDirectorSave(s: DirectorSave, rng: () => number): DirectorState {
  const d = createDirector(false, rng);
  d.wanted = s.wanted;
  d.ufoRecentUntil = s.ufoRecentUntil;
  d.lull = false; // in-flight lulls don't survive a load (the grace period covers it)
  d.sessionSeconds = s.sessionSeconds;
  d.graceUntil = s.sessionSeconds + D.graceSecondsAfterLoad;
  d.nextEventAt = d.graceUntil + rollGap(d, rng);
  for (const [k, rem] of Object.entries(s.cooldownsRemaining) as [EventType, number][]) d.cooldowns[k] = s.sessionSeconds + rem;
  d.lullScheduledDay = s.lullScheduledDay;
  d.lullAtFraction = s.lullAtFraction;
  d.recent = { ...s.recent };
  d.eventsRun = s.eventsRun;
  d.rangersBoth = s.rangersBoth;
  return d;
}

/** Mean gap ramps from start to end over the ramp window; ±jitter uniform. */
export function meanGap(sessionSeconds: number): number {
  const t = Math.max(0, Math.min(1, sessionSeconds / D.rampSeconds));
  return D.gapMeanStart + (D.gapMeanEnd - D.gapMeanStart) * t;
}

export function rollGap(d: DirectorState, rng: () => number): number {
  const m = meanGap(d.sessionSeconds);
  return m * (1 + (rng() * 2 - 1) * D.gapJitter);
}

// ---- serenity --------------------------------------------------------------------------------

/** Passive rise while quiet (no NPC/animal within the quiet radius and no active event). */
export function serenityTick(serenity: number, dt: number, quiet: boolean): number {
  if (!quiet) return serenity;
  return Math.min(1, serenity + S.regenPerSecond * dt);
}

export function serenityAfterEvent(serenity: number, cls: EventClass, type: EventType): number {
  if (type === 'ufo') return 0;
  return Math.max(0, serenity - (cls === 'major' ? S.dropMajor : S.dropMinor));
}

export function serenityAfterHurt(serenity: number): number {
  return Math.max(0, serenity - S.dropHurt);
}

// ---- eligibility -------------------------------------------------------------------------------

/** A snapshot of the player's situation the eligibility rules read. */
export interface Situation {
  phase: DayPhase;
  /** Day + fraction. */
  now: number;
  areaId: string | null;
  waterDistance: number;
  waterKind: 'pool' | 'river' | 'marsh' | null;
  hasFish: boolean;
  inBoat: boolean;
  underBridge: boolean;
  saveMinutes: number;
  lineOut: boolean;
  /** Any NPC with a grudge whose return is due. */
  grudgeReady: boolean;
  /** Wading in the marsh at night doubles gator odds (§11.4). */
  wadingMarshNight: boolean;
}

export function isEligible(def: EventDef, s: Situation): boolean {
  if (def.phases && !def.phases.includes(s.phase)) return false;
  if (def.maxWaterDistance !== undefined && s.waterDistance > def.maxWaterDistance) return false;
  if (def.notInAreas && s.areaId && def.notInAreas.includes(s.areaId)) return false;
  if (def.waterKinds && (!s.waterKind || !def.waterKinds.includes(s.waterKind))) return false;
  if (def.needsFish && !s.hasFish) return false;
  if (def.notInBoat && s.inBoat) return false;
  if (def.minSaveMinutes !== undefined && s.saveMinutes < def.minSaveMinutes) return false;
  if (def.notUnderBridge && s.underBridge) return false;
  if (def.needsGrudge && !s.grudgeReady) return false;
  return true;
}

export function eventWeight(def: EventDef, s: Situation): number {
  let w = def.weight;
  if (s.phase === 'night' && def.nightMultiplier) w *= def.nightMultiplier;
  if (def.type === 'gator' && s.wadingMarshNight) w *= TUNABLES.events.gatorMarshNightMultiplier;
  return w;
}

export function cooldownReady(d: DirectorState, type: EventType): boolean {
  return (d.cooldowns[type] ?? 0) <= d.sessionSeconds;
}

/** Eligible, off cooldown and positively weighted candidates. */
export function candidates(d: DirectorState, s: Situation): EventDef[] {
  return EVENTS.filter((e) => e.weight > 0 && cooldownReady(d, e.type) && isEligible(e, s));
}

export function pickEvent(d: DirectorState, s: Situation, rng: () => number): EventType | null {
  // the ranger is forced when wanted crosses the threshold (§12.3)
  if (d.wanted >= D.rangerWantedThreshold && cooldownReady(d, 'ranger')) return 'ranger';
  const list = candidates(d, s);
  if (list.length === 0) return null;
  let total = 0;
  for (const e of list) total += eventWeight(e, s);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const e of list) {
    const w = eventWeight(e, s);
    if (r < w) return e.type;
    r -= w;
  }
  return list[list.length - 1]!.type;
}

// ---- the tick ----------------------------------------------------------------------------------

export interface DirectorIntent {
  startEvent?: EventType;
  lullStarted?: boolean;
  lullEnded?: boolean;
}

/**
 * Advance session time. `s` is the current situation, `dayFraction` 0..1 through the cycle.
 * Returns what the game should do; events only start when nothing is active and the gap elapsed.
 */
export function tickDirector(d: DirectorState, dt: number, s: Situation, day: number, dayFraction: number, rng: () => number): DirectorIntent {
  const out: DirectorIntent = {};
  d.sessionSeconds += dt;
  // lull scheduling: once per in-game day at a random point of the day, 3–6 real minutes
  if (d.lullScheduledDay !== day) {
    d.lullScheduledDay = day;
    d.lullAtFraction = D.lullsPerDay > 0 && day >= D.firstLullDay ? rng() : -1;
  }
  // a lull is a quiet window: it waits for the last visitor to be gone a while (serenity has begun to climb)
  if (!d.lull && d.lullAtFraction >= 0 && dayFraction >= d.lullAtFraction && !d.activeEvent && d.sessionSeconds >= d.lastEventEndedAt + D.minGapAfterMajor) {
    d.lull = true;
    d.lullAtFraction = -1;
    d.lullUntil = d.sessionSeconds + D.lullMinSeconds + rng() * (D.lullMaxSeconds - D.lullMinSeconds);
    out.lullStarted = true;
  }
  if (d.lull && d.sessionSeconds >= d.lullUntil) {
    d.lull = false;
    d.nextEventAt = Math.max(d.nextEventAt, d.sessionSeconds + rollGap(d, rng) * 0.5);
    out.lullEnded = true;
  }
  if (d.activeEvent || d.lull || d.sessionSeconds < d.graceUntil) return out;
  // fishing makes it worse: the gap shrinks while the line is in the water (§11.2)
  const speed = s.lineOut ? D.fishingOddsMultiplier : 1;
  d.nextEventAt -= dt * (speed - 1);
  const minGap = d.lastEventClass === 'major' ? D.minGapAfterMajor : d.lastEventClass === 'minor' ? D.minGapAfterMinor : 0;
  if (d.sessionSeconds < d.nextEventAt || d.sessionSeconds < d.lastEventEndedAt + minGap) return out;
  const type = pickEvent(d, s, rng);
  if (!type) {
    d.nextEventAt = d.sessionSeconds + 10; // nothing eligible right now: check again soon
    return out;
  }
  out.startEvent = type;
  return out;
}

export function onEventStarted(d: DirectorState, type: EventType, now: number): void {
  d.activeEvent = type;
  d.eventsRun += 1;
  d.recent[type] = now;
}

export function onEventEnded(d: DirectorState, type: EventType, rng: () => number): void {
  const def = EVENTS.find((e) => e.type === type)!;
  d.activeEvent = null;
  d.lastEventClass = def.cls;
  d.lastEventEndedAt = d.sessionSeconds;
  d.cooldowns[type] = d.sessionSeconds + def.cooldownSeconds;
  d.nextEventAt = d.sessionSeconds + rollGap(d, rng);
}

/** Was `type` within the last in-game day? `now` is day+fraction. */
export function recentEvent(d: DirectorState, type: EventType, now: number, days = 1): boolean {
  const t = d.recent[type];
  return t !== undefined && now - t <= days;
}

export function decayWanted(d: DirectorState, elapsedDays: number): void {
  d.wanted = Math.max(0, d.wanted - D.wantedDecayPerDay * elapsedDays);
}

// ---- NPC picks ---------------------------------------------------------------------------------

/**
 * Pick roster NPCs for an event: prefer ones not seen recently, skip poofed ones still out of the
 * pool, and sometimes prefer a returning one with a story beat (grudge, quest).
 */
export function pickNpcs(pool: readonly NpcDef[], memories: Record<string, NpcMemory | undefined>, day: number, now: number, count: number, rng: () => number, exclude: ReadonlySet<string> = new Set()): NpcDef[] {
  const avail = pool.filter((n) => !exclude.has(n.id) && !(memories[n.id] && isOutOfPool(memories[n.id]!, now)));
  const out: NpcDef[] = [];
  const taken = new Set<string>();
  const weight = (n: NpcDef): number => {
    const m = memories[n.id];
    let w = 1;
    if (m && m.lastSeenDay > 0 && day - m.lastSeenDay < D.recentNpcDays) w *= 0.25;
    if (m && grudgeReady(m, day) && rng() < D.returningStoryChance) w *= 4;
    return w;
  };
  for (let i = 0; i < count; i++) {
    const rest = avail.filter((n) => !taken.has(n.id));
    if (rest.length === 0) break;
    let total = 0;
    const ws = rest.map((n) => {
      const w = weight(n);
      total += w;
      return w;
    });
    let r = rng() * total;
    let pick = rest[rest.length - 1]!;
    for (let k = 0; k < rest.length; k++) {
      if (r < ws[k]!) {
        pick = rest[k]!;
        break;
      }
      r -= ws[k]!;
    }
    taken.add(pick.id);
    out.push(pick);
  }
  return out;
}
