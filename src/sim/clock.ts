// Game clock (plan §7.3): a 24-real-minute cycle (dawn 2, day 12, dusk 2, night 8) that maps
// to a 24-hour clock starting at 05:00, so one real minute is one in-game hour.
import { TUNABLES } from '../data/tunables.ts';
import type { DayPhase } from '../data/fish.ts';

export interface ClockState {
  /** Day number, starting at 1. */
  day: number;
  /** Seconds into the current cycle, 0 ≤ time < dayLengthSeconds. */
  time: number;
}

const C = TUNABLES.clock;
/** Real seconds per in-game hour. */
export const SECONDS_PER_GAME_HOUR = C.dayLengthSeconds / 24;
/** Clock hour at which the cycle (dawn) begins. */
export const CYCLE_START_HOUR = 5;

export function createClock(): ClockState {
  return { day: 1, time: C.startTimeOfDay * C.dayLengthSeconds };
}

/** Advance by real seconds (speed multiplies, e.g. the debug console's `speed`). Returns in-game hours elapsed. */
export function advanceClock(c: ClockState, dt: number, speed = 1): number {
  const s = dt * speed;
  c.time += s;
  while (c.time >= C.dayLengthSeconds) {
    c.time -= C.dayLengthSeconds;
    c.day += 1;
  }
  return s / SECONDS_PER_GAME_HOUR;
}

export function phaseOf(c: ClockState): DayPhase {
  const t = c.time;
  if (t < C.dawnSeconds) return 'dawn';
  if (t < C.dawnSeconds + C.daySeconds) return 'day';
  if (t < C.dawnSeconds + C.daySeconds + C.duskSeconds) return 'dusk';
  return 'night';
}

/** 0..1 through the cycle (0 = start of dawn). */
export function cycleFraction(c: ClockState): number {
  return c.time / C.dayLengthSeconds;
}

/** 24-hour clock reading. */
export function clockHours(c: ClockState): { hour: number; minute: number } {
  const hours = (CYCLE_START_HOUR + c.time / SECONDS_PER_GAME_HOUR) % 24;
  const hour = Math.floor(hours);
  const minute = Math.floor((hours - hour) * 60);
  return { hour, minute };
}

export function formatClock(c: ClockState): string {
  const { hour, minute } = clockHours(c);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Set the time from an `hh:mm` string (debug console). Invalid input leaves the clock alone. */
export function setClockTime(c: ClockState, hhmm: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return false;
  const hours = (hour + minute / 60 - CYCLE_START_HOUR + 24) % 24;
  c.time = hours * SECONDS_PER_GAME_HOUR;
  return true;
}

/** Sun elevation proxy for the sky rig: -1 (deep night) .. 1 (high noon). */
export function sunFactor(c: ClockState): number {
  const f = cycleFraction(c);
  const dawn = C.dawnSeconds / C.dayLengthSeconds;
  const dayEnd = (C.dawnSeconds + C.daySeconds) / C.dayLengthSeconds;
  const duskEnd = dayEnd + C.duskSeconds / C.dayLengthSeconds;
  if (f < dawn) return -1 + (f / dawn) * 1.2; // -1 → 0.2
  if (f < dayEnd) {
    const u = (f - dawn) / (dayEnd - dawn);
    return 0.2 + Math.sin(u * Math.PI) * 0.8;
  }
  if (f < duskEnd) return 0.2 - ((f - dayEnd) / (duskEnd - dayEnd)) * 1.2; // 0.2 → -1
  return -1;
}
