// Fishing state machine (plan §9): charge → cast → wait (nibbles) → bite window → reel.
// Pure and time-stepped; the gameplay layer feeds intents and renders the resulting phase.
import { TUNABLES } from '../data/tunables.ts';
import { biteWindowFor, rollCatch, type CatchContext, type CatchResult } from './catchTable.ts';

export type FishingPhase = 'idle' | 'charging' | 'flying' | 'waiting' | 'bite' | 'reeling';

export type ReelResult = 'caught' | 'empty' | 'thunk';

export interface FishingState {
  phase: FishingPhase;
  /** 0..1 cast charge. */
  charge: number;
  /** Seconds in the current phase. */
  timer: number;
  /** Waiting: seconds until the bite; nibble times before it. */
  biteAt: number;
  nibbleTimes: number[];
  /** Seconds a nibble twitch stays visible. */
  nibbleVisible: number;
  /** The rolled catch for this wait (null = no bites in this water). */
  pending: CatchResult | null;
  /** Bite window length for the pending catch. */
  window: number;
  /** Reeling: what comes up. */
  reelResult: ReelResult | null;
  /** Number of bites missed in a row (for barks/achievements). */
  missedStreak: number;
}

export type FishingEvent =
  | { type: 'cast'; distance: number }
  | { type: 'nibble' }
  | { type: 'bite' }
  | { type: 'missed' }
  | { type: 'reelStart'; result: ReelResult }
  | { type: 'landed'; result: ReelResult; catch: CatchResult | null }
  | { type: 'thunk' };

const B = TUNABLES.bite;

export function createFishing(): FishingState {
  return { phase: 'idle', charge: 0, timer: 0, biteAt: Infinity, nibbleTimes: [], nibbleVisible: 0, pending: null, window: 0, reelResult: null, missedStreak: 0 };
}

/** Triangular distribution sample on [min, max] with the given mode. */
export function triangular(min: number, max: number, mode: number, r: number): number {
  const c = (mode - min) / (max - min);
  if (r < c) return min + Math.sqrt(r * (max - min) * (mode - min));
  return max - Math.sqrt((1 - r) * (max - min) * (max - mode));
}

/** Bite delay in seconds for a zone population (Infinity when the zone is empty). */
export function rollBiteDelay(population: number, rng: () => number, multiplier = 1): number {
  if (population <= 0) return Infinity;
  let d = triangular(B.delayMinSeconds, B.delayMaxSeconds, B.delayModeSeconds, rng());
  if (population < B.lowPopulationThreshold) d *= B.lowPopulationDelayMultiplier;
  return d * multiplier;
}

export function castDistance(charge: number): number {
  const c = TUNABLES.cast;
  return c.minDistance + (c.maxDistance - c.minDistance) * Math.max(0, Math.min(1, charge));
}

/** Hold right mouse: start charging (only from idle). */
export function startCharge(s: FishingState): boolean {
  if (s.phase !== 'idle') return false;
  s.phase = 'charging';
  s.charge = 0;
  s.timer = 0;
  return true;
}

/** Release: cast with the current charge. */
export function releaseCast(s: FishingState): FishingEvent | null {
  if (s.phase !== 'charging') return null;
  s.phase = 'flying';
  s.timer = 0;
  return { type: 'cast', distance: castDistance(s.charge) };
}

function scheduleWait(s: FishingState, ctx: CatchContext, delayMultiplier: number): void {
  s.phase = 'waiting';
  s.timer = 0;
  s.nibbleVisible = 0;
  s.pending = ctx.population > 0 ? rollCatch(ctx) : null;
  s.window = s.pending ? biteWindowFor(s.pending) : 0;
  s.biteAt = s.pending ? rollBiteDelay(ctx.population, ctx.rng, delayMultiplier) : Infinity;
  s.nibbleTimes = [];
  if (Number.isFinite(s.biteAt)) {
    const n = Math.floor(ctx.rng() * (B.nibblesMax + 1));
    for (let i = 0; i < n; i++) s.nibbleTimes.push(s.biteAt * (0.35 + ctx.rng() * 0.55));
    s.nibbleTimes.sort((a, b) => a - b);
  }
}

