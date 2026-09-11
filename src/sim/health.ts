// Player health (plan §12.4): hearts, damage, regen after a quiet spell, death rules.
import { TUNABLES } from '../data/tunables.ts';

const H = TUNABLES.health;

export interface HealthState {
  /** Hearts, 0..max, in half-heart steps. */
  hearts: number;
  /** Seconds since the last damage. */
  sinceDamage: number;
  /** Accumulated regen time toward the next half heart. */
  regenTimer: number;
}

export function createHealth(hearts: number = H.maxHearts): HealthState {
  return { hearts, sinceDamage: 1e9, regenTimer: 0 };
}

/** Apply damage in hearts. Returns true when the player is dead. */
export function damage(h: HealthState, hearts: number): boolean {
  h.hearts = Math.max(0, Math.round((h.hearts - hearts) * 2) / 2);
  h.sinceDamage = 0;
  h.regenTimer = 0;
  return h.hearts <= 0;
}

export function heal(h: HealthState, hearts: number): void {
  h.hearts = Math.min(H.maxHearts, Math.round((h.hearts + hearts) * 2) / 2);
}

/** Half a heart every `regenHalfHeartSeconds` once `regenDelaySeconds` have passed without damage. */
export function tickHealth(h: HealthState, dt: number): void {
  h.sinceDamage += dt;
  if (h.hearts >= H.maxHearts || h.sinceDamage < H.regenDelaySeconds) return;
  h.regenTimer += dt;
  while (h.regenTimer >= H.regenHalfHeartSeconds && h.hearts < H.maxHearts) {
    h.regenTimer -= H.regenHalfHeartSeconds;
    h.hearts = Math.min(H.maxHearts, h.hearts + 0.5);
  }
}

/** Respawn: full hearts. */
export function respawn(h: HealthState): void {
  h.hearts = H.maxHearts;
  h.sinceDamage = 1e9;
  h.regenTimer = 0;
}