/** The bobber landed on water: the wait begins. */
export function landedOnWater(s: FishingState, ctx: CatchContext): void {
  if (s.phase !== 'flying') return;
  scheduleWait(s, ctx, 1);
}

/** The bobber hit ground, a tree or a bridge: thunk and auto-reel (§9.1). */
export function landedOnGround(s: FishingState): FishingEvent[] {
  if (s.phase !== 'flying') return [];
  s.phase = 'reeling';
  s.timer = 0;
  s.reelResult = 'thunk';
  s.pending = null;
  return [{ type: 'thunk' }, { type: 'reelStart', result: 'thunk' }];
}

/** Right mouse while the line is out. */
export function reelPressed(s: FishingState): FishingEvent | null {
  if (s.phase === 'bite') {
    s.phase = 'reeling';
    s.timer = 0;
    s.reelResult = 'caught';
    s.missedStreak = 0;
    return { type: 'reelStart', result: 'caught' };
  }
  if (s.phase === 'waiting') {
    s.phase = 'reeling';
    s.timer = 0;
    s.reelResult = 'empty';
    s.pending = null;
    return { type: 'reelStart', result: 'empty' };
  }
  return null;
}

/** Forced retrieve (walked away, switched item, boarded the boat, grabbed by an event). */
export function autoReel(s: FishingState): FishingEvent[] {
  if (s.phase === 'idle' || s.phase === 'charging') {
    s.phase = 'idle';
    return [];
  }
  s.phase = 'reeling';
  s.timer = 0;
  s.reelResult = 'empty';
  s.pending = null;
  return [{ type: 'reelStart', result: 'empty' }];
}

/** Advance time. `paused` freezes bite timers (the "pause during conversations" toggle, §9.3). */
export function updateFishing(s: FishingState, dt: number, ctx: CatchContext | null, paused = false): FishingEvent[] {
  const out: FishingEvent[] = [];
  if (s.phase === 'charging') {
    s.charge = Math.min(1, s.charge + dt / TUNABLES.cast.chargeSeconds);
    s.timer += dt;
    return out;
  }
  if (paused) return out;
  s.timer += dt;
  if (s.nibbleVisible > 0) s.nibbleVisible = Math.max(0, s.nibbleVisible - dt);
  switch (s.phase) {
    case 'waiting':
      while (s.nibbleTimes.length && s.timer >= s.nibbleTimes[0]!) {
        s.nibbleTimes.shift();
        s.nibbleVisible = 0.6;
        out.push({ type: 'nibble' });
      }
      if (s.timer >= s.biteAt) {
        s.phase = 'bite';
        s.timer = 0;
        out.push({ type: 'bite' });
      }
      break;
    case 'bite':
      if (s.timer >= s.window) {
        out.push({ type: 'missed' });
        s.missedStreak += 1;
        if (ctx) scheduleWait(s, ctx, B.missedDelayMultiplier);
        else {
          s.phase = 'waiting';
          s.biteAt = Infinity;
          s.pending = null;
        }
      }
      break;
    case 'reeling':
      if (s.timer >= B.reelSeconds) {
        const result = s.reelResult ?? 'empty';
        const c = result === 'caught' ? s.pending : null;
        s.phase = 'idle';
        s.pending = null;
        s.reelResult = null;
        s.charge = 0;
        out.push({ type: 'landed', result, catch: c });
      }
      break;
    default:
      break;
  }
  return out;
}

export function lineOut(s: FishingState): boolean {
  return s.phase === 'flying' || s.phase === 'waiting' || s.phase === 'bite' || s.phase === 'reeling';
}
